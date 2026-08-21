#!/usr/bin/env bash
# Launch the Zeltro GUI from this source checkout.
#
# The canonical launcher, kept in the repo so every machine runs the same one.
# `~/scripts/zeltro-gui-dev.sh` on the workstation is a symlink to this file,
# and zeltro-sync.sh symlinks /usr/local/bin/zeltro-gui to it on the other
# machines — a second copy anywhere would drift.
#
# Finds its own checkout rather than hardcoding a path, so it works wherever
# the repo is cloned. Builds the TypeScript first so it always runs current
# source, then detaches so the terminal is free (and so closing the terminal
# does not kill the window).
set -uo pipefail

# `readlink -f` exists on macOS 13+ but not on older releases, where BSD
# readlink has no -f and prints nothing — which would resolve REPO to the
# filesystem root. Capability-checked so it costs nothing where -f works.
_resolve() {
    if readlink -f / >/dev/null 2>&1; then readlink -f "$1"
    else python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$1"
    fi
}

REPO="${ZELTRO_GUI_REPO:-$(cd "$(dirname "$(_resolve "${BASH_SOURCE[0]}")")/.." && pwd)}"
LOG=/tmp/zeltro-gui-dev.log
IS_MAC=0
[ "$(uname -s)" = Darwin ] && IS_MAC=1

# Launched from the menu there is no terminal to print to, so failures have to
# reach the desktop or they look like "clicking the icon does nothing".
fail() {
    echo "zeltro-gui: $1" >&2
    if [ "$IS_MAC" = 1 ]; then
        # macOS has no notify-send; osascript is always present.
        osascript -e "display notification \"$1\" with title \"Zeltro GUI\"" 2>/dev/null
    else
        command -v notify-send >/dev/null 2>&1 &&
            notify-send -u critical -i dialog-error "Zeltro GUI" "$1"
    fi
    exit 1
}

# npm is installed via nvm, which is set up in .bashrc. A .desktop launcher
# runs with a minimal environment and never sources it, so `npm` is missing
# when started from the menu even though it works fine from a terminal.
# Homebrew's bin is added by ~/.zprofile, which a GUI launch never sources —
# npm's shebang is `#!/usr/bin/env node`, so npm fails with a confusing
# "env: node: No such file or directory" rather than "npm not found".
[ "$IS_MAC" = 1 ] && [ -d /opt/homebrew/bin ] && export PATH="/opt/homebrew/bin:$PATH"

if ! command -v npm >/dev/null 2>&1; then
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    # shellcheck disable=SC1091
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
fi
if ! command -v npm >/dev/null 2>&1; then
    # nvm.sh not usable non-interactively; fall back to the newest installed node.
    NODE_BIN=$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)
    [ -n "$NODE_BIN" ] && PATH="$NODE_BIN:$PATH" && export PATH
fi
command -v npm >/dev/null 2>&1 || fail "npm not found (checked PATH and nvm)"

[ -d "$REPO" ] || fail "Source checkout not found at $REPO"
cd "$REPO" || fail "Cannot enter $REPO"

# Already running? Raise the existing window instead of starting a second copy
# that would fight over the same debug port and project state.
if pgrep -f "electron .*dist/main\.js" >/dev/null 2>&1; then
    if [ "$IS_MAC" = 1 ]; then
        osascript -e 'tell application "Electron" to activate' 2>/dev/null
    else
        command -v wmctrl >/dev/null 2>&1 && wmctrl -a "Zeltro - PHP Development Platform" 2>/dev/null
    fi
    echo "zeltro-gui: already running (raised existing window)"
    exit 0
fi

echo "zeltro-gui: building TypeScript..."
if ! npm run build-ts > "$LOG" 2>&1; then
    fail "TypeScript build failed — see $LOG"
fi

echo "zeltro-gui: starting..."
# setsid is a util-linux tool and does not exist on macOS; nohup plus a
# background job with disown achieves the same detachment there.
if [ "$IS_MAC" = 1 ]; then
    nohup npx electron dist/main.js >> "$LOG" 2>&1 < /dev/null &
else
    setsid nohup npx electron dist/main.js >> "$LOG" 2>&1 < /dev/null &
fi
disown 2>/dev/null || true

# Confirm it actually came up rather than reporting success on a launch that
# died immediately (a missing dependency, a broken display).
for _ in $(seq 1 20); do
    sleep 1
    pgrep -f "electron .*dist/main\.js" >/dev/null 2>&1 && { echo "zeltro-gui: running (log: $LOG)"; exit 0; }
done
fail "Did not start within 20s — see $LOG"
