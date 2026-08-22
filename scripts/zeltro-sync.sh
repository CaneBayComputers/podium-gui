#!/usr/bin/env bash
# Keep this machine's Zeltro CLI and GUI current with the workstation `shawn`.
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
# the Zeltro installers already set up.
set -uo pipefail

SRC_HOST=shawn
KEY=/home/shawn/.ssh/id_rsa
SSH="ssh -i $KEY -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes"
BRANCH=dev

CLI_REPO=""

# Platform. macOS differs in enough places that guessing is worse than asking:
# the home directory root, the uid/gid to chown to, whether /usr/local/bin even
# exists, and whether desktop entries are a concept at all.
case "$(uname -s)" in
    Darwin)
        PLATFORM=mac
        HOME_DIR=/Users/shawn
        # 501:staff is the first user on macOS; 1000:1000 is the Linux
        # equivalent and does not exist there.
        OWNER=501:staff
        # /usr/local/bin is absent on a stock Apple Silicon machine and needs
        # sudo to create. /opt/homebrew/bin already exists, is user-writable,
        # and is on the interactive PATH.
        BIN_DIR=/opt/homebrew/bin
        ;;
    *)
        PLATFORM=linux
        HOME_DIR=/home/shawn
        OWNER=1000:1000
        BIN_DIR=/usr/local/bin
        ;;
esac

GUI_REPO=$HOME_DIR/repos/zeltro/zeltro-gui

log() { echo "[zeltro-sync] $*"; }

# The Mac rig has /sbin/sha256sum, but that is not standard on macOS — the
# portable spelling is `shasum -a 256`. Used to notice whether
# package-lock.json moved; if it silently returned nothing, both sides would
# compare equal and `npm install` would never run on a dependency change.
file_hash() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" 2>/dev/null | cut -d' ' -f1
    else
        shasum -a 256 "$1" 2>/dev/null | cut -d' ' -f1
    fi
}

