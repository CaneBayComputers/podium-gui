#!/bin/bash

# Zeltro GUI Installer — Fedora / RHEL
#
# Installs the Zeltro CLI first if it is missing, then the desktop GUI. The GUI
# is a front end for the CLI and is useless without it, so it is never
# installable alone.

set -e

for arg in "$@"; do
    case $arg in
        --help)
            echo "Zeltro GUI Fedora Installer"
            echo ""
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --help           Show this help message"
            echo ""
            echo "Installs the Zeltro CLI first if it is not already present, then"
            echo "builds and installs the desktop GUI. Run from a local checkout to"
            echo "install that checkout instead of cloning."
            exit 0
            ;;
    esac
done

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

INSTALL_DIR="/usr/local/share/zeltro-gui"
BIN_DIR="/usr/local/bin"
GUI_REPO_URL="https://github.com/CaneBayComputers/zeltro-gui.git"
CLI_INSTALLER_URL="https://raw.githubusercontent.com/CaneBayComputers/zeltro-cli/master/install-fedora.sh"

# Electron bundles its own Node to RUN the app, but the build tooling does not.
# Playwright (the e2e harness) requires 20+, and node-gyp needs a modern
# toolchain to rebuild node-pty. Ubuntu 24.04 still ships 18, so checking that
# node merely EXISTS is not enough — the version is what matters.
NODE_MIN_MAJOR=20

echo -e "${BLUE}Zeltro GUI Installer${NC}"
echo "===================="

if ! pwd &>/dev/null; then
    echo "⚠️  Current directory is invalid, changing to home directory..."
    cd "$HOME" || cd /tmp
fi

# Detect a local checkout, preferring the directory this script lives in so
# running it by path from the parent (./zeltro-gui/install-ubuntu.sh) installs
# THAT checkout rather than silently cloning over the top of it. Under
# `curl | bash` there is no file on disk, so neither candidate matches and the
# clone path runs — which is correct for that install method.
SELF_DIR=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
    SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd -P)"
fi
CURRENT_DIR="$(pwd -P)"

LOCAL_REPO_DIR=""
for _candidate in "$SELF_DIR" "$CURRENT_DIR"; do
    if [[ -n "$_candidate" \
        && -f "$_candidate/package.json" \
        && -f "$_candidate/src/main.ts" \
        && -f "$_candidate/src/renderer.ts" ]]; then
        LOCAL_REPO_DIR="$_candidate"
        break
    fi
done

echo

if [[ $EUID -eq 0 ]]; then
   echo -e "${RED}Error: This script should not be run as root${NC}"
   echo "Please run as a regular user. The script will ask for sudo when needed."
   exit 1
fi

if ! command -v dnf &> /dev/null; then
    echo -e "${RED}Error: This installer requires Fedora/RHEL (dnf)${NC}"
    echo "Use install-ubuntu.sh, install-arch.sh or install-mac.sh instead."
    exit 1
fi

# Probe with `sudo -n` first: systems that grant passwordless sudo (cloud
# images, CI runners) usually ALSO carry a password-requiring rule, and plain
# `sudo -v` authenticates against every matching rule — so it prompts even
# though each individual command would run fine without a password.
if sudo -n true 2>/dev/null; then
    echo -e "${GREEN}✓ Passwordless sudo available${NC}"
else
    echo
    echo -e "${YELLOW}Zeltro needs sudo to install system packages.${NC}"
    echo -e "${YELLOW}You'll be asked for your password once — it won't be asked again during the install.${NC}"
    echo
    if ! sudo -v; then
        echo -e "${RED}Error: sudo access is required. Please run as a user with sudo privileges.${NC}"
        exit 1
    fi
fi
# `|| true` matters: set -e is inherited by this subshell, and `sudo -n -v`
# fails wherever a password-requiring sudoers rule coexists with NOPASSWD.
# Without it the keepalive dies instantly and the EXIT trap kills a dead PID.
( while true; do sudo -n -v 2>/dev/null || true; sleep 50; done ) &
SUDO_KEEPALIVE_PID=$!
# Preserve the real exit status — a bare `exit` here would return the status of
# `kill`, reporting failure after a fully successful install.
trap 'rc=$?; kill $SUDO_KEEPALIVE_PID 2>/dev/null || true; exit $rc' INT TERM EXIT

###############################
# Step 1: the CLI comes first
###############################
# The GUI shells out to `zeltro` for everything. Installing it without the CLI
# produces an app that opens and then fails on its first action, so bootstrap
# the CLI here rather than leaving the user to discover the dependency.
echo -e "${CYAN}Checking for Zeltro CLI...${NC}"

