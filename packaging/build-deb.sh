#!/bin/bash
set -e

# Build Podium CLI .deb package

echo "🚀 Building Podium CLI .deb package..."

# Get version from control file or use default
VERSION=$(grep "Version:" debian-package/DEBIAN/control | cut -d' ' -f2)
PACKAGE_NAME="podium-cli_${VERSION}_all"

# Clean up any existing build
rm -rf "${PACKAGE_NAME}"
rm -f "${PACKAGE_NAME}.deb"

# Create fresh package structure
echo "Creating package structure..."
mkdir -p "${PACKAGE_NAME}/DEBIAN"
mkdir -p "${PACKAGE_NAME}/usr/local/share/podium-cli"
mkdir -p "${PACKAGE_NAME}/usr/local/bin"
mkdir -p "${PACKAGE_NAME}/usr/share/applications"
mkdir -p "${PACKAGE_NAME}/usr/share/pixmaps"
mkdir -p "${PACKAGE_NAME}/usr/local/share/podium-gui"

# Copy DEBIAN control files
echo "Copying DEBIAN control files..."
cp debian-package/DEBIAN/* "${PACKAGE_NAME}/DEBIAN/"

# Copy application files
echo "Copying Podium CLI files..."
cp -r ../src/* "${PACKAGE_NAME}/usr/local/share/podium-cli/"
cp ../README.md "${PACKAGE_NAME}/usr/local/share/podium-cli/"
cp ../LICENSE "${PACKAGE_NAME}/usr/local/share/podium-cli/"

# Build and copy GUI files
echo "Building GUI application..."
cd ../gui
npm install
npx electron-builder --linux --dir
cd ../packaging

# Copy built GUI to package
echo "Copying GUI files..."
cp -rf ../gui/dist "${PACKAGE_NAME}/usr/local/share/podium-cli/gui"

# Copy desktop entry and icon files
echo "Copying desktop entry and icon files..."
if [ -f "debian-package/usr/share/applications/podium-gui.desktop" ]; then
    cp "debian-package/usr/share/applications/podium-gui.desktop" "${PACKAGE_NAME}/usr/share/applications/"
fi
if [ -f "debian-package/usr/share/pixmaps/podium-gui.png" ]; then
    cp "debian-package/usr/share/pixmaps/podium-gui.png" "${PACKAGE_NAME}/usr/share/pixmaps/"
fi

# Note: Projects directory is now user-configurable, not part of installation

# Set proper permissions
echo "Setting permissions..."
chmod -R 755 "${PACKAGE_NAME}/usr/local/share/podium-cli"
chmod +x "${PACKAGE_NAME}/usr/local/share/podium-cli/podium"
chmod +x "${PACKAGE_NAME}/usr/local/share/podium-cli/scripts"/*.sh
chmod +x "${PACKAGE_NAME}/DEBIAN/postinst"
chmod +x "${PACKAGE_NAME}/DEBIAN/prerm"

# Set desktop entry and GUI permissions
if [ -f "${PACKAGE_NAME}/usr/share/applications/podium-gui.desktop" ]; then
    chmod 644 "${PACKAGE_NAME}/usr/share/applications/podium-gui.desktop"
fi
if [ -f "${PACKAGE_NAME}/usr/share/pixmaps/podium-gui.png" ]; then
    chmod 644 "${PACKAGE_NAME}/usr/share/pixmaps/podium-gui.png"
fi
if [ -d "${PACKAGE_NAME}/usr/share/icons" ]; then
    chmod -R 644 "${PACKAGE_NAME}/usr/share/icons/hicolor/*/apps/podium-gui.png"
    find "${PACKAGE_NAME}/usr/share/icons" -type d -exec chmod 755 {} \;
fi
if [ -d "${PACKAGE_NAME}/usr/local/share/podium-cli/gui" ]; then
    chmod -R 755 "${PACKAGE_NAME}/usr/local/share/podium-cli/gui"
fi

# Build the package
echo "Building .deb package..."
dpkg-deb --build "${PACKAGE_NAME}"

# Clean up build directory
rm -rf "${PACKAGE_NAME}"

echo ""
echo "✅ Package built successfully: ${PACKAGE_NAME}.deb"
echo ""
echo "To test the package:"
echo "  sudo dpkg -i ${PACKAGE_NAME}.deb"
echo ""
echo "To remove the package:"
echo "  sudo apt remove podium-cli"
echo ""
echo "Package info:"
dpkg-deb --info "${PACKAGE_NAME}.deb"
