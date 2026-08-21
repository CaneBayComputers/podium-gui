# Zeltro CLI Releases

This directory contains release assets and distribution files for different platforms.

## Directory Structure

```
releases/
├── linux/          # Linux distribution files (.deb packages)
├── macos/           # macOS distribution files (future)
└── windows/         # Windows distribution files (future)
```

## Distribution Methods

### Linux (Ubuntu/Debian)
- **Primary**: `.deb` package in `linux/`
- **Installation**: `sudo dpkg -i zeltro-cli_latest.deb`
- **Static filename**: Always `zeltro-cli_latest.deb` for consistent install instructions

### macOS
- **Primary**: Homebrew formula
- **Installation**: Download formula and `brew install --formula ./zeltro-cli.rb`
- **Dependencies**: Managed by Homebrew automatically

### Windows
- **Primary**: WSL2 + Linux `.deb` package
- **Installation**: Same as Linux within WSL2

## Release Process

1. **Build packages** for each platform
2. **Test installations** on target platforms  
3. **Update version numbers** in formulas/packages
4. **Create GitHub release** with all assets
5. **Update documentation** with new version info

## Files

- `homebrew/zeltro-cli.rb` - Homebrew formula for macOS
- `linux/` - Will contain `.deb` packages
- `macos/` - Reserved for future native macOS packages
- `windows/` - Reserved for future Windows installers
