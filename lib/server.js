const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const BRIDGE_PATH = path.join(__dirname, 'bridge.js');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function createServer(args) {
  const port = args.relayPort || 8765;
  const wss = new WebSocket.Server({ port });
  const bridgeSrc = fs.readFileSync(BRIDGE_PATH, 'utf-8');
  const ctx = args.ctx;

  // Page pool — pre-warmed, ready-to-use Playwright pages
  const POOL_SIZE = 1;
  const pagePool = [];
  let poolDraining = false;
  let poolFilling = false;
  let poolReadyResolve = null;
  let poolReadyPromise = null;

  let clientId = 0;
  const clients = new Map();

  console.log('\n═══════════════════════════════════════');
  console.log('  G365 M365 Copilot Relay');
  console.log('  ws://127.0.0.1:' + port);
  console.log('  Default: GPT 5.5 Think Deeper');
  console.log('  Page pool size: ' + POOL_SIZE);
  console.log('═══════════════════════════════════════\n');

  // ── Pool helpers ───────────────────────────────────────────

  async function findAndClickInput(page) {
    const selectors = [
      '[contenteditable="true"]','textarea','[role="textbox"]',
      '#userInput','[data-testid="chat-input"]','.chat-input',
      '[placeholder*="Ask" i]','[placeholder*="Message" i]'
    ];
    for (const sel of selectors) {
      try {
        const el = await page.$(sel);
        if (el) { await el.click().catch(() => {}); return true; }
      } catch (e) {}
    }
    return false;
  }

  async function warmPage() {
    if (!ctx || poolDraining) return null;
    const start = Date.now();
    try {
      const page = await ctx.newPage();
      page.on('console', (msg) => {
        const text = msg.text();
        if (text.includes('[COPILOT]')) console.log(`[pool] ${text}`);
      });
      await page.addInitScript(bridgeSrc);

      await page.goto('https://m365.cloud.microsoft/chat?auth=2', {
        waitUntil: 'networkidle',
        timeout: 60000,
      }).catch(() => {});
      await sleep(2000);

      // Check for auth redirect
      const url = page.url();
      if (url.includes('login.microsoftonline.com')) {
        console.log(`[pool] Auth expired — redirect to Microsoft login`);
        try { await page.close(); } catch(e) {}
        return null;
      }

      // Wait for bridge ready
      let ready = false;
      for (let i = 0; i < 45; i++) {
        await sleep(1000);
        try {
          ready = await page.evaluate(() => !!(window.__m365Ready && window.__m365Ready()));
          if (ready) break;
        } catch (e) {}
        if (i % 5 === 0) {
          await findAndClickInput(page);
          try { await page.keyboard.type(' ', { delay: 5 }); } catch (e) {}
          await sleep(500);
          try { await page.keyboard.press('Escape'); } catch (e) {}
        }
      }

      if (!ready) {
        console.log(`[pool] Page failed to warm after ${Date.now()-start}ms`);
        try { await page.close(); } catch(e) {}
        return null;
      }

      // Set default model
      await page.evaluate(() => {
        if (window.__m365SetModel) window.__m365SetModel('gpt-5.5-think-deeper');
      });

      // Click input once to prime
      await findAndClickInput(page);
      await sleep(300);
      await page.keyboard.press('Escape').catch(()=>{});

      console.log(`[pool] Page warmed in ${Date.now()-start}ms`);
      return page;
    } catch (e) {
      console.log(`[pool] Warm error: ${e.message}`);
      return null;
    }
  }

  async function refillPool() {
    if (!ctx || poolDraining) return;
    if (poolFilling) {
      // Wait for current fill to finish
      if (!poolReadyPromise) {
        poolReadyPromise = new Promise(r => { poolReadyResolve = r; });
      }
      await poolReadyPromise;
      return;
    }
    poolFilling = true;
    try {
      while (pagePool.length < POOL_SIZE) {
        if (poolDraining) break;
        const page = await warmPage();
        if (page) pagePool.push(page);
        else break;
      }
    } finally {
      poolFilling = false;
      if (poolReadyResolve) { poolReadyResolve(); poolReadyResolve = null; poolReadyPromise = null; }
    }
  }

  async function takePage() {
    if (pagePool.length > 0) {
      return pagePool.shift();
    }
    console.log('[pool] Pool empty — warming fresh page');
    const page = await warmPage();
    if (page) {
      // Refill in background
      setTimeout(() => refillPool().catch(()=>{}), 50);
    }
    return page;
  }

  async function recyclePage(page) {
    if (!page) return;
    try { await page.close(); } catch(e) {}
    // Refill in background
    setTimeout(() => refillPool().catch(()=>{}), 100);
  }

  // Start warming pool
  if (ctx) {
    setTimeout(() => refillPool(), 500);
    // Periodic keep-alive refreshes
    if (args.interval && args.interval > 0) {
      const intervalMs = args.interval * 60 * 1000;
      setInterval(async () => {
        for (const page of pagePool) {
          if (page && !page.isClosed()) {
            try {
              await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
              console.log(`[pool] Refreshed`);
            } catch (e) {
              console.log(`[pool] Refresh failed: ${e.message}`);
            }
          }
        }
      }, intervalMs);
    }
  }

  // ── WebSocket handling ─────────────────────────────────────

  wss.on('connection', async function(clientWs, req) {
    const cid = ++clientId;
    const client = { ws: clientWs, page: null, closed: false, model: 'gpt-5.5-think-deeper', ready: false };
    clients.set(cid, client);

    console.log(`[${cid}] + Connected from ${req.socket.remoteAddress || 'local'}`);

    if (!ctx) {
      send({ type: 'error', message: 'Browser not ready. Restart relay.' });
      clientWs.close();
      return;
    }

    let pollTimer = null;
    let heartbeatTimer = null;
    let lastPing = Date.now();

    function send(obj) {
      if (!client.closed && clientWs.readyState === WebSocket.OPEN) {
        try { clientWs.send(JSON.stringify(obj)); }
        catch (e) { console.log(`[${cid}] Send error: ${e.message}`); }
      }
    }

    function cleanup(reason) {
      if (client.closed) return;
      client.closed = true;
      console.log(`[${cid}] Closed${reason ? ' (' + reason + ')' : ''}`);
      if (pollTimer) clearInterval(pollTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (client.page) {
        recyclePage(client.page);
        client.page = null;
      }
      clients.delete(cid);
    }

    clientWs.on('close', (code, reason) => cleanup(`client disconnected, code=${code}`));
    clientWs.on('error', (err) => {
      console.log(`[${cid}] WS error: ${err.message}`);
      cleanup('ws error');
    });

    // Heartbeat - check connection health + send WS ping frames
    heartbeatTimer = setInterval(() => {
      if (client.closed) return;
      if (Date.now() - lastPing > 120000) {
        console.log(`[${cid}] Heartbeat timeout`);
        send({ type: 'error', message: 'Connection idle timeout' });
        cleanup('idle timeout');
        return;
      }
      // Send native WS ping frame
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.ping();
      }
    }, 15000);

    // ── Take a pre-warmed page ──
    const page = await takePage();
    if (!page) {
      send({ type: 'error', code: 'TIMEOUT', message: 'No warmed pages available. Try again in a few seconds.' });
      cleanup('no page');
      return;
    }
    client.page = page;

    // Verify still ready
    const stillReady = await page.evaluate(() => !!(window.__m365Ready && window.__m365Ready()));
    if (!stillReady) {
      console.log(`[${cid}] Page lost readiness — warming fresh`);
      recyclePage(page);
      const freshPage = await warmPage();
      if (!freshPage) {
        send({ type: 'error', code: 'TIMEOUT', message: 'Failed to prepare page. Try again.' });
        cleanup('fresh warm failed');
        return;
      }
      client.page = freshPage;
    }

    // CRITICAL: Reset conversation state for this new client
    try {
      await client.page.evaluate(() => {
        if (window.__m365ClearConversation) window.__m365ClearConversation();
      });
      console.log(`[${cid}] Conversation state reset`);
    } catch (e) {
      console.log(`[${cid}] Failed to reset conversation: ${e.message}`);
    }

    // Set model
    try {
      await client.page.evaluate((m) => {
        if (window.__m365SetModel) window.__m365SetModel(m);
      }, client.model);
    } catch (e) {}

    console.log(`[${cid}] Ready (${client.model}) — from pool`);
    // Don't send ready here — the client will send a 'new' message and we'll respond with ready there
    // send({ type: 'ready', model: client.model });
    client.ready = true;

    // Server-side ping/pong to keep connection alive
    clientWs.isAlive = true;
    clientWs.on('pong', () => { clientWs.isAlive = true; });

    // Poll for responses
    pollTimer = setInterval(async () => {
      if (client.closed || !client.page || client.page.isClosed()) return;
      try {
        const items = await client.page.evaluate(() => {
          return window.__m365Poll ? window.__m365Poll() : [];
        });
        if (!items || !items.length) return;
        for (const item of items) {
          if (client.closed) return;
          if (item.type === 'error') console.log(`[${cid}] Bridge error: ${item.message}`);
          send(item);
        }
      } catch (e) {
        if (!client.closed) console.log(`[${cid}] Poll error: ${e.message}`);
      }
    }, 25); // 40Hz polling for fast streaming

    // ── WS message handler ──
    clientWs.on('message', async (raw) => {
      if (client.closed || !client.page) return;
      lastPing = Date.now();

      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (e) {
        return send({ type: 'error', message: 'Invalid JSON' });
      }

      switch (msg.type) {
        case 'new':
          client.model = msg.model || 'gpt-5.5-think-deeper';
          try {
            await client.page.evaluate((m) => { if (window.__m365SetModel) window.__m365SetModel(m); }, client.model);
          } catch (e) {}
          try {
            await client.page.evaluate(() => { if (window.__m365ClearConversation) window.__m365ClearConversation(); });
          } catch (e) {}
          send({ type: 'ready', model: client.model });
          console.log(`[${cid}] Model set: ${client.model}`);
          break;

        case 'chat': {
          const text = msg.text || msg.message;
          if (!text) return send({ type: 'error', message: 'text or message required' });
          console.log(`[${cid}] User: ${text.substring(0, 80)}${text.length > 80 ? '...' : ''}`);
          if (!client.ready) return send({ type: 'error', message: 'Bridge not ready yet.' });

          // If page died, try to get a fresh one
          if (!client.page || client.page.isClosed()) {
            console.log(`[${cid}] Page closed, swapping fresh page`);
            try { if (client.page) await client.page.close().catch(()=>{}); } catch(e){}
            const freshPage = await takePage();
            if (!freshPage) {
              send({ type: 'error', message: 'Page unavailable. Try again.' });
              break;
            }
            client.page = freshPage;
            try {
              await client.page.evaluate(() => { if (window.__m365ClearConversation) window.__m365ClearConversation(); });
            } catch(e){}
            try {
              await client.page.evaluate((m) => { if (window.__m365SetModel) window.__m365SetModel(m); }, client.model);
            } catch(e){}
          }

          try {
            await client.page.evaluate((t) => {
              if (window.__m365Send) window.__m365Send(t, { newConversation: false });
              else console.error('__m365Send not available');
            }, text);
          } catch (e) {
            console.error(`[${cid}] Send error: ${e.message}`);
            send({ type: 'error', message: e.message });
          }
          break;
        }

        case 'ping':
          send({ type: 'pong', timestamp: Date.now() });
          break;

        case 'clear':
          try {
            await client.page.evaluate(() => { if (window.__m365ClearConversation) window.__m365ClearConversation(); });
            send({ type: 'cleared' });
          } catch (e) { send({ type: 'error', message: e.message }); }
          break;

        case 'status':
          try {
            const streaming = await client.page.evaluate(() => window.__m365IsStreaming ? window.__m365IsStreaming() : false);
            send({ type: 'status', streaming, model: client.model });
          } catch (e) { send({ type: 'error', message: e.message }); }
          break;

        default:
          send({ type: 'error', message: 'Unknown type: ' + msg.type });
      }
    });
  });

  return { wss, drain: () => { poolDraining = true; pagePool.forEach(p => p.close().catch(()=>{})); } };
}

module.exports = { createServer };
