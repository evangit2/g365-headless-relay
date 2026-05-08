# AGENTS.md

## Project

M365 Copilot Headless Relay — Node.js off-screen Chromium bridge that wraps the M365 Copilot WebSocket (substrate.office.com) as a local `ws://127.0.0.1:8765` relay. No access tokens are extracted or cached — the browser's authenticated session handles all auth.

## Commands

```
# Install
npm install                    # installs deps + downloads Chromium
node --check lib/*.js index.js # syntax-only check (no runtime)

# Run
node index.js --headless       # off-screen relay (default)
node index.js --no-headless    # visible relay (for debugging/login)
node index.js --port 9000      # custom port
node index.js --interval 30    # refresh every 30 min (default: 50)

# Batch files
start.cmd                      # off-screen relay
debug.cmd                      # visible browser relay (for login)
```

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
                    └─ prime page for session keepalive
```

### Files

| File | Role |
|------|------|
| `index.js` | CLI parsing, browser launch, server orchestration, keepalive refresh |
| `lib/browser.js` | Launches Playwright Chromium with persistent profile. Headed always — off-screen positioning for hidden mode. |
| `lib/bridge.js` | Injected page script. Intercepts page WebSocket constructor to capture substrate URL template. Opens substrate WS per chat, sends SignalR invokes, queues responses for poll. |
| `lib/server.js` | External WebSocket server. One page per client connection. Injects bridge, polls for deltas, forwards to client. |

### Protocol (substrate.office.com SignalR — handled by bridge.js)

- Separator: `\x1e` (ASCII 0x1E)
- Handshake: `{"protocol":"json","version":1}\x1e`
- Chat invoke: `{"type":4,"target":"chat","invocationId":"0","arguments":[...]}\x1e`
- Response types:
  - `type:1 target:update` → `writeAtCursor` (streaming delta) or `messages` (full bot message)
  - `type:2` → `item.messages[]` (full conversation)
  - `type:3` → Completion (turn done, WS closed)
  - `type:6` → Ping (ignored)
- The `tone` parameter in the chat invoke controls model behavior:
  - `"ThinkDeep"` — deeper reasoning (gpt-5.5-think-deeper)
  - `"Balanced"` — fast, concise (gpt-5.5-quick)

## Client Protocol (connect to ws://127.0.0.1:8765)

```
→ {"type":"new","model":"gpt-5.5-think-deeper"}
← {"type":"ready","model":"gpt-5.5-think-deeper"}

→ {"type":"chat","text":"Hello"}
← {"type":"delta","text":"Hel"}
← {"type":"delta","text":"lo"}
← {"type":"message","text":"Hello...","conversationId":"..."}
← {"type":"done","conversationId":"..."}

→ {"type":"chat","text":"Follow-up"}   // new conversation each turn
← {"type":"delta","text":"..."}
← {"type":"done"}
```

### Server → Client message types

| Type | Description |
|------|-------------|
| `ready` | Session created with model |
| `delta` | Streaming text token |
| `message` | Full bot response (text, conversationId, turnState) |
| `done` | Turn complete |
| `sent` | Message acknowledged by bridge |
| `error` | Error details |
| `pong` | Ping response |

## Key Behaviors

- **No token extraction** — the access token stays in the browser; bridge.js uses the page's own substrate WS URL template
- **Browser always headed** — off-screen positioning (`--window-position=-32000,-32000`) for hidden mode. True headless breaks M365 OAuth/cookie flows.
- **One page per client** — each WS connection gets its own browser tab with independent conversation
- **Bridge injected via `addInitScript`** — runs before any page JavaScript, intercepts `window.WebSocket` constructor
- **Auto-priming** — if the page loads but the substrate WS doesn't open within 15s, clicks chat input and types a space
- **Poll interval: 200ms** — `setInterval` calling `__m365Poll()` to drain the response queue
- **Session keepalive** — prime page refreshed every 50 minutes (default) to prevent M365 session expiry
- **Anti-detection:** `--disable-blink-features=AutomationControlled`, `ignoreDefaultArgs: ['--enable-automation']`, real Chrome user-agent
- Profile directory `./profile/` persists cookies/storage between runs
- `debug.cmd` always launches visible browser for interactive sign-in
