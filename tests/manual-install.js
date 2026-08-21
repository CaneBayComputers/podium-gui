#!/usr/bin/env node
//
// MANUAL, MUTATING verification of the install flow.
//
// This is NOT part of `npm test`. It performs a real `zeltro install`, which
// creates a project directory, writes an /etc/hosts entry and pulls Docker
// images. Run it only on a machine you are willing to change — a throwaway box
// or a VM — never as part of an automated suite.
//
//   node tests/manual-install.js [app-slug] [project-name]
//
// Defaults to the `changedetection` installer, which is self-contained (no
// database) and small. Clean up afterwards with:
//
//   zeltro remove <project-name> --force-db-delete
//
// It drives the real GUI, so on a machine with a desktop you can watch the
// modal, the live output pane, and the finished project card appear.

const { launchApp, screenshot, t } = require('./helpers');

const APP = process.argv[2] || 'changedetection';
const PROJECT = process.argv[3] || '';
const TARGET = PROJECT || APP;

// Docker pulls dominate; be generous.
const INSTALL_TIMEOUT_MS = 15 * 60 * 1000;

async function run() {
  console.log(`\nMANUAL install check — ${APP}${PROJECT ? ` as "${PROJECT}"` : ''}\n`);

  const { app, win } = await launchApp();

  try {
    await win.waitForFunction(
      () => {
        const splash = document.getElementById('initial-loading');
        if (!splash) return true;
        const style = getComputedStyle(splash);
        return style.display === 'none' || style.visibility === 'hidden';
      },
      null,
      { timeout: 20000 }
    );

    console.log('opening the install modal…');
    await win.click(t('install-app'));
    await win.waitForSelector('#install-app-modal.show', { timeout: 5000 });
    await win.waitForFunction(
      () => document.querySelectorAll('#install-app-list .app-entry').length > 0,
      null,
      { timeout: 10000 }
    );

    console.log(`selecting "${APP}"…`);
    await win.fill(t('install-search'), APP);
    await win.waitForSelector(t(`app-${APP}`), { timeout: 5000 });
    await win.click(t(`app-${APP}`));

    if (PROJECT) {
      await win.fill(t('install-project-name'), PROJECT);
    }

    await screenshot(win, 'manual-01-selected');

    console.log('clicking Install — this shells out to `zeltro install` for real…');
    await win.click(t('install-submit'));

    // The modal switches to the streamed-output view; the title settles on a
    // success or failure sentence when the CLI exits.
    await win.waitForFunction(
      () => {
        const title = document.getElementById('install-progress-title');
        return title && /is installed|failed/i.test(title.textContent || '');
      },
      null,
      { timeout: INSTALL_TIMEOUT_MS }
    );

    const title = await win.textContent('#install-progress-title');
    const output = await win.textContent('#install-output');

    await screenshot(win, 'manual-02-finished');

    console.log(`\nresult: ${title}\n`);
    console.log('--- last 30 lines of install output ---');
    console.log((output || '').split('\n').slice(-30).join('\n'));

    const succeeded = /is installed/i.test(title || '');

    if (succeeded) {
      // Close the modal and confirm the project now renders on the dashboard.
      await win.click('#install-app-modal .modal-close').catch(() => {});
      await win.waitForFunction(
        (name) => document.getElementById('projects-grid')?.innerText.includes(name),
        TARGET,
        { timeout: 30000 }
      ).catch(() => {});

      const grid = await win.locator('#projects-grid').innerText();
      console.log(`\ndashboard shows "${TARGET}": ${grid.includes(TARGET)}`);
      await screenshot(win, 'manual-03-dashboard');
    }

    process.exitCode = succeeded ? 0 : 1;
  } finally {
    await app.close();
  }
}

run().catch((error) => {
  console.error('\nmanual install check crashed:', error);
  process.exit(1);
});
