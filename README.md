# g365-headless-relay

Node.js off-screen Chromium bridge that wraps the M365 Copilot WebSocket (`substrate.office.com`) as a local `ws://127.0.0.1:8765` relay. No access tokens are extracted or cached — the browser's authenticated session handles all auth.

## How it works

1. Launches Chromium with a persistent profile (`./profile/`) — always headed mode, off-screen when hidden
2. When a WebSocket client connects, opens a page at `m365.cloud.microsoft/chat` and injects a bridge script
3. The bridge intercepts the page's own substrate WebSocket URL template
4. Incoming chat messages trigger the bridge to open its own substrate WS from inside the page
5. Responses are streamed back to the client in real time

## Quick start

```
npm install
debug.cmd       # first time — sign in (visible browser)
start.cmd       # off-screen relay
```

## Commands

```
node index.js --headless        Off-screen relay (use start.cmd)
node index.js --no-headless     Visible browser (use debug.cmd for login)
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
← {"type":"message","text":"Hello...","conversationId":"..."}
← {"type":"done","conversationId":"..."}
```

| Type | Dir | Description |
|------|-----|-------------|
| `new` | → | Create session, pick model |
| `chat` | → | Send a message |
| `ping` | → | Keepalive |
| `ready` | ← | Session created |
| `delta` | ← | Streaming text chunk |
| `message` | ← | Full bot response with conversationId |
| `done` | ← | Turn complete |
| `sent` | ← | Message acknowledged |
| `error` | ← | Error details |
| `pong` | ← | Ping response |

## Models

| Model ID | Substrate Tone | Behavior |
|----------|---------------|----------|
| `gpt-5.5-think-deeper` | `Gpt_5_5_Reasoning` | Deeper reasoning |
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
  {type:"delta"}     poll loop           __m365Poll()         type:1 update
                     setInterval 200ms
```

```
                    Browser (Playwright)
                    ──────────────────
                    lib/browser.js
                    │
                    ├─ launchPersistentContext(profile/)  ← headed always
                    ├─ inject lib/bridge.js via addInitScript
                    ├─ one page per client connection
                    └─ no priming — pages open on demand
```

### Files

| File | Role |
|------|------|
| `index.js` | CLI parsing, browser launch, server orchestration |
| `lib/browser.js` | Playwright Chromium launcher — headed always, off-screen positioning for hidden mode |
| `lib/bridge.js` | Injected page script — intercepts page WebSocket constructor, opens substrate WS per chat, queues responses |
| `lib/server.js` | External WebSocket server — one page per client, injects bridge, polls for deltas every 200ms |
| `start.cmd` | Off-screen relay |
| `debug.cmd` | Visible browser for interactive login |

## Substrate Protocol (substrate.office.com)

- **Separator:** `\x1e` (ASCII 0x1E)
- **Handshake:** `{"protocol":"json","version":1}\x1e`
- **Chat invoke (type:4):** Contains `tone` (model), `optionsSets` (enterprise features), `message.text`, `clientInfo`, `isStartOfSession`
- **Response types:**
  - `type:1 target:update` → `writeAtCursor` deltas (streaming) or `messages` (full bot message)
  - `type:2` → `item.messages[]` (full conversation with bot response)
  - `type:3` → Completion (turn done)
  - `type:6` → Ping (ignored)

## Key Behaviors

- **No token extraction** — the access token stays in the browser; bridge.js uses the page's own substrate WS URL template
- **Browser always headed** — off-screen positioning (`--window-position=-32000,-32000`) for hidden mode. True headless breaks M365 OAuth/cookie flows.
- **One page per client** — each WS connection gets its own browser tab with independent conversation
- **Bridge injected via `addInitScript`** — runs before any page JavaScript, intercepts `window.WebSocket` constructor
- **Auto-priming** — if the page loads but the substrate WS doesn't open within 15s, clicks chat input and types a space
- **Poll interval: 200ms** — `setInterval` calling `__m365Poll()` to drain the response queue
- **Anti-detection:** `--disable-blink-features=AutomationControlled`, `ignoreDefaultArgs: ['--enable-automation']`, real Chrome user-agent
- Profile directory `./profile/` persists cookies/storage between runs
- `debug.cmd` always launches visible browser for interactive sign-in
