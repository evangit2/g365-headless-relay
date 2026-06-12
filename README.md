# g365-headless-relay

Node.js off-screen Chromium bridge that wraps the M365 Copilot WebSocket (`substrate.office.com`) as a local `ws://127.0.0.1:8765` relay. No access tokens are extracted or cached — the browser's authenticated session handles all auth.

## What's new in this fork

- **Polished chat UI** (`chat-ui/index.html`) — dark-theme, markdown rendering, collapsible reasoning panel, debug console
- **Real-time reasoning steps** — captures M365 internal reasoning (chain-of-thought, code execution) via `reasoning_delta` events
- **40Hz polling** — 25ms server-side poll interval for fast streaming
- **Page pool** — pre-warmed pages for instant connection (no more ~10s wait per client)
- **WebSocket ping/pong** — prevents idle disconnects (1006 errors)
- **Duplicate suppression** — dedupes `writeAtCursor` streaming vs `type=2` full messages
- **Conversation isolation** — each client gets independent session, auto-cleared on connect
- **VNC/noVNC included** — remote browser viewing via `start.sh` (port 6080)

## Quick start

```bash
npm install

# First time — sign in via visible browser
node index.js --no-headless

# Normal use — off-screen relay + chat UI + VNC
./start.sh
```

Relay WS: `ws://127.0.0.1:8765`  
Chat UI:  `http://127.0.0.1:8767`  
VNC view: `http://<host>:6080/vnc.html`

## WebSocket API

Connect to `ws://127.0.0.1:8765`

```
→ {"type":"new","model":"gpt-5.5-think-deeper"}
← {"type":"ready","model":"gpt-5.5-think-deeper"}

→ {"type":"chat","text":"Hello"}
← {"type":"sent"}
← {"type":"reasoning_delta","text":"Analyzing the query..."}
← {"type":"delta","text":"Hel"}
← {"type":"delta","text":"lo"}
← {"type":"reasoning_done"}
← {"type":"done"}
```

| Type | Dir | Description |
|------|-----|-------------|
| `new` | → | Create session, pick model |
| `chat` | → | Send a message |
| `ping` | → | Keepalive |
| `clear` | → | Reset conversation |
| `ready` | ← | Session ready |
| `sent` | ← | Message acknowledged |
| `reasoning_delta` | ← | Reasoning step chunk |
| `reasoning_done` | ← | All reasoning complete |
| `delta` | ← | Streaming answer chunk |
| `message` | ← | Full bot response (fallback) |
| `done` | ← | Turn complete |
| `error` | ← | Error details |
| `pong` | ← | Ping response |

## Models

| Model ID | Substrate Tone | Behavior |
|----------|---------------|----------|
| `gpt-5.5-think-deeper` | `Gpt_5_5_Reasoning` | Deeper reasoning, visible steps |
| `gpt-5.5-quick` | `Gpt_5_5_Chat` | Fast, concise |

## Architecture

```
Client WS          Relay Server        Browser Page        Substrate WS
─────────          ────────────        ────────────        ────────────
ws://localhost     lib/server.js       lib/bridge.js       substrate.office.com
─────→              ─────→              ─────→              ─────→
  {type:"chat"}      page.evaluate       __m365Send()        buildChatInvoke()
                    (bridge call)        (injected JS)       (SignalR type:4)
                   ←─────              ←─────              ←─────
  {type:"delta"}     poll loop           __m365Poll()        type:1 update
                     setInterval 25ms
```

```
                    Browser (Playwright)
                    ──────────────────
                    lib/browser.js
                    │
                    ├─ launchPersistentContext(profile/)  ← headed always
                    ├─ inject lib/bridge.js via addInitScript
                    ├─ page pool (pre-warmed)
                    └─ one page per client connection
```

### Files

| File | Role |
|------|------|
| `index.js` | CLI parsing, browser launch, server orchestration |
| `lib/browser.js` | Playwright Chromium launcher — headed always, off-screen positioning |
| `lib/bridge.js` | Injected page script — intercepts WS constructor, handles substrate protocol, dedupes deltas, extracts reasoning |
| `lib/server.js` | External WebSocket server — page pool, 40Hz polling, ping/pong, conversation reset |
| `lib/ui-server.js` | Static HTTP server for `chat-ui/index.html` |
| `chat-ui/index.html` | Dark-theme chat interface with reasoning panel, markdown, debug console |
| `start.sh` | Off-screen relay + Xvfb + x11vnc + noVNC |

## Substrate Protocol

- **Separator:** `\x1e` (ASCII 0x1E)
- **Handshake:** `{"protocol":"json","version":1}\x1e`
- **Chat invoke (type:4):** Contains `tone` (model), `optionsSets`, `message.text`, `isStartOfSession`
- **Response types:**
  - `type:1 target:update` → `writeAtCursor` (streaming chars) or `messages[]` (reasoning + full text)
  - `type:2` → `item.messages[]` (full conversation)
  - `type:3` → Completion
  - `type:6` → Ping (ignored)

## Key Behaviors

- **No token extraction** — access token stays in browser; bridge uses page's own substrate WS URL template
- **Browser always headed** — off-screen positioning for hidden mode. True headless breaks M365 OAuth.
- **One page per client** — each WS connection gets its own tab
- **Page pool** — pages warmed ahead of time for instant connections
- **Poll interval: 25ms** — fast delta delivery to client
- **Anti-detection:** `--disable-blink-features=AutomationControlled`, real Chrome user-agent

## Credits

Original by [notBlubbll](https://github.com/notBlubbll/g365-headless-relay).  
Forked and enhanced by [evangit2](https://github.com/evangit2) with chat UI, reasoning extraction, page pool, and reliability fixes.

Inspired by [m365-copilot-openai-proxy](https://github.com/kuchris/m365-copilot-openai-proxy) by [@kuchris](https://github.com/kuchris).
