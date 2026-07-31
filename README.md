# Podium GUI

Professional PHP Development Platform - Graphical User Interface

## Overview

Podium GUI is the premium graphical interface for the Podium development platform. It provides an intuitive, modern interface for managing PHP projects, Docker services, and development environments.

## Features

- 🎯 **Project Management** - Visual project creation, monitoring, and management
- 🐳 **Docker Integration** - Start/stop services with a single click
- 📊 **Real-time Monitoring** - Live status updates for all services and projects  
- 🎨 **Modern UI** - Retro synthwave theme with responsive design
- ⚡ **Performance** - Built with Electron for cross-platform compatibility
- 🔧 **Configuration** - Visual setup and configuration management

## Requirements

- **Podium CLI** - The GUI requires Podium CLI to be installed
- **Node.js 16+** - For development
- **Docker** - For containerized development environments

## Installation

### From Release (Recommended)
1. Download the latest release for your platform
2. Install the package (deb/dmg/exe)
3. The installer will automatically install Podium CLI if needed

### From Source
```bash
# Clone the repository
git clone https://github.com/CaneBayComputers/podium-gui.git
cd podium-gui

# Install dependencies
npm install

# Build TypeScript
npm run build-ts

# Start development
npm start

# Or build for production
npm run build
```

## Development

```bash
# Install dependencies
npm install

# Start in development mode
npm run dev

# Build TypeScript
npm run build-ts

# Package for distribution
npm run package
```

## Launching without stealing focus

```bash
electron dist/main.js --no-focus
```

Opens the window **unfocused and behind the other windows**, for background or
automated launches — a test run should not grab the keyboard from whoever is at
the machine. The e2e harness passes it automatically.

On X11 the stacking part uses `wmctrl`/`xdotool` if either is installed; without
them the window still opens unfocused, which is the part that matters. The
`below` hint is cleared the first time the window is focused, so once you click
it, it behaves like any other window rather than being stuck at the back.

A normal launch (`npm start`, or double-clicking the app) focuses as usual.

## Testing

The GUI is driven end-to-end with Playwright, which supports Electron natively —
it launches the real app, queries and clicks the renderer DOM, and can call into
the **main** process to exercise IPC handlers directly.

```bash
npm run test:e2e     # builds TypeScript, then runs tests/e2e.js
```

The suite is deliberately **read-only**: it never creates, installs, clones or
removes a project, and never stops the shared services. It does require Podium to
be installed and configured (`/etc/podium-cli/.env` with `PROJECTS_DIR`), since it
asserts against real `podium status` output. A real `podium install` run is
verified separately on a throwaway box.

Screenshots are written to a gitignored `debug/` directory with predictable
names (`01-dashboard.png`, `02-install-picker.png`, …), so a failing run can point
at an exact image.

### Writing tests

Select elements by `data-testid`, never by CSS class or DOM position — restyling
must not break selectors, or an agent silently clicks the wrong thing:

```js
const { launchApp, screenshot, t } = require('./helpers');

const { app, win } = await launchApp();
await win.click(t('install-app'));
await screenshot(win, 'install-picker');

// Reach into the main process. `require` is NOT in scope inside app.evaluate(),
// but the electron module is injected and ipcMain exposes its invoke handlers,
// so the real handler runs rather than a reimplementation of it.
const catalog = await app.evaluate(async ({ ipcMain }) =>
  ipcMain._invokeHandlers.get('get-app-catalog')({})
);

await app.close();
```

Two traps worth knowing, both of which produced convincing false results here:

- **Screenshot animations.** Modals animate in (`fadeIn` + `scaleIn`, 0.3s).
  Capturing immediately yields a half-transparent overlay that looks like a
  serious CSS bug. `helpers.screenshot()` passes `animations: 'disabled'` to
  fast-forward them; use it rather than `win.screenshot()` directly.
- **`offsetParent` on fixed elements.** The loading splash is `position: fixed`,
  and fixed elements always report `offsetParent === null` — so using that to
  detect "hidden" passes instantly and every subsequent assertion races the
  initial render. Check `display`/`visibility` instead.

## License

This software is proprietary and requires a valid license for use. 

For licensing information, visit: https://podiumdev.io/pricing

## Support

- 📧 Email: canebaycomputers@gmail.com
- 🐛 Issues: https://github.com/CaneBayComputers/podium-gui/issues
- 📖 Documentation: https://podiumdev.io/docs

---

© 2024 Cane Bay Computers. All rights reserved.
