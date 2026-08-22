#!/bin/bash
set -e

# Build Zeltro GUI .deb package

echo "🚀 Building Zeltro GUI .deb package..."

# Get version from control file or use default
VERSION=$(grep "Version:" debian-package/DEBIAN/control | cut -d' ' -f2)
PACKAGE_NAME="zeltro-gui_${VERSION}_all"

# Clean up any existing build
rm -rf "${PACKAGE_NAME}"
rm -f "${PACKAGE_NAME}.deb"

# Create fresh package structure
echo "Creating package structure..."
mkdir -p "${PACKAGE_NAME}/DEBIAN"
mkdir -p "${PACKAGE_NAME}/usr/local/share/zeltro-gui"
mkdir -p "${PACKAGE_NAME}/usr/local/bin"
mkdir -p "${PACKAGE_NAME}/usr/share/applications"
mkdir -p "${PACKAGE_NAME}/usr/share/pixmaps"
mkdir -p "${PACKAGE_NAME}/usr/share/icons/hicolor"

# Copy DEBIAN control files
echo "Copying DEBIAN control files..."
cp debian-package/DEBIAN/* "${PACKAGE_NAME}/DEBIAN/"

# Copy built GUI files (already built by GitHub Actions)
echo "Copying GUI files..."
cp -rf ../dist "${PACKAGE_NAME}/usr/local/share/zeltro-gui/"
cp -rf ../node_modules "${PACKAGE_NAME}/usr/local/share/zeltro-gui/"
cp ../package.json "${PACKAGE_NAME}/usr/local/share/zeltro-gui/"
cp ../package-lock.json "${PACKAGE_NAME}/usr/local/share/zeltro-gui/"
cp ../*.html "${PACKAGE_NAME}/usr/local/share/zeltro-gui/"
cp ../*.css "${PACKAGE_NAME}/usr/local/share/zeltro-gui/"
if [ -d "../assets" ]; then
    cp -rf ../assets "${PACKAGE_NAME}/usr/local/share/zeltro-gui/"
fi
if [ -f "../LICENSE" ]; then
    cp ../LICENSE "${PACKAGE_NAME}/usr/local/share/zeltro-gui/"
fi

# Copy desktop entry and icon files
echo "Copying desktop entry and icon files..."
if [ -f "debian-package/usr/share/applications/zeltro-gui.desktop" ]; then
    cp "debian-package/usr/share/applications/zeltro-gui.desktop" "${PACKAGE_NAME}/usr/share/applications/"
fi
if [ -f "debian-package/usr/share/pixmaps/zeltro-gui.png" ]; then
    cp "debian-package/usr/share/pixmaps/zeltro-gui.png" "${PACKAGE_NAME}/usr/share/pixmaps/"
fi
if [ -d "debian-package/usr/share/icons" ]; then
    cp -rf "debian-package/usr/share/icons/"* "${PACKAGE_NAME}/usr/share/icons/"
fi

# Create command line wrapper
echo "Creating command line wrapper..."
cat > "${PACKAGE_NAME}/usr/local/bin/zeltro-gui" << 'EOF'
#!/bin/bash
cd /usr/local/share/zeltro-gui
exec electron dist/main.js "$@"
EOF
chmod +x "${PACKAGE_NAME}/usr/local/bin/zeltro-gui"

# Note: Projects directory is now user-configurable, not part of installation

# Set proper permissions
echo "Setting permissions..."
chmod -R 755 "${PACKAGE_NAME}/usr/local/share/zeltro-gui"
chmod +x "${PACKAGE_NAME}/usr/local/bin/zeltro-gui"
chmod +x "${PACKAGE_NAME}/DEBIAN/postinst"
chmod +x "${PACKAGE_NAME}/DEBIAN/prerm"
chmod +x "${PACKAGE_NAME}/DEBIAN/postrm"

# Set desktop entry and icon permissions
if [ -f "${PACKAGE_NAME}/usr/share/applications/zeltro-gui.desktop" ]; then
    chmod 644 "${PACKAGE_NAME}/usr/share/applications/zeltro-gui.desktop"
fi
if [ -f "${PACKAGE_NAME}/usr/share/pixmaps/zeltro-gui.png" ]; then
    chmod 644 "${PACKAGE_NAME}/usr/share/pixmaps/zeltro-gui.png"
fi
if [ -d "${PACKAGE_NAME}/usr/share/icons" ]; then
    chmod -R 644 "${PACKAGE_NAME}/usr/share/icons/hicolor/*/apps/zeltro-gui.png"
    find "${PACKAGE_NAME}/usr/share/icons" -type d -exec chmod 755 {} \;
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
echo "  sudo apt remove zeltro-gui"
echo ""
echo "Package info:"
dpkg-deb --info "${PACKAGE_NAME}.deb"
