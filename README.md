# M365 Copilot Headless Relay

Node.js off-screen Chromium bridge that exposes Microsoft 365 Copilot chat through a local WebSocket server. **No keys are extracted or cached** — the browser's authenticated session handles everything.

## How it works

1. Launches Chromium with a persistent profile (`./profile/`) — always headed mode, off-screen when hidden
2. Opens the M365 Copilot chat page, injects a bridge script that intercepts the page's own WebSocket connections
3. Starts a local WebSocket server at `ws://127.0.0.1:8765`
4. When a client sends a chat message, the bridge opens a substrate WebSocket from inside the browser page, sends the message, and streams back responses
5. No access tokens are ever extracted or stored — the browser session IS the auth

## Quick start

```
npm install

:: First time — sign in interactively (browser opens visibly)
debug.cmd

:: Then run off-screen
start.cmd
```

## Commands

```
node index.js --headless        Off-screen relay (use start.cmd)
node index.js --no-headless     Visible browser relay (use debug.cmd for login)
node index.js --port 9000       Custom relay port
node index.js --interval 30     Session keepalive every 30 min (default: 50)
```

## WebSocket API

Connect to `ws://127.0.0.1:8765`

```
→ {"type":"new","model":"gpt-5.5-think-deeper"}
← {"type":"ready","model":"gpt-5.5-think-deeper"}

→ {"type":"chat","text":"Hello"}
← {"type":"delta","text":"Hel"}
← {"type":"delta","text":"lo"}
← {"type":"message","text":"Hello world...","conversationId":"..."}
← {"type":"done","conversationId":"..."}
```

| Type | Dir | Description |
|------|-----|-------------|
| `new` | → | Create session, pick model |
| `chat` | → | Send a message |
| `ping` | → | Keepalive |
| `ready` | ← | Session created |
| `delta` | ← | Streaming text chunk |
| `message` | ← | Full bot response |
| `done` | ← | Turn complete |
| `sent` | ← | Message acknowledged |
| `error` | ← | Error details |
| `pong` | ← | Ping response |

## Models

- `gpt-5.5-think-deeper` — tone: "ThinkDeep" (deeper reasoning)
- `gpt-5.5-quick` — tone: "Balanced" (fast, concise)

## Architecture

```
Client WS          Relay Server        Browser Page        Substrate WS
─────────          ────────────        ────────────        ────────────
ws://localhost     lib/server.js       lib/bridge.js       substrate.office.com
─────→              ─────→              ─────→              ─────→
  {type:"chat"}      page.evaluate       __m365Send()        buildChatInvoke()
                    (bridge call)        (injected JS)       (SignalR type:4)
                   ←─────              ←─────              ←─────
  {type:"delta"}     poll loop           __m365Poll()         type:1 update
                     setInterval 200ms
```

## Files

| File | Role |
|------|------|
| `index.js` | CLI, launches browser, starts server |
| `lib/browser.js` | Playwright Chromium launcher (headed, off-screen mode) |
| `lib/bridge.js` | Injected page script — intercepts substrate WS, sends/receives chat |
| `lib/server.js` | WebSocket relay — one page per client, polls bridge for responses |
| `start.cmd` | Off-screen relay |
| `debug.cmd` | Visible browser for interactive login |

## Key behaviors

- **No keys stored** — the access token never leaves the browser
- **Browser always headed** — off-screen positioning for hidden mode, never true headless
- **Bridge script** injected via `page.addInitScript` runs before any page JS
- **Auto-priming** — clicks input and types space if substrate WS not detected within 15s
- **Session keepalive** — prime page refreshed every 50 minutes to prevent session expiry
- **One page per client** — each WS connection gets its own browser tab with independent conversation
- **Anti-detection** — `--disable-blink-features=AutomationControlled`, real user-agent, no automation flag
