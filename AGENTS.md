# AGENTS.md

## Project

g365-headless-relay — Node.js off-screen Chromium bridge that wraps the M365 Copilot WebSocket (substrate.office.com) as a local `ws://127.0.0.1:8765` relay. No access tokens are extracted or cached — the browser's authenticated session handles all auth.

## Quick Start

```bash
# 1. Install deps
npm install

# 2. Start relay (headless + VNC + UI)
./start.sh

# 3. Open chat UI
# http://localhost:8767  (or Tailscale IP)

# 4. If auth expired, re-auth via VNC:
# http://<host>:6080/vnc.html
```

## Authentication Lifecycle

The relay relies on a persistent Chromium profile (`./profile/`) that stores cookies and session state from an interactive Microsoft sign-in. The browser runs off-screen via Xvfb but uses a **real headed browser** because true headless mode breaks M365 OAuth flows.

### Auth States

| State | Indicator | Action |
|-------|-----------|--------|
| **Authenticated** | Bridge reports `__m365Ready === true` | Relay works normally |
| **Session Expired** | Bridge times out, page loads login.microsoftonline.com | Re-auth required |
| **Profile Corrupt** | SingletonLock errors, Chrome crash on launch | Kill + clear locks, relaunch |

### Re-Auth Procedure (Manual — Current)

1. **Check auth health:**
   ```bash
   node tools/auth-check.js
   ```
   - Exits 0 if ready, 1 if auth expired
   - Outputs VNC URL if auth is needed

2. **Open VNC and sign in:**
   ```bash
   ./tools/open-signin.sh   # launches visible Chrome on VNC display
   ```
   Or open the noVNC link from `start.sh` output.

3. **Sign in flow:**
   - Enter email → Next
   - Enter password → Next
   - Complete Duo MFA (push/SMS/call)
   - Wait for `m365.cloud.microsoft/chat` to load
   - Do NOT close the browser

4. **Verify:**
   ```bash
   node tools/auth-check.js
   ```

5. **Restart relay:**
   ```bash
   kill $(lsof -ti:8765)
   ./start.sh
   ```

### Re-Auth from Chat UI (Semi-Automated)

If the relay detects auth failure during a chat request:

1. Server sends `{type: "error", code: "AUTH_EXPIRED", message: "..."}` to client
2. Chat UI shows a **"Re-authenticate"** button
3. Clicking it opens `/reauth` in a new tab, which:
   - Launches visible Chrome on the VNC display
   - Navigates to `m365.cloud.microsoft/chat?auth=2`
   - Shows the VNC URL for manual sign-in
4. After sign-in, user clicks **"Check Auth"** in the chat UI
5. Relay runs health check and reconnects

See **Future: Full Automation** below for the roadmap.

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

# Tools
node tools/auth-check.js       # check if profile is authenticated
./tools/open-signin.sh         # open Chrome on VNC for manual sign-in
./tools/screenshot-vnc.sh      # capture VNC display to PNG

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
                     setInterval 25ms
```

```
                    Browser (Playwright)
                    ──────────────────
                    lib/browser.js
                    │
                    ├─ launchPersistentContext(profile/)  ← headed always
                    ├─ inject lib/bridge.js via addInitScript
                    ├─ one page per client connection
                    └─ pre-warmed page pool (size: 1)
