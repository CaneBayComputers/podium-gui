#!/usr/bin/env node
//
// End-to-end checks for the Podium GUI.
//
// Deliberately READ-ONLY: nothing here creates, installs, clones or removes a
// project, and nothing stops the shared services. Every assertion is either a
// pure UI check or an inspection of state the app already read. A real
// `podium install` run is tested separately on a throwaway box, not here.
//
// Run with:  npm run test:e2e

const { launchApp, screenshot, loadedPage, t } = require('./helpers');

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
  console.log('\nPodium GUI — end-to-end\n');

  const { app, win } = await launchApp();

  try {
    // --- Launch ---------------------------------------------------------
    console.log('launch');
    const page = await loadedPage(win);
    check(
      'main window loads index.html, not the installer',
      page === 'index',
      page === 'installer'
        ? 'loaded installer.html — Podium reports not-installed/not-configured'
        : ''
    );

    // Reach into the MAIN process and drive the CLI through the same IPC the
    // dashboard uses. `require` is not in scope inside app.evaluate(), but the
    // electron module is injected and ipcMain exposes its invoke handlers — so
    // the real handler runs, not a reimplementation of it.
    const statusCall = await app.evaluate(async ({ ipcMain }) => {
      const handler = ipcMain._invokeHandlers.get('execute-podium');
      if (!handler) return { error: 'execute-podium not registered' };
      return handler({}, 'status', ['--all', '--json-output']);
    });
    check('execute-podium IPC runs the CLI successfully', statusCall.code === 0,
      statusCall.error || `exit ${statusCall.code}: ${(statusCall.stderr || '').slice(0, 120)}`);

    let statusJson = null;
    try {
      statusJson = JSON.parse(statusCall.stdout || '');
    } catch (error) {
      // leave null — asserted below
    }
    check('podium status returns parseable JSON with shared_services',
      statusJson !== null && typeof statusJson.shared_services === 'object',
      statusJson === null ? 'stdout did not parse as JSON' : '');

    // --- Dashboard ------------------------------------------------------
    console.log('\ndashboard');

    // Wait out the "Loading Podium" splash before asserting or screenshotting,
    // otherwise every check races the initial render.
    //
    // Do NOT test offsetParent here: .initial-loading is position:fixed, and
    // fixed elements always report offsetParent === null, so that check passes
    // instantly and the screenshot catches a full-screen splash. The app hides
    // it by adding .hide (opacity+visibility transition) then setting
    // display:none 500ms later — visibility is the honest signal.
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

    // Real project cards replace the hardcoded placeholder. Asserting on any
    // .project-card would pass on that static placeholder and prove nothing, so
    // require cards that are NOT the placeholder.
    // How many projects SHOULD render is an environment fact, not a constant —
    // a freshly configured machine legitimately has none. Take the expected
    // count from the CLI and assert against that, so the suite is correct on a
    // clean box as well as a populated one.
    const expectedProjects = (statusJson?.projects || []).length;

    if (expectedProjects > 0) {
      await win.waitForFunction(
        () => document.querySelectorAll('#projects-grid .project-card:not(.placeholder)').length > 0,
        null,
        { timeout: 15000 }
      ).catch(() => {});
    }

    // The splash fades over 0.5s; let it finish so the capture is the dashboard.
    await win.waitForTimeout(600);
    await screenshot(win, '01-dashboard');
    for (const id of ['start-all', 'stop-all', 'new-project', 'clone-project', 'install-app']) {
      check(`header action "${id}" present`, await win.locator(t(id)).count() === 1);
    }
    check('projects grid rendered', await win.locator(t('projects-grid')).count() === 1);
    check('services grid rendered', await win.locator(t('services-grid')).count() === 1);

    // `podium status --all` drives this. Without --all it only returns RUNNING
    // projects, so a stopped-everything machine rendered an empty dashboard —
    // that regression is exactly what this guards.
    const realCards = await win.locator('#projects-grid .project-card:not(.placeholder)').count();

    if (expectedProjects === 0) {
      // Clean machine: the empty-state placeholder is the correct render.
      const placeholder = await win.locator('#projects-grid .project-card.placeholder').count();
      check('empty machine shows the create-first-project placeholder', placeholder === 1,
        `${placeholder} placeholders, ${realCards} project cards`);
    } else {
      check('dashboard renders every project podium status reports',
        realCards === expectedProjects,
        `rendered ${realCards}, CLI reported ${expectedProjects}`);
    }

    // Display metadata is GUI-owned (read from each project's compose file),
    // since podium status does not return name/description/emoji.
    //
    // This asserts the metadata actually REACHES the DOM. An earlier version
    // only counted .project-icon elements, which every card has regardless —
    // it passed while a race silently wiped the metadata before render.
    const metaCheck = await app.evaluate(async ({ ipcMain }) => {
      const status = await ipcMain._invokeHandlers.get('execute-podium')(
        {}, 'status', ['--all', '--json-output']
      );
      const names = (JSON.parse(status.stdout || '{}').projects || []).map((p) => p.name);

      const getMeta = ipcMain._invokeHandlers.get('get-project-metadata');
      for (const name of names) {
        const meta = await getMeta({}, name);
        if (meta && meta.display_name) return { name, ...meta };
      }
      return null;
    });

    if (metaCheck) {
      const cardText = await win.locator('#projects-grid').innerText();
      check(`rendered metadata for a project that has it (${metaCheck.name})`,
        cardText.includes(metaCheck.display_name),
        `expected display name "${metaCheck.display_name}" in the grid`);
      if (metaCheck.emoji) {
        check('rendered its metadata emoji', cardText.includes(metaCheck.emoji), metaCheck.emoji);
      }
    } else {
      console.log('  – no project on this machine carries x-metadata; skipping render check');
    }

    // Any project the CLI reports as docker_running must render as running —
    // with a Stop button and its URL. An earlier version also required
    // port_mapped, which marked healthy `podium install` projects (nginx front,
    // no published host port — reachable only by hostname) as stopped.
    const running = (statusJson?.projects || []).filter((p) => p.docker_running);
    if (running.length > 0) {
      const wrong = await win.evaluate((names) => {
        const bad = [];
        for (const name of names) {
          const card = [...document.querySelectorAll('#projects-grid .project-card')]
            .find((c) => c.querySelector('h3')?.textContent?.trim() === name
                      || c.innerText.includes(name));
          if (!card) { bad.push(`${name}: no card`); continue; }
          const buttons = [...card.querySelectorAll('button')].map((b) => b.textContent.trim());
          if (!buttons.includes('Stop')) bad.push(`${name}: offers "${buttons[0]}" not "Stop"`);
          if (!card.querySelector('.url-link')) bad.push(`${name}: no URL shown`);
        }
        return bad;
      }, running.map((p) => p.name));

      check(`running projects render as running (${running.length} checked)`,
        wrong.length === 0, wrong.join('; '));
    }

    // Optional services (minio, meilisearch) must not appear as red "Stopped"
    // cards on a machine that never enabled them — that reads as a broken
    // service rather than an unused feature.
    const optional = await app.evaluate(async ({ ipcMain }) =>
      ipcMain._invokeHandlers.get('get-optional-services')({})
    );
    const servicesText = await win.locator('#services-grid').innerText();
    for (const name of ['minio', 'meilisearch']) {
      const shown = servicesText.toLowerCase().includes(name);
      check(`optional service "${name}" shown only when enabled`,
        shown === optional.includes(name),
        `enabled=${optional.includes(name)}, rendered=${shown}`);
    }

    // --- Install-an-app modal (the step 2 feature) ----------------------
    console.log('\ninstall app');
    await win.click(t('install-app'));
    await win.waitForSelector('#install-app-modal.show', { timeout: 5000 });
    check('install modal opens', await win.isVisible('#install-app-modal'));

    // Catalogue is read from the CLI's apps.json at runtime.
    await win.waitForFunction(
      () => document.querySelectorAll('#install-app-list .app-entry').length > 0,
      null,
      { timeout: 10000 }
    );
    const total = await win.locator('#install-app-list .app-entry').count();
    check('app catalogue loaded from the CLI', total > 50, `${total} apps rendered`);

    const countLabel = await win.textContent('#install-app-count');
    check('app count label reflects catalogue', /\(\d+ apps\)/.test(countLabel || ''), countLabel);

    await screenshot(win, '02-install-picker');

    // Install button starts disabled — nothing selected yet.
    check('install button disabled before selection',
      await win.locator(t('install-submit')).isDisabled());

    // With all 102 apps listed the modal is tall; the footer must stay pinned
    // rather than being pushed below the fold, or the primary action is
    // off-screen until the user happens to filter the list.
    const actionsVisible = await win.locator(t('install-submit')).evaluate((el) => {
      const box = el.getBoundingClientRect();
      return box.bottom <= window.innerHeight && box.top >= 0 && box.height > 0;
    });
    check('install/cancel buttons stay within the viewport with a full list', actionsVisible);

    // Search narrows the list.
    await win.fill(t('install-search'), 'grafana');
    await win.waitForFunction(
      () => document.querySelectorAll('#install-app-list .app-entry').length < 10,
      null,
      { timeout: 5000 }
    );
    const filtered = await win.locator('#install-app-list .app-entry').count();
    check('search filters the catalogue', filtered > 0 && filtered < total,
      `${filtered} of ${total} after searching "grafana"`);

    // Selecting enables the button and names the app.
    await win.click(t('app-grafana'));
    check('selecting an app enables install',
      await win.locator(t('install-submit')).isEnabled());
    const btnText = await win.textContent(t('install-submit'));
    check('install button names the chosen app', /grafana/i.test(btnText || ''), btnText);

    await screenshot(win, '03-install-selected');

    // A database-fixed app shows its engine; self-contained apps say so.
    await win.fill(t('install-search'), 'actual');
    await win.waitForTimeout(200);
    const selfContained = await win.locator('#install-app-list .app-db-none').count();
    check('self-contained apps are labelled, not offered a database', selfContained > 0);

    await win.click('#install-app-modal .modal-close');
    await win.waitForTimeout(200);

    // --- Create with AI (phase 1 choices, rendered natively) ------------
    //
    // Driven from a FIXTURE, not a live classification: a real
    // `podium create --classify-only` is an AI round-trip — slow, costs tokens,
    // and returns different candidates run to run. The contract itself was
    // verified against the real CLI by hand; what matters here is that the GUI
    // renders that contract correctly and never offers a database for an app.
    console.log('\ncreate with ai');
    await win.click(t('create-ai'));
    await win.waitForSelector('#create-ai-modal.show', { timeout: 5000 });
    check('create modal opens', await win.isVisible('#create-ai-modal'));

    const FIXTURE = {
      status: 'success',
      project_name: 'team-process-wiki',
      recommended: 'app',
      customization_requested: false,
      database: { slug: 'mysql', reason: 'Relational docs with concurrent edits.' },
      candidates: [
        { kind: 'app', slug: 'bookstack', display: 'BookStack', reason: 'Purpose-built wiki.', database: 'mysql' },
        { kind: 'app', slug: 'trilium', display: 'Trilium Notes', reason: 'Hierarchical notes.', database: '' },
        { kind: 'framework', slug: 'laravel', display: 'Laravel', reason: 'Custom page models.',
          databases: ['mysql', 'postgres', 'sqlite'] }
      ]
    };

    await win.evaluate((fixture) => {
      // renderClassification() adopts the fixture as the current classification,
      // so the click handlers work exactly as they do after a real classify.
      window.renderClassification(fixture);
      // Drive the real stage transition rather than forcing display, so the
      // footer buttons and hidden stages are exercised too.
      window.setCreateStage('choose');
    }, FIXTURE);

    check('choose stage swaps the footer to the create action',
      await win.isVisible(t('create-confirm')) && !(await win.isVisible(t('create-classify'))));
    check('choose stage hides the idea input', !(await win.isVisible('#create-stage-idea')));

    const candidateCount = await win.locator('#create-candidates .candidate').count();
    check('renders every candidate', candidateCount === 3, `${candidateCount} of 3`);

    const recBadges = await win.locator('#create-candidates .rec-badge').count();
    check('marks exactly one recommendation', recBadges === 1, `${recBadges} badges`);

    // The recommendation is the first candidate of the RECOMMENDED KIND, not
    // simply the first row — same rule the CLI menu uses.
    const badgedSlug = await win.locator('#create-candidates .candidate:has(.rec-badge) .app-slug').textContent();
    check('recommends the first candidate of the recommended kind',
      badgedSlug?.trim() === 'bookstack', badgedSlug || '');

    check('prefills the suggested project name',
      (await win.locator(t('create-name')).inputValue()) === 'team-process-wiki');

    // An app's database is fixed by its installer — never offer a choice.
    await win.click(t('candidate-bookstack'));
    check('app selection hides the database picker',
      !(await win.isVisible('#create-database-group')));
    const fixedText = await win.textContent('#create-fixed-db-text');
    check('app shows its fixed database as information',
      /mysql/i.test(fixedText || '') && /installer/i.test(fixedText || ''), fixedText || '');

    await win.click(t('candidate-trilium'));
    const selfContainedText = await win.textContent('#create-fixed-db-text');
    check('self-contained app says so rather than naming an engine',
      /internally/i.test(selfContainedText || ''), selfContainedText || '');

    // A framework offers only the engines it actually supports, recommended first.
    await win.click(t('candidate-laravel'));
    check('framework selection shows the database picker',
      await win.isVisible('#create-database-group'));
    const engines = await win.locator('#create-database option').evaluateAll((o) => o.map((x) => x.value));
    check('offers only engines the framework supports',
      engines.length === 3 && ['mysql', 'postgres', 'sqlite'].every((e) => engines.includes(e)),
      engines.join(','));
    check('recommended engine is first', engines[0] === 'mysql', engines.join(','));

    await screenshot(win, '06-create-choices');

    // A null project_name means the idea implied no subject — ask, don't invent.
    await win.evaluate((fixture) => {
      window.renderClassification({ ...fixture, project_name: null });
    }, FIXTURE);
    check('empty name when the idea implies none',
      (await win.locator(t('create-name')).inputValue()) === '');
    const nameHelp = await win.textContent('#create-name-help');
    check('prompts for a name instead of inventing one',
      /pick one|does not suggest/i.test(nameHelp || ''), nameHelp || '');

    await win.click('#create-ai-modal .modal-close');
    await win.waitForTimeout(200);

    // --- Clone modal (mode selector added during the CLI re-sync) -------
    console.log('\nclone');
    await win.click(t('clone-project'));
    await win.waitForSelector('#clone-project-modal.show', { timeout: 5000 });
    check('clone modal opens', await win.isVisible('#clone-project-modal'));

    const modes = await win.locator(`${t('clone-mode')} option`).evaluateAll(
      (opts) => opts.map((o) => o.value)
    );
    check('clone offers all three required modes',
      ['work-directly', 'fork', 'new-repo'].every((m) => modes.includes(m)),
      modes.join(', '));
    check('clone defaults to work-directly',
      await win.locator(t('clone-mode')).inputValue() === 'work-directly');

    await screenshot(win, '04-clone-modal');
    await win.click('#clone-project-modal .modal-close');
    await win.waitForTimeout(200);

    // --- New Project modal ----------------------------------------------
    console.log('\nnew project');
    await win.click(t('new-project'));
    await win.waitForSelector('#new-project-modal.show', { timeout: 5000 });
    check('new project modal opens', await win.isVisible('#new-project-modal'));
    for (const fw of ['laravel', 'wordpress', 'php']) {
      check(`framework option "${fw}" present`, await win.locator(t(`framework-${fw}`)).count() === 1);
    }
    await screenshot(win, '05-new-project');
    await win.click('#new-project-modal .modal-close');

    // --- Main-process IPC, exercised directly ---------------------------
    console.log('\nipc');
    const catalog = await app.evaluate(async ({ ipcMain }) => {
      const handler = ipcMain._invokeHandlers.get('get-app-catalog');
      if (!handler) return { error: 'get-app-catalog not registered' };
      return handler({});
    });
    check('get-app-catalog IPC returns the catalogue',
      !catalog.error && Array.isArray(catalog.apps) && catalog.apps.length > 50,
      catalog.error || `${catalog.apps?.length} apps`);

    const shaped = catalog.apps?.[0] || {};
    check('catalogue entries carry slug/display/database/note',
      ['slug', 'display', 'database', 'note'].every((k) => k in shaped),
      JSON.stringify(shaped));
  } finally {
    await app.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('\nfailures:');
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  console.log('screenshots: debug/\n');

  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error('\ne2e run crashed:', error);
  process.exit(1);
});