# `readlink -f` exists on macOS 13+ (verified on 26.6.1) but NOT on older
# releases, where BSD readlink has no -f and silently prints nothing. Every
# symlink guard here compares resolved paths, so without a fallback they would
# all compare "" to "" and match wrongly. Capability-checked, not OS-checked.
resolve_path() {
    if readlink -f / >/dev/null 2>&1; then
        readlink -f "$1" 2>/dev/null
    else
        python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$1" 2>/dev/null
    fi
}

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
    case "$repo" in "$HOME_DIR"/*) chown -R "$OWNER" "$repo" 2>/dev/null;; esac

    [ "$before" = "$after" ] && { log "$label already current ($after)"; return 1; }
    log "$label $before -> $after"
    return 0
}

# --- CLI -------------------------------------------------------------------
for R in /usr/local/share/zeltro-cli "$HOME_DIR/repos/zeltro/zeltro-cli"; do
    [ -d "$R/.git" ] || continue
    CLI_REPO=$R
    pull_repo "$R" "CLI"
    break
done
[ -n "$CLI_REPO" ] || log "CLI: no checkout found"

# `zeltro` must resolve for a .desktop launch too, which does not inherit
# /usr/local/bin from a login shell's PATH — hence both locations.
if [ -n "$CLI_REPO" ] && [ -x "$CLI_REPO/src/zeltro" ]; then
    # Compare RESOLVED against RESOLVED. /usr/local/share/zeltro-cli is itself a
    # symlink on some installs, so readlink -f on the link resolved further than
    # the literal target string — the guard never matched and every run relinked
    # and logged "linked ...", claiming a change it had not made.
    want=$(resolve_path "$CLI_REPO/src/zeltro")
    # /usr/bin is protected by SIP on macOS and cannot be written to at all.
    LINK_TARGETS="/usr/local/bin/zeltro /usr/bin/zeltro"
    [ "$PLATFORM" = mac ] && LINK_TARGETS="/usr/local/bin/zeltro"
    for link in $LINK_TARGETS; do
        [ "$(resolve_path "$link")" = "$want" ] && continue
        ln -sfn "$CLI_REPO/src/zeltro" "$link" && log "linked $link -> $CLI_REPO/src/zeltro"
    done
fi

# --- GUI -------------------------------------------------------------------
if [ ! -d "$GUI_REPO/.git" ]; then
    log "GUI: no checkout at $GUI_REPO"
    exit 0
fi

# Note the dependency set BEFORE pulling, so `npm install` runs only when it
# has something to do — it is minutes; the tsc build is seconds.
LOCK_BEFORE=$(file_hash "$GUI_REPO/package-lock.json")
GUI_CHANGED=1
pull_repo "$GUI_REPO" "GUI" && GUI_CHANGED=0
LOCK_AFTER=$(file_hash "$GUI_REPO/package-lock.json")

# npm lives under nvm, which a system timer's environment does not have.
if ! command -v npm >/dev/null 2>&1; then
    NODE_BIN=$(ls -d "$HOME_DIR"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)
    [ -n "$NODE_BIN" ] && export PATH="$NODE_BIN:$PATH"
fi
# Homebrew's bin is added by ~/.zprofile, which a launchd job or a
# non-interactive shell never sources — the same trap that made the CLI session
# report Homebrew as missing when it was installed.
[ "$PLATFORM" = mac ] && [ -d /opt/homebrew/bin ] && export PATH="/opt/homebrew/bin:$PATH"
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
SELF_SRC=$GUI_REPO/scripts/zeltro-sync.sh
SELF_DST=$(readlink -f "$0")
if [ -f "$SELF_SRC" ] && [ "$SELF_SRC" != "$SELF_DST" ] && ! cmp -s "$SELF_SRC" "$SELF_DST"; then
    install -m 755 "$SELF_SRC" "$SELF_DST" &&
        log "sync script updated; the new one runs next cycle"
fi

# --- Launcher --------------------------------------------------------------
# Symlinked into the checkout, so a pull updates the launcher itself too.
LAUNCHER=$GUI_REPO/scripts/zeltro-gui-dev.sh
if [ -f "$LAUNCHER" ]; then
    chmod +x "$LAUNCHER" 2>/dev/null
    if [ "$(resolve_path "$BIN_DIR/zeltro-gui")" != "$LAUNCHER" ]; then
        ln -sfn "$LAUNCHER" "$BIN_DIR/zeltro-gui" && log "linked $BIN_DIR/zeltro-gui"
    fi
fi

# Generated, not copied. The template carries `Icon=zeltro-gui`, a theme-name
# lookup that only resolved while the deb was installed — and this script
# removes that package, so the menu entry lost its icon. A .desktop cannot
# compute a path, so substitute the real one from wherever the repo actually is.
# Shell aliases, matching the workstation: `pgui` and `zeltro-gui-run`. Kept out
# of the `zeltro-gui` name, which already cd's into the repo.
#
# Before the desktop-entry section, which is Linux-only — the aliases are just
# as useful on macOS, where they are the ONLY way in, there being no menu entry.
# macOS defaults to zsh and has no ~/.bash_aliases.
if [ "$PLATFORM" = mac ]; then
    ALIASES=$HOME_DIR/.zshrc
    [ -f "$ALIASES" ] || : > "$ALIASES"
else
    ALIASES=$HOME_DIR/.bash_aliases
fi
if [ -f "$ALIASES" ] && ! grep -q "alias pgui=" "$ALIASES" 2>/dev/null; then
    cat >> "$ALIASES" <<ALIASEOF

# Launch the Zeltro GUI from the source checkout (builds first, then detaches).
# Deliberately not called \`zeltro-gui\`, which already cd's into the repo.
alias zeltro-gui-run='$BIN_DIR/zeltro-gui'
alias pgui='$BIN_DIR/zeltro-gui'
ALIASEOF
    chown "$OWNER" "$ALIASES" 2>/dev/null
    log "added pgui / zeltro-gui-run aliases to $(basename "$ALIASES")"
fi

# Desktop entries are a freedesktop.org concept; macOS has no equivalent and
# the app is launched by its command or a .app bundle instead.
if [ "$PLATFORM" = mac ]; then
    log "done"
    exit 0
fi

DESKTOP_SRC=$GUI_REPO/scripts/zeltro-gui.desktop
DESKTOP_DST=/usr/share/applications/zeltro-gui-source.desktop
if [ -f "$DESKTOP_SRC" ]; then
    ICON=$GUI_REPO/packaging/icons/256x256.png
    TMP_DESKTOP=$(mktemp)
    if [ -f "$ICON" ]; then
        sed "s|^Icon=.*|Icon=$ICON|" "$DESKTOP_SRC" > "$TMP_DESKTOP"
    else
        cp "$DESKTOP_SRC" "$TMP_DESKTOP"
    fi
    if ! cmp -s "$TMP_DESKTOP" "$DESKTOP_DST"; then
        install -m 644 "$TMP_DESKTOP" "$DESKTOP_DST" && log "installed menu entry"
        update-desktop-database /usr/share/applications 2>/dev/null || true
    fi
    rm -f "$TMP_DESKTOP"
fi


log "done"
