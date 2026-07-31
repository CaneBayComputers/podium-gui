// Shared helpers for driving the Podium GUI with Playwright.
//
// Playwright supports Electron natively — this is a first-class API, not a
// workaround. `electron.launch()` gives full DOM access in the renderer AND
// `app.evaluate()` in the main process, so IPC handlers can be exercised
// directly without inventing a protocol.

const path = require('path');
const fs = require('fs');
const { _electron: electron } = require('playwright');

const ROOT = path.join(__dirname, '..');
const DEBUG_DIR = path.join(ROOT, 'debug');

/**
 * Launch the app and return { app, win }.
 *
 * The main process resolves its HTML with a relative path ('../src/index.html'),
 * which is relative to process.cwd() — so cwd must be the repo root.
 */
async function launchApp(options = {}) {
  const app = await electron.launch({
    args: [path.join(ROOT, 'dist', 'main.js'), ...(options.args || [])],
    cwd: ROOT,
    env: { ...process.env, ...(options.env || {}) }
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  return { app, win };
}

/**
 * Screenshot into a gitignored debug/ directory with a predictable name, so a
 * failing run can point a human at an exact image.
 */
async function screenshot(win, name) {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  const file = path.join(DEBUG_DIR, `${name}.png`);

  // The modals animate in (fadeIn + scaleIn, 0.3s each). Without this the
  // screenshot catches them mid-fade and the result looks like a broken,
  // transparent overlay — a convincing bug that isn't real. 'disabled' fast
  // -forwards CSS animations to their finished state before capturing.
  await win.screenshot({ path: file, animations: 'disabled' });
  return file;
}

/** Which HTML the main process chose — index (ready) or installer (needs setup). */
async function loadedPage(win) {
  const url = win.url();
  return url.includes('installer.html') ? 'installer' : 'index';
}

const t = (id) => `[data-testid="${id}"]`;

module.exports = { launchApp, screenshot, loadedPage, t, ROOT, DEBUG_DIR };
