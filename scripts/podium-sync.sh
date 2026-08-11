#!/usr/bin/env bash
# Keep this machine's Podium CLI and GUI current with the workstation `shawn`.
#
# SOURCE-BASED. Both are checkouts here; an update is a git pull plus, for the
# GUI, a tsc build. The previous version built a 74MB deb/rpm/pacman on the
# workstation and shipped one per distro — three packaging formats and a zstd
# repack to deliver a TypeScript app the repo already contained. Nothing is
# packaged now; /usr/local/bin symlinks point straight at the checkouts.
#
# Pulls over the LAN rather than GitHub: faster, works when GitHub is
# rate-limited, and picks up work that has not been pushed yet. `shawn` is the
# source of truth; this machine is never the one being edited, so the pull is a
# hard reset and local edits here are discarded on purpose.
#
# Runs on the dell-laptop's Mint, Fedora and Arch installs. Distro-agnostic:
# all it needs from the system is git, node/npm and a working electron, which
# the Podium installers already set up.
set -uo pipefail

SRC_HOST=shawn
KEY=/home/shawn/.ssh/id_rsa
SSH="ssh -i $KEY -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes"
BRANCH=dev

CLI_REPO=""
GUI_REPO=/home/shawn/repos/podium/podium-gui

log() { echo "[podium-sync] $*"; }

# This file ships inside the GUI repo, so it is now present on the workstation
# as well — where running it would hard-reset the source of truth to itself and
# discard uncommitted work. Refuse, by name.
if [ "$(hostname)" = "$SRC_HOST" ]; then
    log "this IS $SRC_HOST — refusing to sync a machine to itself"
    exit 1
fi

$SSH shawn@$SRC_HOST true 2>/dev/null || { log "workstation unreachable, skipping"; exit 0; }

