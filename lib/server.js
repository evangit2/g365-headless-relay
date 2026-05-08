const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const BRIDGE_PATH = path.join(__dirname, 'bridge.js');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function createServer(args) {
  const port = args.relayPort || 8765;
  const wss = new WebSocket.Server({ port });
  const bridgeSrc = fs.readFileSync(BRIDGE_PATH, 'utf-8');

  let clientId = 0;

  console.log('\nM365 Copilot Relay');
  console.log('ws://127.0.0.1:' + port);
  console.log('Models: gpt-5.5-think-deeper, gpt-5.5-quick');
  console.log('Waiting for connections...\n');

  wss.on('connection', async function(clientWs, req) {
    const cid = ++clientId;
    const ctx = args.ctx;
    console.log('[' + cid + '] + ' + (req.socket.remoteAddress || 'client'));

    if (!ctx) {
      clientWs.send(JSON.stringify({ type: 'error', message: 'Browser not ready. Restart relay.' }));
      clientWs.close();
      return;
    }

    let page = null;
    let closed = false;
    let pollTimer = null;
    let model = 'gpt-5.5-quick';
    let ready = false;

    function send(obj) {
      if (!closed && clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(obj));
      }
    }

    function cleanup(reason) {
      if (closed) return;
      closed = true;
      console.log('[' + cid + '] closed' + (reason ? ' (' + reason + ')' : ''));
      if (pollTimer) clearInterval(pollTimer);
      if (page) {
        try { page.close().catch(function() {}); } catch (e) {}
        page = null;
      }
    }

    clientWs.on('close', function(code, reason) {
      cleanup('client disconnected, code=' + code);
    });
    clientWs.on('error', function(err) {
      console.log('[' + cid + '] WS error: ' + err.message);
      cleanup('error: ' + err.message);
    });

    async function findAndClickInput() {
      const selectors = ['[contenteditable="true"]', 'textarea', '[role="textbox"]', '#userInput'];
      for (const sel of selectors) {
        try {
          const el = await page.$(sel);
          if (el) { await el.click(); return true; }
        } catch (e) {}
      }
      return false;
    }

    try {
      page = await ctx.newPage();
      page.on('console', function(msg) {
        console.log(msg.text());
      });
      await page.addInitScript(bridgeSrc);
      console.log('[' + cid + '] navigating...');

      await page.goto('https://m365.cloud.microsoft/chat?auth=2', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      }).catch(function() {});

      // Wait for the page to establish its own substrate WS
      for (let i = 0; i < 20 && !ready && !closed; i++) {
        await sleep(1500);
        try {
          ready = await page.evaluate(function() {
            return !!(window.__m365Ready && window.__m365Ready());
          });
        } catch (e) {/* page may be navigating */}
        if (!ready && !closed) {
          await findAndClickInput();
          try { await page.keyboard.type(' ', { delay: 10 }); } catch (e) {}
        }
      }

      if (closed) return;

      if (!ready) {
        const url = page.url();
        if (url.includes('login') || url.includes('signin')) {
          send({ type: 'error', message: 'Not signed in. Run debug.cmd to sign in first.' });
        } else {
          send({ type: 'error', message: 'M365 Chat not ready. Try debug.cmd for interactive sign-in.' });
        }
        return;
      }

      // Set model
      try {
        await page.evaluate(function(m) {
          if (window.__m365SetModel) window.__m365SetModel(m);
        }, model);
      } catch (e) {}

      console.log('[' + cid + '] ready');
      send({ type: 'ready', model: model });

      // Poll for responses every 200ms
      pollTimer = setInterval(async function() {
        if (closed || !page || page.isClosed()) return;
        try {
          const items = await page.evaluate(function() {
            return window.__m365Poll ? window.__m365Poll() : [];
          });
          if (!items || !items.length) return;
          for (const item of items) {
            if (closed) return;
            if (item.type === 'error') {
              console.log('[' + cid + '] error: ' + item.message);
            }
            send(item);
          }
        } catch (e) {
          console.log('[' + cid + '] poll error: ' + e.message);
        }
      }, 200);

    } catch (e) {
      console.error('[' + cid + '] setup error: ' + e.message);
      send({ type: 'error', message: 'Setup failed: ' + e.message });
      return;
    }

    clientWs.on('message', async function(raw) {
      if (closed || !page) return;
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (e) {
        return send({ type: 'error', message: 'Invalid JSON' });
      }

      switch (msg.type) {
        case 'new':
          model = msg.model || 'gpt-5.5-quick';
          if (ready) {
            try {
              await page.evaluate(function(m) {
                if (window.__m365SetModel) window.__m365SetModel(m);
              }, model);
            } catch (e) {}
          }
          send({ type: 'ready', model: model });
          break;

        case 'chat':
          const text = msg.text || msg.message;
          if (!text) {
            send({ type: 'error', message: 'text or message required' });
            return;
          }
          console.log('[' + cid + '] chat: ' + text);
          if (!ready) {
            send({ type: 'error', message: 'Bridge not ready yet. Wait for ready event.' });
            return;
          }
          try {
            await page.evaluate(function(t) {
              if (window.__m365Send) window.__m365Send(t);
            }, text);
            send({ type: 'sent' });
          } catch (e) {
            console.error('[' + cid + '] send error: ' + e.message);
            send({ type: 'error', message: e.message });
          }
          break;

        case 'ping':
          send({ type: 'pong' });
          break;

        default:
          send({ type: 'error', message: 'Unknown type: ' + msg.type });
      }
    });
  });

  return wss;
}

module.exports = { createServer };
