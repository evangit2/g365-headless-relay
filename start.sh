#!/bin/bash
# G365 Copilot Relay - Start script
# Starts Xvfb + relay + x11vnc + noVNC

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE_DIR="$SCRIPT_DIR/profile"
LOG_DIR="/tmp"
RELAY_PORT=8765
UI_PORT=8767

cd "$SCRIPT_DIR"

echo "=== G365 Copilot Relay ==="
echo "Profile: $PROFILE_DIR"
echo ""

# Kill any existing relay processes on our ports
echo "Cleaning up old processes..."
lsof -ti:"$RELAY_PORT" | xargs kill -9 2>/dev/null
lsof -ti:"$UI_PORT" | xargs kill -9 2>/dev/null
pkill -f "node.*index.js" 2>/dev/null
sleep 1

# Clear any singleton locks from previous crashes
rm -f "$PROFILE_DIR"/SingletonLock "$PROFILE_DIR"/SingletonCookie "$PROFILE_DIR"/SingletonSocket* 2>/dev/null

# Start Xvfb
if ! pgrep -x Xvfb >/dev/null; then
    echo "Starting Xvfb..."
    Xvfb :99 -screen 0 1280x720x24 -ac +extension GLX +render -noreset \
        > "$LOG_DIR/xvfb.log" 2>&1 &
    sleep 2
fi

# Start x11vnc (for remote viewing if needed)
if ! pgrep -x x11vnc >/dev/null; then
    echo "Starting x11vnc on :5900..."
    x11vnc -display :99 -nopw -forever -shared -listen 0.0.0.0 -rfbport 5900 \
        > "$LOG_DIR/x11vnc.log" 2>&1 &
fi

# Start noVNC
if ! pgrep -f websockify >/dev/null; then
    echo "Starting noVNC on :6080..."
    websockify --web=/usr/share/novnc --cert=none 6080 localhost:5900 \
        > "$LOG_DIR/novnc.log" 2>&1 &
fi

# Start the relay
echo "Starting relay..."
DISPLAY=:99 node index.js --headless --ui-port "$UI_PORT" \
    > "$LOG_DIR/relay.log" 2>> "$LOG_DIR/relay.log" &
RELAY_PID=$!
echo "Relay PID: $RELAY_PID"

echo ""
echo "Relay WS:    ws://127.0.0.1:$RELAY_PORT"
echo "Chat UI:     http://127.0.0.1:$UI_PORT"
echo "VNC remote:  http://$(hostname -I | awk '{print $1}'):6080/vnc.html"
echo ""

# Quick auth check after a few seconds
sleep 3
echo ""
echo "Checking auth status (wait ~10s)..."
if command -v node >/dev/null 2>&1; then
    # Try running auth-check.js if node_modules exist
    if [[ -d "$SCRIPT_DIR/node_modules" ]]; then
        (sleep 5 && node "$SCRIPT_DIR/tools/auth-check.js" --json > /tmp/auth_check_result.json 2>/dev/null) &
        (sleep 12 && {
            if [[ -f /tmp/auth_check_result.json ]]; then
                if grep -q '"ok":true' /tmp/auth_check_result.json 2>/dev/null; then
                    echo "✅ Auth looks healthy (check passed)"
                else
                    echo "⚠️  Auth check failed — you may need to sign in via VNC"
                    echo "   Open: http://$(hostname -I | awk '{print $1}'):6080/vnc.html"
                    echo "   Then run: ./tools/open-signin.sh"
                fi
            fi
        }) &
    fi
fi

echo ""
echo "To stop: kill $RELAY_PID"