# Pull a checkout to the tip of `local/$BRANCH`. Prints the transition so the
# journal shows what actually moved rather than just "ran". Returns 0 when
# something changed, 1 when it was already current or the pull failed.
pull_repo() {
    local repo=$1 label=$2
    [ -d "$repo/.git" ] || { log "$label: no checkout at $repo"; return 1; }

    local before after
    before=$(git -C "$repo" rev-parse --short HEAD 2>/dev/null)
    git -C "$repo" fetch -q local 2>/dev/null || { log "$label: fetch failed"; return 1; }
    git -C "$repo" reset -q --hard "local/$BRANCH" 2>/dev/null || { log "$label: reset failed"; return 1; }
    after=$(git -C "$repo" rev-parse --short HEAD 2>/dev/null)

    # A dev checkout under /home must stay owned by the user, not root — this
    # runs from a system timer.
    case "$repo" in /home/*) chown -R 1000:1000 "$repo" 2>/dev/null;; esac

    [ "$before" = "$after" ] && { log "$label already current ($after)"; return 1; }
    log "$label $before -> $after"
    return 0
}

# --- CLI -------------------------------------------------------------------
for R in /usr/local/share/podium-cli /home/shawn/repos/podium/podium-cli; do
    [ -d "$R/.git" ] || continue
    CLI_REPO=$R
    pull_repo "$R" "CLI"
    break
done
[ -n "$CLI_REPO" ] || log "CLI: no checkout found"

# `podium` must resolve for a .desktop launch too, which does not inherit
# /usr/local/bin from a login shell's PATH — hence both locations.
if [ -n "$CLI_REPO" ] && [ -x "$CLI_REPO/src/podium" ]; then
    # Compare RESOLVED against RESOLVED. /usr/local/share/podium-cli is itself a
    # symlink on some installs, so readlink -f on the link resolved further than
    # the literal target string — the guard never matched and every run relinked
    # and logged "linked ...", claiming a change it had not made.
    want=$(readlink -f "$CLI_REPO/src/podium")
    for link in /usr/local/bin/podium /usr/bin/podium; do
        [ "$(readlink -f "$link" 2>/dev/null)" = "$want" ] && continue
        ln -sfn "$CLI_REPO/src/podium" "$link" && log "linked $link -> $CLI_REPO/src/podium"
    done
fi

# --- GUI -------------------------------------------------------------------
if [ ! -d "$GUI_REPO/.git" ]; then
    log "GUI: no checkout at $GUI_REPO"
    exit 0
fi

# Note the dependency set BEFORE pulling, so `npm install` runs only when it
# has something to do — it is minutes; the tsc build is seconds.
LOCK_BEFORE=$(sha256sum "$GUI_REPO/package-lock.json" 2>/dev/null | cut -d' ' -f1)
GUI_CHANGED=1
pull_repo "$GUI_REPO" "GUI" && GUI_CHANGED=0
LOCK_AFTER=$(sha256sum "$GUI_REPO/package-lock.json" 2>/dev/null | cut -d' ' -f1)

# npm lives under nvm, which a system timer's environment does not have.
if ! command -v npm >/dev/null 2>&1; then
    NODE_BIN=$(ls -d /home/shawn/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)
    [ -n "$NODE_BIN" ] && export PATH="$NODE_BIN:$PATH"
fi
command -v npm >/dev/null 2>&1 || { log "GUI: npm not found, cannot build"; exit 0; }

# Build as the user, not root: a root-owned node_modules or dist breaks the
# next interactive `npm run dev` in a way that is annoying to unpick.
run_as_user() { su - shawn -c "cd '$GUI_REPO' && export PATH='$PATH' && $1"; }

if [ "$LOCK_BEFORE" != "$LOCK_AFTER" ] || [ ! -d "$GUI_REPO/node_modules" ]; then
    log "GUI: dependencies changed, installing"
    run_as_user "npm install --no-audit --no-fund" >/dev/null 2>&1 || log "GUI: npm install failed"
fi

if [ "$GUI_CHANGED" -eq 0 ] || [ ! -d "$GUI_REPO/dist" ]; then
    if run_as_user "npm run build-ts" >/dev/null 2>&1; then
        log "GUI: built"
    else
        log "GUI: TypeScript build FAILED"
        exit 1
    fi
fi

# node-pty is native and has to match Electron's ABI, not the system Node's.
# Test that it actually LOADS rather than that npm exited 0 — a mismatched
# build installs perfectly and then fails at the point a terminal is opened,
# which is the only place anyone would ever notice.
pty_ok() { run_as_user "ELECTRON_RUN_AS_NODE=1 npx electron -e \"require('node-pty')\"" >/dev/null 2>&1; }

if ! pty_ok; then
    log "GUI: node-pty does not load under Electron, rebuilding"
    run_as_user "npx --yes @electron/rebuild -f -w node-pty" >/dev/null 2>&1
    if pty_ok; then
        log "GUI: node-pty rebuilt"
    else
        # Not fatal: the app degrades to "run the command yourself" rather than
        # failing to start. Say so and carry on.
        log "GUI: node-pty STILL failing — embedded terminals will not work"
    fi
fi

# --- Self-update -----------------------------------------------------------
# This script lives in the GUI repo, so a pull brings its own next version.
# Without this, every future change to it would need an SSH session to each
# machine — the manual step this file exists to remove.
#
# It installs for the NEXT run rather than re-execing now. Re-execing would
# repeat the pull, which would then report "already current" and skip the build
# it was re-execed to perform. One cycle's delay on a timer costs nothing.
SELF_SRC=$GUI_REPO/scripts/podium-sync.sh
SELF_DST=$(readlink -f "$0")
if [ -f "$SELF_SRC" ] && [ "$SELF_SRC" != "$SELF_DST" ] && ! cmp -s "$SELF_SRC" "$SELF_DST"; then
    install -m 755 "$SELF_SRC" "$SELF_DST" &&
        log "sync script updated; the new one runs next cycle"
fi

# --- Launcher --------------------------------------------------------------
# Symlinked into the checkout, so a pull updates the launcher itself too.
LAUNCHER=$GUI_REPO/scripts/podium-gui-dev.sh
if [ -f "$LAUNCHER" ]; then
    chmod +x "$LAUNCHER" 2>/dev/null
    if [ "$(readlink -f /usr/local/bin/podium-gui 2>/dev/null)" != "$LAUNCHER" ]; then
        ln -sfn "$LAUNCHER" /usr/local/bin/podium-gui && log "linked /usr/local/bin/podium-gui"
    fi
fi

DESKTOP_SRC=$GUI_REPO/scripts/podium-gui.desktop
DESKTOP_DST=/usr/share/applications/podium-gui-source.desktop
if [ -f "$DESKTOP_SRC" ] && ! cmp -s "$DESKTOP_SRC" "$DESKTOP_DST"; then
    install -m 644 "$DESKTOP_SRC" "$DESKTOP_DST" && log "installed menu entry"
    update-desktop-database /usr/share/applications 2>/dev/null || true
fi

log "done"
