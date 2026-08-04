#!/bin/bash
# Runs after the .deb / .rpm / .pacman package is installed.
#
# The GUI is a front end for Podium CLI and is useless without it, so a package
# install has to do what the shell installers do: put the CLI in place first if
# it is missing. Doing nothing here would produce an app that launches and then
# fails on its first action.
set -e

CLI_INSTALLERS="https://raw.githubusercontent.com/CaneBayComputers/podium-cli/master"

# Do NOT rely on `command -v` alone. Debian policy runs maintainer scripts with
# a PATH that excludes /usr/local/bin — which is exactly where the CLI installs —
# so the probe reports "missing" on a machine that has it, and the package then
# tells the user to install something they already have.
if command -v podium >/dev/null 2>&1 \
   || [ -x /usr/local/bin/podium ] \
   || [ -x /usr/bin/podium ] \
   || [ -x /opt/podium-cli/src/podium ]; then
    exit 0
fi

echo "Podium CLI not found — installing it (the GUI requires it)."

# Pick the installer matching this machine rather than guessing from the package
# format: a .deb can be installed on a machine whose package manager is not apt.
if   command -v apt-get >/dev/null 2>&1; then SCRIPT=install-ubuntu.sh
elif command -v dnf     >/dev/null 2>&1; then SCRIPT=install-fedora.sh
elif command -v pacman  >/dev/null 2>&1; then SCRIPT=install-arch.sh
else
    echo "Could not identify the package manager. Install Podium CLI manually:"
    echo "  https://github.com/CaneBayComputers/podium-cli"
    exit 0   # Do not fail the package install over this; the GUI will say so too.
fi

# The CLI installer needs a real user for sudo and $HOME, not root mid-install.
# When the package manager runs us as root, defer instead of installing wrong.
if [ "$(id -u)" = "0" ] && [ -z "${SUDO_USER:-}" ]; then
    echo "Run this once as your normal user to finish setup:"
    echo "  curl -fsSL $CLI_INSTALLERS/$SCRIPT | bash"
    exit 0
fi

RUN_AS="${SUDO_USER:-$(id -un)}"
sudo -u "$RUN_AS" bash -c "curl -fsSL '$CLI_INSTALLERS/$SCRIPT' | bash" || {
    echo "Podium CLI install did not complete. Run it manually:"
    echo "  curl -fsSL $CLI_INSTALLERS/$SCRIPT | bash"
}
exit 0
