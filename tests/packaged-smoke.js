#!/usr/bin/env node
//
// Smoke-test the PACKAGED app, not the source tree.
//
// The e2e suite drives dist/main.js from the checkout, where src/ is simply on
// disk. That cannot catch a packaging bug — and the worst bug this project has
// shipped was exactly that: every release opened an empty window because
// main.ts loaded '../src/index.html' while build.files only matched '*.html',
// so src/ was never packaged at all. It was reported as working because the
// window TITLE was right, and the title is set on BrowserWindow before any page
// loads. A check that could not fail.
//
// So this launches the built binary and asserts on things that only exist if
// the renderer actually ran: real content in the DOM, the stylesheet applied,
// and the controls added since.
//
// Requires `npm run pack` first. Run with: node tests/packaged-smoke.js

const path = require('path');
const fs = require('fs');
const { _electron: electron } = require('playwright');

const ROOT = path.join(__dirname, '..');
const BINARY = path.join(ROOT, 'release', 'linux-unpacked', 'zeltro-gui');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function run() {
  console.log('\nZeltro GUI — packaged smoke test\n');

  if (!fs.existsSync(BINARY)) {
    console.error(`No packaged build at ${BINARY}\nRun: npm run pack`);
    process.exit(2);
  }

  const app = await electron.launch({ executablePath: BINARY, args: ['--no-focus'] });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  try {
    console.log('packaging');

    // The title is NOT evidence: it is set on BrowserWindow and survives a page
    // that never loaded. Assert on the document instead.
    const url = win.url();
    check('renderer loaded a page from the package',
      url.includes('index.html') || url.includes('installer.html'), url);

    if (url.includes('installer.html')) {
      console.log('  – packaged app opened the installer (CLI not configured); stopping here');
      await app.close();
      return;
    }

    await win.waitForFunction(
      () => {
        const splash = document.getElementById('initial-loading');
        if (!splash) return true;
        const s = getComputedStyle(splash);
        return s.display === 'none' || s.visibility === 'hidden';
      },
      null, { timeout: 30000 }
    ).catch(() => {});

    // Real DOM, not a blank document. An empty window still has <html><body>.
    const bodyLength = await win.evaluate(() => document.body.innerHTML.length);
    check('the page has real content, not an empty document',
      bodyLength > 5000, `${bodyLength} chars of body HTML`);

    // The stylesheet is a separate file in the package; if src/ were missing,
    // the DOM could still be there while every style was gone.
    const styled = await win.evaluate(() => {
      const header = document.querySelector('.header');
      if (!header) return null;
      const bg = getComputedStyle(header).backgroundColor;
      return { bg, transparent: bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent' };
    });
    check('stylesheet is packaged and applied',
      styled && !styled.transparent, JSON.stringify(styled));

    // Fonts and the xterm CSS come from node_modules; a missing glob there
    // shows up as an unstyled terminal rather than a crash.
    const xtermCss = await win.evaluate(() =>
      [...document.styleSheets].some((s) => (s.href || '').includes('xterm')));
    check('xterm stylesheet is packaged', xtermCss);

    console.log('\nui');
    for (const id of ['new-project', 'clone-project', 'settings-open', 'donate', 'project-filters']) {
      check(`"${id}" present in the packaged build`,
        await win.locator(`[data-testid="${id}"]`).count() === 1);
    }

    // Renderer JS actually executed — these are built by script at runtime, so
    // they are empty if renderer.js failed to load out of the asar.
    const rendered = await win.evaluate(() => ({
      filters: document.getElementById('project-filters')?.children.length || 0,
      themes: document.getElementById('theme-picker')?.children.length || 0,
      windowFns: ['createNewProject', 'chooseProjectKind', 'setProjectsPerRow', 'toggleTileTerminal']
        .filter((f) => typeof window[f] === 'function').length
    }));
    check('renderer script ran and wired its handlers',
      rendered.windowFns === 4, JSON.stringify(rendered));
    check('the filter bar rendered its controls', rendered.filters > 0,
      `${rendered.filters} children`);

    console.log('\nmain process');
    // The bug that broke every packaged menu launch. In the package there is no
    // repo checkout to fall back on, so this matters more here than in dev.
    const zeltro = await app.evaluate(async ({ ipcMain }) => {
      const handler = ipcMain._invokeHandlers.get('get-zeltro-command');
      if (!handler) return { error: 'not registered' };
      const before = process.env.PATH;
      process.env.PATH = '/nonexistent';
      const stripped = await handler({});
      process.env.PATH = before;
      return { stripped };
    });
    check('packaged app resolves zeltro with PATH stripped',
      !zeltro.error &&
      (zeltro.stripped?.command?.startsWith('/') || zeltro.stripped?.command === 'bash'),
      JSON.stringify(zeltro));

    fs.mkdirSync(path.join(ROOT, 'debug'), { recursive: true });
    await win.screenshot({
      path: path.join(ROOT, 'debug', 'packaged-smoke.png'),
      animations: 'disabled'
    });
  } finally {
    await app.close().catch(() => {});
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('\nfailures:');
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error('\npackaged smoke test crashed:', error);
  process.exit(1);
});
