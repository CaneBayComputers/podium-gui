#!/bin/bash
set -e

# Mac installer script for Podium GUI
echo "🚀 Installing Podium GUI for macOS..."

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   echo "❌ This script should not be run as root"
   exit 1
fi

# Install Podium CLI if not already installed
if ! command -v podium &> /dev/null; then
    echo "📦 Installing Podium CLI dependency..."
    echo "This will install Docker, Node.js, and other required packages via Homebrew..."
    curl -fsSL https://raw.githubusercontent.com/CaneBayComputers/podium-cli/master/install-mac.sh | bash
else
    echo "✅ Podium CLI is already installed"
fi

# Verify Podium CLI installation
if ! command -v podium &> /dev/null; then
    echo "❌ Podium CLI installation failed"
    exit 1
fi

# Install GUI application
echo "📦 Installing Podium GUI..."

# Create application directory
APP_DIR="/Applications/Podium GUI.app"
if [[ -d "$APP_DIR" ]]; then
    echo "🗑️  Removing existing installation..."
    rm -rf "$APP_DIR"
fi

# Create app bundle structure
mkdir -p "$APP_DIR/Contents/MacOS"
mkdir -p "$APP_DIR/Contents/Resources"

# Copy application files (assuming they're in the current directory)
cp -r . "$APP_DIR/Contents/Resources/"

# Create Info.plist
cat > "$APP_DIR/Contents/Info.plist" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>podium-gui</string>
    <key>CFBundleIdentifier</key>
    <string>com.canebaycomputers.podium-gui</string>
    <key>CFBundleName</key>
    <string>Podium GUI</string>
    <key>CFBundleDisplayName</key>
    <string>Podium GUI</string>
    <key>CFBundleVersion</key>
    <string>1.0.0</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleSignature</key>
    <string>????</string>
    <key>LSMinimumSystemVersion</key>
    <string>10.14</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
EOF

# Create executable wrapper script
cat > "$APP_DIR/Contents/MacOS/podium-gui" << 'EOF'
#!/bin/bash
cd "$(dirname "$0")/../Resources"
if command -v electron &> /dev/null; then
    electron dist/main.js "$@"
elif command -v npx &> /dev/null; then
    npx electron dist/main.js "$@"
else
    echo "❌ Electron not found. Please install Node.js and run: npm install -g electron"
    exit 1
fi
EOF

chmod +x "$APP_DIR/Contents/MacOS/podium-gui"

# Install Node dependencies if needed
cd "$APP_DIR/Contents/Resources"
if [[ -f "package.json" && ! -d "node_modules" ]]; then
    echo "📦 Installing Node.js dependencies..."
    npm install --production
fi

# Create command line alias
echo "🔗 Creating command line alias..."
mkdir -p /usr/local/bin
ln -sf "$APP_DIR/Contents/MacOS/podium-gui" /usr/local/bin/podium-gui 2>/dev/null || \
    sudo ln -sf "$APP_DIR/Contents/MacOS/podium-gui" /usr/local/bin/podium-gui

echo "✅ Podium GUI installed successfully!"
echo ""
echo "🚀 Next steps:"
echo "   1. Launch from Applications folder or run: podium-gui"
echo "   2. Or use the CLI command: podium gui"
echo ""
echo "📖 Documentation: https://github.com/CaneBayComputers/podium-cli"
echo ""