if command -v zeltro >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Zeltro CLI already installed${NC}"
else
    echo -e "${YELLOW}Zeltro CLI not found — installing it first.${NC}"

    # A sibling checkout is the common case for developers: repos/zeltro/
    # holding both zeltro-cli and zeltro-gui.
    CLI_LOCAL=""
    for _sibling in "$SELF_DIR/../zeltro-cli" "$CURRENT_DIR/../zeltro-cli"; do
        if [[ -n "$_sibling" && -f "$_sibling/install-fedora.sh" ]]; then
            CLI_LOCAL="$(cd "$_sibling" && pwd -P)"
            break
        fi
    done

    if [[ -n "$CLI_LOCAL" ]]; then
        echo -e "${BLUE}Using local CLI checkout:${NC} $CLI_LOCAL"
        ( cd "$CLI_LOCAL" && bash install-fedora.sh )
    else
        echo -e "${BLUE}Downloading the Zeltro CLI installer...${NC}"
        curl -fsSL "$CLI_INSTALLER_URL" | bash
    fi

    # PATH in this shell may predate the symlink the CLI installer just created.
    hash -r 2>/dev/null || true
    if ! command -v zeltro >/dev/null 2>&1 && [[ -x "$BIN_DIR/zeltro" ]]; then
        export PATH="$BIN_DIR:$PATH"
    fi

    if ! command -v zeltro >/dev/null 2>&1; then
        echo -e "${RED}Error: the Zeltro CLI still isn't available after installing it.${NC}"
        echo "Install it manually, then re-run this script:"
        echo "  https://github.com/CaneBayComputers/zeltro-cli"
        exit 1
    fi
    echo -e "${GREEN}✓ Zeltro CLI installed${NC}"
fi

###############################
# Step 2: build dependencies
###############################
echo -e "${CYAN}Installing build dependencies...${NC}"

# xdotool/wmctrl are optional: they let the GUI open behind other windows when
# launched with --no-focus. Without them it still opens unfocused.
sudo dnf install -y \
    git curl ca-certificates \
    gcc-c++ make python3 \
    libX11-devel libxkbfile-devel libsecret-devel \
    xdotool wmctrl

###############################
# Step 3: Node.js
###############################
NODE_OK=0
if command -v node >/dev/null 2>&1; then
    NODE_MAJOR="$(node -v | sed 's/^v//; s/\..*//')"
    if [[ "$NODE_MAJOR" =~ ^[0-9]+$ ]] && (( NODE_MAJOR >= NODE_MIN_MAJOR )); then
        NODE_OK=1
        echo -e "${GREEN}✓ Node.js $(node -v) meets the minimum (v${NODE_MIN_MAJOR})${NC}"
    else
        echo -e "${YELLOW}Node.js $(node -v) is older than v${NODE_MIN_MAJOR} — upgrading.${NC}"
    fi
fi

if [[ "$NODE_OK" -eq 0 ]]; then
    echo -e "${BLUE}Installing Node.js ${NODE_MIN_MAJOR} LTS...${NC}"
    # Fedora ships current Node in its own repos; prefer that over NodeSource so
    # dnf keeps managing it. Fall back to NodeSource on older releases.
    if ! sudo dnf install -y "nodejs${NODE_MIN_MAJOR}" 2>/dev/null && \
       ! sudo dnf install -y nodejs npm 2>/dev/null; then
        curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MIN_MAJOR}.x" | sudo -E bash -
        sudo dnf install -y nodejs
    fi
    echo -e "${GREEN}✓ Node.js $(node -v)${NC}"
fi

###############################
# Step 4: place the GUI
###############################
if [[ -n "$LOCAL_REPO_DIR" ]]; then
    echo -e "${GREEN}✓ Detected existing Zeltro GUI checkout${NC}"
    echo -e "${CYAN}Using local directory:${NC} $LOCAL_REPO_DIR"

    if [[ -e "$INSTALL_DIR" && ! -L "$INSTALL_DIR" ]]; then
        echo -e "${YELLOW}Replacing the previous installation directory...${NC}"
        sudo rm -rf "$INSTALL_DIR"
    fi
    sudo rm -f "$INSTALL_DIR"
    sudo mkdir -p "$(dirname "$INSTALL_DIR")"
    sudo ln -sfn "$LOCAL_REPO_DIR" "$INSTALL_DIR"
    APP_DIR="$LOCAL_REPO_DIR"
