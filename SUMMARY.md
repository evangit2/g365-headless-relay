# M365 Copilot Relay

Node.js off-screen Chromium bridge for Microsoft 365 Copilot chat. **No access tokens are stored** — the browser session is the auth.

## How it works

1. Chromium opens `m365.cloud.microsoft/chat` with your persistent profile
2. A bridge script is injected that intercepts the page's own substrate WebSocket connections
3. Clients connect to `ws://127.0.0.1:8765` — the relay forwards messages through the browser
4. The browser's authenticated session handles everything — no keys extracted or cached

## Quick start

```
npm install
debug.cmd       # first time — sign in (visible browser)
start.cmd       # off-screen relay
```

## WebSocket API

```
ws://127.0.0.1:8765

→ {"type":"new","model":"gpt-5.5-think-deeper"}
→ {"type":"chat","text":"hello"}
← {"type":"delta","text":"streaming..."}
← {"type":"done"}
```

## Models

- `gpt-5.5-think-deeper` — tone ThinkDeep
- `gpt-5.5-quick` — tone Balanced

## Files

| File | Role |
|------|------|
| `index.js` | CLI, browser launch, server orchestration |
| `lib/browser.js` | Chromium launcher (headed, off-screen mode) |
| `lib/bridge.js` | Injected page script — substrate WS relay |
| `lib/server.js` | WS server — per-client page, poll for deltas |
| `start.cmd` | Off-screen relay |
| `debug.cmd` | Visible browser for login |