```

### Files

| File | Role |
|------|------|
| `index.js` | CLI parsing, browser launch, server orchestration. No token management. |
| `lib/browser.js` | Launches Playwright Chromium with persistent profile. Headed always — off-screen positioning for hidden mode. |
| `lib/bridge.js` | Injected page script. Intercepts page WebSocket constructor to capture substrate URL template. Opens substrate WS per chat, sends SignalR invokes, queues responses for poll. |
| `lib/server.js` | External WebSocket server. One page per client connection. Injects bridge, polls for deltas, forwards to client. |
| `lib/ui-server.js` | Express server serving the chat UI (`chat-ui/index.html`). |
| `chat-ui/index.html` | Dark-theme chat interface with collapsible reasoning panel, markdown rendering, debug sidebar. |
| `tools/auth-check.js` | Standalone auth health check — reports ready/expired + VNC URL. |
| `tools/open-signin.sh` | Launches Chrome on VNC display for interactive sign-in. |
| `tools/screenshot-vnc.sh` | Captures the VNC display to `/tmp/vnc_screenshot.png`. |
| `start.sh` | Full startup: Xvfb + x11vnc + noVNC + relay with auth detection. |
| `start-vnc.sh` | Xvfb + x11vnc + noVNC only (no relay). |
| `open-m365-signin.sh` | Standalone Chrome launch at M365 for sign-in. |
| `open-visible-browser.js` | Node/Playwright script to open visible browser for login. |

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
  - `"Gpt_5_5_Reasoning"` — deeper reasoning (gpt-5.5-think-deeper)
  - `"Gpt_5_5_Chat"` — fast, concise (gpt-5.5-quick)

### Invoke payload details

The `buildChatInvoke` function in `lib/bridge.js` constructs a type:4 invoke matching the real M365 Copilot page format:
- `optionsSets`: 32 enterprise feature flags (at_mention_plugins_enable, enterprise_flux_*, code_interpreter_*, etc.)
- `clientInfo`: includes `ProductCategory: "Chat"`, `productEntryPoint: "ChatPanel"`
- `message`: user text, entityAnnotationTypes, locationInfo, locale
- `plugins`: `[{Id: "BingWebSearch", Source: "BuiltIn"}]`
- `streamingMode`: `"ConciseWithPadding"`

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
| `auth_expired` | M365 session expired — re-auth required |

## Key Behaviors

- **No token extraction** — the access token stays in the browser; bridge.js uses the page's own substrate WS URL template
- **Browser always headed** — off-screen positioning (`--window-position=-32000,-32000`) for hidden mode. True headless breaks M365 OAuth/cookie flows.
- **One page per client** — each WS connection gets its own browser tab with independent conversation
- **Bridge injected via `addInitScript`** — runs before any page JavaScript, intercepts `window.WebSocket` constructor
- **Auto-priming** — if the page loads but the substrate WS doesn't open within 45s, clicks chat input and types a space
- **Poll interval: 25ms** — `setInterval` calling `__m365Poll()` to drain the response queue (40Hz)
- **Session keepalive** — prime page refreshed every 50 minutes (default) to prevent M365 session expiry
- **Anti-detection:** `--disable-blink-features=AutomationControlled`, `ignoreDefaultArgs: ['--enable-automation']`, real Chrome user-agent
- **Profile directory** `./profile/` persists cookies/storage between runs
- **Conversation isolation** — `__m365ClearConversation` resets state for each new client to prevent message doubling
- **Delta deduplication** — `_finalBuffer` tracking prevents duplicate text in final `message` vs streamed `delta`s
- **WebSocket keepalive** — server sends ping frames every 15s; client pings every 2.5s with exponential backoff reconnection
- **Page pool** — pre-warmed page ready for instant client connections; size 1 eliminates race conditions
- `debug.cmd` always launches visible browser for interactive sign-in

## Auth Failure Handling

When a page warm fails due to expired auth:

1. `warmPage()` returns `null` after 45s timeout
2. Server logs: `[pool] Page failed to warm after 45000ms`
3. Client WS gets: `{type: "error", code: "TIMEOUT", message: "No warmed pages available. ..."}`
4. Chat UI should detect this and show **"Session expired — Re-authenticate"** button
5. User clicks → opens `/reauth` endpoint → visible Chrome on VNC → manual sign-in

### Detecting Auth Expiry from Logs

```bash
# Watch for these patterns in relay.log
tail -f /tmp/relay.log | grep -E "failed to warm|login.microsoft|AUTH|TIMEOUT"
```

### Quick Recovery

```bash
# 1. Kill everything
pkill -9 chromium; pkill -9 chrome; pkill -f "node.*index.js"
# 2. Clear Chrome locks
rm -f profile/SingletonLock profile/SingletonSocket*
# 3. Open sign-in
./tools/open-signin.sh
# 4. Sign in via VNC (http://<host>:6080/vnc.html)
# 5. Restart relay
./start.sh
```

## Future: Full Automation Roadmap

### Phase 1 — Re-Auth from Chat UI (Now)
- ✅ `auth-check.js` — programmatic health check
- ✅ `/reauth` endpoint — launches visible browser, returns VNC URL
- ✅ "Re-authenticate" button in chat UI
- ⬜ Auto-detect auth expiry without waiting for timeout
- ⬜ Periodic background auth check (every 5 min)

### Phase 2 — Cookie Injection (Medium)
- ⬜ Accept exported cookies (Netscape format) from user's desktop browser
- ⬜ Programmatically inject into profile before launch
- ⬜ Skip manual VNC sign-in entirely
- ⬜ Requires: user installs browser extension to export cookies

### Phase 3 — Token Refresh (Hard)
- ⬜ Detect Microsoft refresh token in profile
- ⬜ Use MSAL/device-code flow for non-interactive refresh
- ⬜ Duo MFA is the blocker — may require FIDO2/webauthn automation
- ⬜ Could use Tailscale + trusted device to skip MFA

### Phase 4 — Headless Auth (Research)
- ⬜ Investigate if M365 supports long-lived tokens for "trusted applications"
- ⬜ Evaluate Microsoft Graph API as alternative (limited Copilot access)
- ⬜ Consider persistent VNC + auto-click scripts for MFA (fragile, not recommended)

## Environment Requirements

- Node.js 18+
- Playwright (installs Chromium automatically)
- Xvfb (`apt install xvfb`)
- x11vnc (`apt install x11vnc`)
- noVNC / websockify (`apt install novnc websockify`)
- ImageMagick (`apt install imagemagick`) — for VNC screenshots
- Linux with X11 (WSL2 with WSLg works; macOS needs XQuartz)
