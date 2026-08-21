#!/bin/bash
set -e

echo "🍎 Building Zeltro GUI for macOS..."

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Build TypeScript first
echo "🔨 Building TypeScript..."
cd "$PROJECT_ROOT"
npm run build-ts

# Create build directory
BUILD_DIR="$SCRIPT_DIR/build"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# Copy necessary files to build directory
echo "📦 Copying application files..."
cp -r dist/ "$BUILD_DIR/"
cp -r assets/ "$BUILD_DIR/" 2>/dev/null || echo "No assets directory found"
cp -r node_modules/ "$BUILD_DIR/"
cp package.json "$BUILD_DIR/"
cp package-lock.json "$BUILD_DIR/"
cp *.html "$BUILD_DIR/"
cp *.css "$BUILD_DIR/"
cp LICENSE "$BUILD_DIR/" 2>/dev/null || echo "No LICENSE file found"

# Copy installer script
cp "$SCRIPT_DIR/macos/install-gui.sh" "$BUILD_DIR/"

# Create tarball
echo "📦 Creating installer package..."
cd "$BUILD_DIR"
tar -czf "../zeltro-gui-macos.tar.gz" .

# Clean up build directory
cd "$SCRIPT_DIR"
rm -rf "$BUILD_DIR"

echo "✅ Mac installer created: packaging/zeltro-gui-macos.tar.gz"
echo ""
echo "📋 Installation instructions:"
echo "   1. Extract: tar -xzf zeltro-gui-macos.tar.gz"
echo "   2. Run: ./install-gui.sh"
echo ""