else
    echo -e "${CYAN}Installing Zeltro GUI...${NC}"
    if [[ -d "$INSTALL_DIR/.git" ]]; then
        echo -e "${BLUE}Updating existing installation...${NC}"
        sudo git -C "$INSTALL_DIR" fetch --all --quiet
        sudo git -C "$INSTALL_DIR" reset --hard origin/HEAD --quiet
    else
        sudo rm -rf "$INSTALL_DIR"
        sudo mkdir -p "$(dirname "$INSTALL_DIR")"
        sudo git clone "$GUI_REPO_URL" "$INSTALL_DIR"
    fi
    # npm writes into the tree, so it has to be owned by the installing user.
    sudo chown -R "$(whoami):$(id -gn)" "$INSTALL_DIR"
    APP_DIR="$INSTALL_DIR"
fi

###############################
# Step 5: build
###############################
echo -e "${CYAN}Installing npm dependencies (this takes a few minutes)...${NC}"
cd "$APP_DIR"

# Dev dependencies are required: TypeScript compiles the app and Electron is
# what runs it. Playwright's browser download is skipped — the e2e harness
# drives Electron directly and never needs Chromium.
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install

echo -e "${BLUE}Compiling TypeScript...${NC}"
npm run build-ts

# node-pty is native and must match Electron's ABI, not the system Node's.
# Without this the embedded build terminal fails to load at runtime. It is not
# fatal — the GUI degrades to "run zeltro ai yourself" — so a failure here is a
# warning rather than an abort.
echo -e "${BLUE}Rebuilding native modules for Electron...${NC}"
if ! npx --yes @electron/rebuild -f -w node-pty; then
    echo -e "${YELLOW}⚠ Could not rebuild node-pty for Electron.${NC}"
    echo -e "${YELLOW}  The GUI will work, but the embedded build terminal will be unavailable.${NC}"
fi

###############################
# Step 6: launcher
###############################
echo -e "${CYAN}Creating launcher...${NC}"
sudo tee "$BIN_DIR/zeltro-gui" >/dev/null << LAUNCHER
#!/bin/bash
# Zeltro GUI launcher.
#   --no-focus  open unfocused and behind other windows (background launches)
APP_DIR="$INSTALL_DIR"
cd "\$APP_DIR" || exit 1
exec "\$APP_DIR/node_modules/.bin/electron" "\$APP_DIR/dist/main.js" "\$@"
LAUNCHER
sudo chmod +x "$BIN_DIR/zeltro-gui"

###############################
# Step 7: desktop entry
###############################
echo -e "${CYAN}Installing desktop entry...${NC}"
sudo tee /usr/share/applications/zeltro-gui.desktop >/dev/null << 'DESKTOP'
[Desktop Entry]
Version=1.0
Type=Application
Name=Zeltro
GenericName=PHP Development Platform
Comment=Manage Zeltro projects, services and installs
Exec=zeltro-gui
Icon=zeltro-gui
Terminal=false
StartupNotify=true
StartupWMClass=Zeltro
Categories=Development;IDE;
Keywords=php;laravel;wordpress;docker;development;zeltro;
DESKTOP

for size in 16 32 48 64 128 256; do
    icon="$APP_DIR/packaging/debian-package/usr/share/icons/hicolor/${size}x${size}/apps/zeltro-gui.png"
    if [[ -f "$icon" ]]; then
        sudo install -Dm644 "$icon" "/usr/share/icons/hicolor/${size}x${size}/apps/zeltro-gui.png"
    fi
done
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    sudo gtk-update-icon-cache -f /usr/share/icons/hicolor 2>/dev/null || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then
    sudo update-desktop-database /usr/share/applications 2>/dev/null || true
fi

###############################
# Done
###############################
echo
echo -e "${GREEN}🎉 Installation Complete!${NC}"
echo "=========================="
echo -e "${GREEN}✓ Zeltro GUI installed${NC}"
echo

if [[ ! -f /etc/zeltro-cli/.env ]]; then
    echo -e "${CYAN}🚀 Next Steps:${NC}"
    echo -e "  1. Run ${BLUE}zeltro configure${NC} to set up your environment"
    echo -e "     (or just launch the GUI — it will walk you through it)"
    echo -e "  2. Launch it: ${BLUE}zeltro-gui${NC}, or find ${BLUE}Zeltro${NC} in your applications menu"
else
    echo -e "${CYAN}🚀 Launch it:${NC}"
    echo -e "  ${BLUE}zeltro-gui${NC}, or find ${BLUE}Zeltro${NC} in your applications menu"
fi

echo
echo -e "${CYAN}🗑️  To uninstall:${NC}"
echo -e "  ${BLUE}sudo rm -rf $INSTALL_DIR $BIN_DIR/zeltro-gui /usr/share/applications/zeltro-gui.desktop${NC}"
echo
