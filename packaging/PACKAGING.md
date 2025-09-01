# Podium CLI Packaging

This directory contains the infrastructure for building Debian packages (.deb) for Podium CLI.

## Building a .deb Package

### Prerequisites
```bash
sudo apt install dpkg-dev
```

### Build Process
```bash
./build-deb.sh
```

This creates `podium-cli_1.0.0_all.deb` (or current version).

## Package Structure

```
debian-package/
├── DEBIAN/
│   ├── control          # Package metadata
│   ├── postinst         # Post-installation script
│   └── prerm            # Pre-removal script
└── usr/
    ├── local/
    │   └── share/
    │       └── podium-cli/    # Application files
    └── bin/
        └── podium             # Symlink to application
```

## Installation

### From .deb Package
```bash
sudo dpkg -i podium-cli_1.0.0_all.deb
sudo apt-get install -f  # Fix any missing dependencies
```

### Manual Installation
```bash
sudo apt install docker.io git curl
sudo dpkg -i podium-cli_1.0.0_all.deb
```

## Usage After Installation

```bash
# Get help
podium help

# Create a new project
podium new

# Start a project
podium up myproject

# Check status
podium status
```

## Uninstallation

```bash
sudo apt remove podium-cli
```

This will:
- Stop all running Podium services
- Remove the podium command
- Clean up installation files
- Preserve project data (can be removed manually)

## Version Management

To update the version:
1. Edit `debian-package/DEBIAN/control`
2. Update the `Version:` field
3. Run `./build-deb.sh`

## Distribution

The generated `.deb` file can be:
- Uploaded to GitHub Releases
- Added to an APT repository
- Distributed directly to users

## GitHub Actions Integration

To automatically build packages on releases, add this to `.github/workflows/build-deb.yml`:

```yaml
name: Build DEB Package
on:
  release:
    types: [published]
jobs:
  build-deb:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Build DEB package
        run: ./build-deb.sh
      - name: Upload to Release
        uses: softprops/action-gh-release@v1
        with:
          files: podium-cli_*.deb
```
