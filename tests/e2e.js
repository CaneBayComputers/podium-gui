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
    for (const id of ['create-ai', 'start-all', 'stop-all', 'new-project', 'clone-project', 'install-app']) {
      check(`header action "${id}" present`, await win.locator(t(id)).count() === 1);
    }

    // Help/Patreon/Donate moved out of the header into the footer, alongside a
    // link to the CLI the GUI is a front end for.
    for (const id of ['help-modal-open', 'github-cli', 'patreon', 'donate']) {
      check(`footer link "${id}" present`, await win.locator(`.app-footer ${t(id)}`).count() === 1);
    }
    check('header no longer carries the secondary links',
      await win.locator(`.header-actions ${t('help-modal-open')}`).count() === 0);
    check('title names the CLI',
      (await win.textContent('.logo h1'))?.trim() === 'Podium CLI',
      await win.textContent('.logo h1'));
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
          if (!buttons.some((b) => /Modify with AI/.test(b))) bad.push(`${name}: no "Modify with AI"`);
          if (!buttons.includes('Trash')) bad.push(`${name}: destructive button is not labelled "Trash"`);
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

    // Input validation, before any AI round-trip is paid for.
    await win.fill(t('create-idea'), '');
    await win.click(t('create-classify'));
    await win.waitForTimeout(500);
    check('an empty idea is rejected without calling the AI',
      ((await win.textContent('#create-idea-error')) || '').length > 0,
      await win.textContent('#create-idea-error'));

    // A leading dash is parsed as a command-line flag. `podium create` honours
    // `--`, so classification alone could be made to work — but the same text is
    // later handed to `podium ai`, where the AGENT's own CLI parses the dash and
    // `--` only stops Podium rejecting it. Half-working is worse than declining.
    await win.fill(t('create-idea'), '-a tracker for guitar pedals');
    await win.click(t('create-classify'));
    await win.waitForTimeout(500);
    const dashErr = await win.textContent('#create-idea-error');
    check('an idea starting with a dash is declined with a reason',
      /dash|flag/i.test(dashErr || ''), dashErr || '<none>');
    await win.fill(t('create-idea'), '');

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

    // Assert against the CLI's catalogue, not a list copied into the test —
    // a hardcoded list here would drift exactly the way the form used to.
    const fwCatalog = await app.evaluate(async ({ ipcMain }) =>
      ipcMain._invokeHandlers.get('get-framework-catalog')({})
    );
    check('framework catalogue loads from the CLI',
      !fwCatalog.error && fwCatalog.frameworks.length > 0,
      fwCatalog.error || `${fwCatalog.frameworks?.length} frameworks`);

    await win.waitForFunction(
      () => document.querySelectorAll('#framework-list input[name="project-type"]').length > 0,
      null, { timeout: 10000 }
    );

    const offered = await win.locator('#framework-list input[name="project-type"]')
      .evaluateAll((els) => els.map((e) => e.value));
    const expectedFw = fwCatalog.frameworks.map((f) => f.slug);
    check(`offers every framework the CLI has (${expectedFw.length})`,
      expectedFw.length === offered.length && expectedFw.every((s) => offered.includes(s)),
      `missing: ${expectedFw.filter((s) => !offered.includes(s)).join(',') || 'none'}`);

    // Each framework must offer only the engines it actually supports. This is
    // the bug that made the form send `--database mysql` for all of them.
    for (const fw of fwCatalog.frameworks) {
      await win.click(`${t(`framework-${fw.slug}`)} input`);
      const opts = await win.locator('#project-database option')
        .evaluateAll((els) => els.map((e) => e.value));

      // "" is the Auto entry, which sends no --database at all.
      const engines = opts.filter((v) => v !== '');
      const ok = engines.length === fw.databases.length
        && fw.databases.every((d) => engines.includes(d));
      if (!ok) {
        check(`${fw.slug} offers exactly its supported engines`, false,
          `expected [${fw.databases}] got [${engines}]`);
        break;
      }
    }
    check('every framework offers exactly its supported engines', true);

    // WordPress is the sharp case: MySQL only.
    await win.click(`${t('framework-wordpress')} input`);
    const wpEngines = await win.locator('#project-database option')
      .evaluateAll((els) => els.map((e) => e.value).filter((v) => v !== ''));
    check('wordpress offers only mysql', wpEngines.length === 1 && wpEngines[0] === 'mysql',
      wpEngines.join(','));

    // Version inputs only appear where --version means something.
    // Only laravel and wordpress genuinely honour --version. php's documented
    // "8 or 7" is dead (frameworks/php.sh reads no version and the only image is
    // nginx-php8), and octobercms pins its own, so offering a control for those
    // would be lying about what the CLI will do.
    await win.click(`${t('framework-laravel')} input`);
    check('laravel offers a version field', await win.isVisible('#laravel-version-group'));
    await win.click(`${t('framework-wordpress')} input`);
    check('wordpress offers a version field', await win.isVisible('#wordpress-version-group'));
    for (const fw of ['php', 'django', 'octobercms', 'express']) {
      await win.click(`${t(`framework-${fw}`)} input`);
      const anyVersion = (await win.isVisible('#laravel-version-group'))
        || (await win.isVisible('#wordpress-version-group'));
      check(`${fw} offers no version field`, !anyVersion);
    }

    // The catalogue note is the only thing that explains an in-house framework.
    await win.click(`${t('framework-kavera')} input`);
    const kaveraNote = await win.textContent('#framework-note');
    check('shows the catalogue note for an in-house framework',
      (kaveraNote || '').length > 20, kaveraNote || '<empty>');

    // Same trap as the install modal: 13 frameworks plus a long catalogue note
    // makes this form tall enough to push the submit button off screen.
    const submitVisible = await win.locator(t('create-project-submit')).evaluate((el) => {
      const box = el.getBoundingClientRect();
      return box.bottom <= window.innerHeight && box.top >= 0 && box.height > 0;
    });
    check('create button stays within the viewport with the full catalogue', submitVisible);

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
    // --- Modal wiring ---------------------------------------------------
    console.log('\nmodal wiring');

    // The Help modal was nested INSIDE the About modal, so adding .show to it
    // could never make it visible — its parent is display:none. The button had
    // never worked. Assert the structural fact, not just the symptom.
    const nesting = await win.evaluate(() => {
      const help = document.getElementById('help-modal');
      const about = document.getElementById('about-modal');
      return {
        exists: !!help,
        nestedInAnotherModal: !!help && !!help.closest('.modal:not(#help-modal)'),
        insideAbout: !!(about && help && about.contains(help))
      };
    });
    check('help modal is not nested inside another modal',
      nesting.exists && !nesting.nestedInAnotherModal && !nesting.insideAbout,
      JSON.stringify(nesting));

    // Every modal must be a top-level element for the same reason.
    const badlyNested = await win.evaluate(() =>
      [...document.querySelectorAll('.modal')]
        .filter((m) => m.parentElement && m.parentElement.closest('.modal'))
        .map((m) => m.id));
    check('no modal is nested inside another', badlyNested.length === 0, badlyNested.join(','));

    for (const id of ['help-modal', 'about-modal']) {
      await win.evaluate((m) => window.showModal(m), id);
      await win.waitForTimeout(400);
      check(`${id} actually becomes visible`, await win.isVisible(`#${id}`));
      await win.evaluate(() => window.closeModal());
      await win.waitForTimeout(300);
    }

    // showFieldError used to delete the markup's <div id="…-error"> and append
    // an id-less replacement, making every one of those ids dead weight.
    const errorSlots = await win.evaluate(() => {
      const before = [...document.querySelectorAll('[id$="-error"]')].map((e) => e.id);
      window.showFieldError('create-idea', 'test message');
      const after = [...document.querySelectorAll('[id$="-error"]')].map((e) => e.id);
      const filled = document.getElementById('create-idea-error')?.textContent || '';
      window.clearFieldErrors();
      const cleared = document.getElementById('create-idea-error')?.textContent || '';
      const survived = [...document.querySelectorAll('[id$="-error"]')].map((e) => e.id);
      return { before: before.length, after: after.length, filled, cleared, survived: survived.length };
    });
    check('showFieldError writes into the markup\'s own error slot',
      errorSlots.filled === 'test message', JSON.stringify(errorSlots));
    check('clearFieldErrors empties rather than destroys the slot',
      errorSlots.cleared === '' && errorSlots.survived === errorSlots.before,
      JSON.stringify(errorSlots));

    // --- AI agent settings ----------------------------------------------
    console.log('\nai agent settings');
    await win.click(t('settings-open'));
    await win.waitForSelector('#settings-modal.show', { timeout: 8000 });
    check('Settings panel opens', await win.isVisible('#settings-modal'));

    // Settings opens on Appearance; the AI form lives behind the second tab.
    check('Settings opens on the Appearance tab',
      await win.isVisible('[data-settings-panel="appearance"]')
      && !(await win.isVisible('[data-settings-panel="ai"]')));

    await win.click(t('settings-tab-ai'));
    await win.waitForTimeout(150);
    check('AI tab reveals the agent form', await win.isVisible('#ai-agent'));

    const agentOptions = await win.locator('#ai-agent option').evaluateAll((o) => o.map((x) => x.value));
    check('offers every agent the CLI supports plus none',
      ['', 'claude', 'codex', 'gemini', 'aider'].every((a) => agentOptions.includes(a)),
      agentOptions.join(','));

    // aider is the only agent needing a model and an endpoint — ai-set --help
    // marks model and key required for it, and --api-base is aider-only.
    await win.selectOption('#ai-agent', 'aider');
    await win.waitForTimeout(250);
    check('aider reveals the API endpoint field', await win.isVisible('#ai-api-base-group'));
    check('aider marks the model required',
      /required/i.test((await win.textContent('#ai-model-req')) || ''));

    await win.fill(t('ai-model'), '');
    await win.click(t('ai-settings-save'));
    await win.waitForTimeout(600);
    check('aider without a model is rejected before shelling out',
      ((await win.textContent('#ai-model-error')) || '').length > 0,
      await win.textContent('#ai-model-error'));


    // qwen is the fifth agent, but only offered when the INSTALLED CLI has it.
    // The cheap-models support is on podium-cli `dev`, not its `master`, so a
    // current install has no qwen — offering it would produce "Unsupported AI
    // agent" at the point of use. The GUI adapts rather than assuming.
    const caps = await app.evaluate(async ({ ipcMain }) =>
      ipcMain._invokeHandlers.get('get-cli-capabilities')({}));
    const qwenUsable = await win.evaluate(() => {
      const o = document.querySelector('#ai-agent option[value="qwen"]');
      return !!o && !o.hidden && !o.disabled;
    });
    check('qwen offered exactly when the installed CLI supports it',
      qwenUsable === caps.qwen, `cli.qwen=${caps.qwen} offered=${qwenUsable}`);

    const localPresetsUsable = await win.evaluate(() => {
      const o = document.querySelector('#ai-preset option[value="ollama"]');
      return !!o && !o.hidden && !o.disabled;
    });
    check('local presets follow the same capability',
      localPresetsUsable === caps.qwen, `cli.qwen=${caps.qwen} presets=${localPresetsUsable}`);

    // --api-base is no longer aider-only: the CLI passes it to whichever env var
    // each agent reads. gemini is the only one with no endpoint at all.
    for (const [agent, shouldShow] of [['codex', true], ['qwen', true], ['claude', true], ['gemini', false]]) {
      await win.selectOption('#ai-agent', agent);
      await win.waitForTimeout(250);
      check(`${agent} endpoint field ${shouldShow ? 'shown' : 'hidden'}`,
        (await win.isVisible('#ai-api-base-group')) === shouldShow);
    }

    // claude needs an Anthropic-compatible proxy — pointing it at a raw Ollama
    // URL is the obvious mistake, so the note has to say so.
    await win.selectOption('#ai-agent', 'claude');
    await win.waitForTimeout(200);
    check('claude endpoint note warns it must be Anthropic-compatible',
      /anthropic/i.test((await win.textContent('#ai-api-base-help')) || ''),
      await win.textContent('#ai-api-base-help'));

    // Presets are the part users actually use.
    const presets = await win.locator('#ai-preset option').evaluateAll((o) => o.map((x) => x.value));
    check('offers the local/cheap presets',
      ['hosted', 'ollama', 'openrouter', 'lmstudio'].every((p) => presets.includes(p)),
      presets.join(','));

    await win.selectOption('#ai-preset', 'ollama');
    await win.waitForTimeout(600);
    const ollama = await win.evaluate(() => ({
      agent: document.getElementById('ai-agent').value,
      base: document.getElementById('ai-api-base').value,
      warning: document.getElementById('ai-local-warning').style.display
    }));
    check('Ollama preset fills agent and endpoint',
      ollama.agent === 'qwen' && /11434/.test(ollama.base), JSON.stringify(ollama));
    check('a local endpoint surfaces the VRAM warning', ollama.warning === 'block',
      'small models return confident wrong answers — this must be visible');

    await win.selectOption('#ai-preset', 'openrouter');
    await win.waitForTimeout(400);
    const remote = await win.evaluate(() => ({
      model: document.getElementById('ai-model').value,
      warning: document.getElementById('ai-local-warning').style.display
    }));
    check('OpenRouter preset fills a model', remote.model.length > 0, remote.model);
    check('a remote endpoint hides the VRAM warning', remote.warning === 'none');

    // Switching agents must clear the previous agent's validation message —
    // "aider requires a model" sitting under a field marked (optional) was
    // visible in a screenshot while every assertion passed.
    check('switching agents clears the stale validation error',
      ((await win.textContent('#ai-model-error')) || '').trim() === '',
      await win.textContent('#ai-model-error'));

    await screenshot(win, '08-ai-settings');

    // --- Themes ----------------------------------------------------------
    // The risk here is not "does the attribute change" but "does the theme
    // leave anything unreadable". Contrast is asserted numerically rather than
    // eyeballed from the screenshots, because a low-contrast theme looks fine
    // in a thumbnail and is miserable to actually use.
    console.log('\nthemes');
    await win.click(t('settings-tab-appearance'));
    await win.waitForTimeout(150);

    const swatches = await win.locator('[data-theme-option]').evaluateAll((els) =>
      els.map((e) => e.dataset.themeOption));
    check('offers all five themes',
      ['retro', 'dark', 'light', 'matrix', 'podium'].every((x) => swatches.includes(x)),
      swatches.join(','));

    // Relative luminance per WCAG, so the ratio below is the real thing rather
    // than a rough proxy.
    const contrast = (hex1, hex2) => {
      const lum = (hex) => {
        const c = hex.replace('#', '');
        const v = [0, 2, 4].map((i) => {
          const s = parseInt(c.slice(i, i + 2), 16) / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
      };
      const [a, b] = [lum(hex1), lum(hex2)].sort((x, y) => y - x);
      return (a + 0.05) / (b + 0.05);
    };

    for (const theme of ['retro', 'dark', 'light', 'matrix', 'podium']) {
      await win.click(t(`theme-${theme}`));
      await win.waitForTimeout(200);

      const applied = await win.evaluate(() =>
        document.documentElement.getAttribute('data-theme'));
      check(`${theme}: applies to the document`, applied === theme, applied);

      const readable = await win.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        return {
          bg: cs.getPropertyValue('--bg-primary').trim(),
          fg: cs.getPropertyValue('--text-primary').trim(),
          muted: cs.getPropertyValue('--text-muted').trim(),
          termBg: cs.getPropertyValue('--term-bg').trim(),
          termFg: cs.getPropertyValue('--term-fg').trim()
        };
      });

      // 4.5:1 is the WCAG AA threshold for body text.
      const bodyRatio = contrast(readable.bg, readable.fg);
      check(`${theme}: body text clears 4.5:1 (${bodyRatio.toFixed(1)}:1)`, bodyRatio >= 4.5);

      // Muted text is secondary, so 3:1 (AA large / UI) is the bar.
      const mutedRatio = contrast(readable.bg, readable.muted);
      check(`${theme}: muted text clears 3:1 (${mutedRatio.toFixed(1)}:1)`, mutedRatio >= 3);

      // The one the user explicitly called out: a theme that turns terminal
      // output into mush is worse than not having the theme.
      const termRatio = contrast(readable.termBg, readable.termFg);
      check(`${theme}: terminal text clears 4.5:1 (${termRatio.toFixed(1)}:1)`, termRatio >= 4.5);

      await screenshot(win, `08-theme-${theme}`);
    }

    // Every ANSI colour must be legible on its own theme's terminal background.
    // Light is the one that breaks if the palette is copied from a dark theme:
    // bright yellow and bright white on white are invisible. A build printing
    // npm warnings is the first place a user would notice, so assert it here.
    const palettes = await win.evaluate(() => window.__terminalThemes || null);
    check('terminal palettes exposed for assertion', !!palettes);

    if (palettes) {
      const ansiNames = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
        'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta',
        'brightCyan', 'brightWhite'];
      for (const [theme, pal] of Object.entries(palettes)) {
        // 3:1 is the bar for coloured terminal output: it is decoration on top
        // of text that is already legible in the default foreground, and
        // holding ANSI green to 4.5:1 would force it grey-dark on every theme.
        const weak = ansiNames
          .map((n) => [n, contrast(pal.background, pal[n])])
          .filter(([, r]) => r < 3)
          .map(([n, r]) => `${n} ${r.toFixed(1)}:1`);
        check(`${theme}: every ANSI colour clears 3:1 on its terminal background`,
          weak.length === 0, weak.join(', '));
      }
    }

    // Back to the default so the rest of the run and the screenshots are
    // consistent with every previous baseline.
    await win.click(t('theme-retro'));
    await win.waitForTimeout(200);

    await win.click(t('settings-tab-ai'));
    await win.waitForTimeout(150);
    await win.click('#settings-modal .modal-close');
    await win.waitForTimeout(300);

    // --- Loading overlay output -----------------------------------------
    // Scaffolding runs composer/npm/pip for minutes; the overlay used to show a
    // spinner and nothing else, and it is what captured the nestjs failure.
    console.log('\nloading overlay');
    const overlay = await win.evaluate(async () => {
      window.showLoadingOverlay('Test', 'streaming', true);
      const before = document.getElementById('loading-output').style.display;
      // Simulate what execute-command-stream sends.
      window.__feedOverlay('hello from the CLI\n');
      await new Promise((r) => setTimeout(r, 200));
      const text = document.getElementById('loading-output').textContent;
      window.hideLoadingOverlay();
      const after = document.getElementById('loading-output').style.display;
      return { before, text, afterHidden: after };
    });
    check('overlay shows an output pane when streaming', overlay.before === 'block', overlay.before);
    check('overlay renders streamed output', /hello from the CLI/.test(overlay.text || ''), overlay.text);

    const quiet = await win.evaluate(() => {
      window.showLoadingOverlay('Test', 'no stream');
      const shown = document.getElementById('loading-output').style.display;
      window.hideLoadingOverlay();
      return shown;
    });
    check('overlay stays clean for short actions', quiet === 'none', quiet);

    // A failed create keeps the overlay up with its output, rather than
    // concatenating all of stdout — curl progress bars included — into a toast.
    const failState = await win.evaluate(async () => {
      window.showLoadingOverlay('Creating', 'working', true);
      window.__feedOverlay('some/output\nComposer could not find a composer.json file\n');
      window.failLoadingOverlay('Could not create the project', 'podium new exited with code 1.');
      await new Promise((r) => setTimeout(r, 200));
      const spinner = document.querySelector('#loading-overlay .loading-spinner');
      return {
        overlayVisible: document.getElementById('loading-overlay').style.display !== 'none',
        outputVisible: document.getElementById('loading-output').style.display === 'block',
        outputKept: document.getElementById('loading-output').textContent.includes('composer.json'),
        dismissShown: document.getElementById('loading-dismiss').style.display !== 'none',
        spinnerHidden: spinner.style.display === 'none',
        message: document.getElementById('loading-message').textContent
      };
    });
    check('failure keeps the overlay and its output on screen',
      failState.overlayVisible && failState.outputVisible && failState.outputKept,
      JSON.stringify(failState));
    check('failure swaps the spinner for a dismiss button',
      failState.spinnerHidden && failState.dismissShown, JSON.stringify(failState));

    await win.evaluate(() => window.hideLoadingOverlay());
    const restored = await win.evaluate(() => ({
      spinner: document.querySelector('#loading-overlay .loading-spinner').style.display,
      dismiss: document.getElementById('loading-dismiss').style.display
    }));
    check('dismissing restores the overlay for next time',
      restored.spinner !== 'none' && restored.dismiss === 'none', JSON.stringify(restored));

    // --- Terminals ------------------------------------------------------
    //
    // Sessions are independent and must survive the window being hidden — the
    // previous single-session design silently orphaned a running pty whenever a
    // second terminal opened.
    console.log('\nterminals');
    const termState = await win.evaluate(async () => {
      const mk = (key, title) => window.openAgentTerminal({
        title, status: 'test', cwd: '/tmp', command: 'sh',
        args: ['-c', 'echo hello-' + key + '; sleep 120'], sessionKey: key
      });
      await mk('t-alpha', 'alpha');
      await mk('t-beta', 'beta');
      await new Promise((r) => setTimeout(r, 1200));
      return {
        sessions: window.__terminalCount(),
        tabs: document.querySelectorAll('#terminal-tabs .terminal-tab').length,
        panes: document.querySelectorAll('#terminal-panes .terminal-pane').length,
        visiblePanes: [...document.querySelectorAll('#terminal-panes .terminal-pane')]
          .filter((p) => p.style.display !== 'none').length
      };
    });
    check('two terminals run at once', termState.sessions === 2, JSON.stringify(termState));
    check('one tab per session', termState.tabs === 2, `${termState.tabs} tabs`);
    check('exactly one pane visible at a time', termState.visiblePanes === 1,
      `${termState.visiblePanes} visible`);

    // Re-opening the same target focuses rather than spawning a duplicate agent.
    const dupe = await win.evaluate(async () => {
      await window.openAgentTerminal({
        title: 'alpha', status: 'test', cwd: '/tmp', command: 'sh',
        args: ['-c', 'sleep 120'], sessionKey: 't-alpha'
      });
      await new Promise((r) => setTimeout(r, 400));
      return window.__terminalCount();
    });
    check('reopening the same target does not duplicate the session', dupe === 2, `${dupe}`);

    // Hiding the window keeps sessions alive; that is what the header button
    // exists to get back to.
    const afterHide = await win.evaluate(async () => {
      window.hideTerminals();
      await new Promise((r) => setTimeout(r, 400));
      return {
        count: window.__terminalCount(),
        modalOpen: document.getElementById('build-terminal-modal').classList.contains('show'),
        buttonShown: document.getElementById('terminals-button').style.display !== 'none'
      };
    });
    check('hiding the window leaves sessions running', afterHide.count === 2 && !afterHide.modalOpen,
      JSON.stringify(afterHide));
    check('header offers a way back to running terminals', afterHide.buttonShown);

    // The terminal must fit inside its panel — a fixed height overflowed it.
    const fits = await win.evaluate(async () => {
      window.showTerminals();
      await new Promise((r) => setTimeout(r, 600));
      const body = document.querySelector('#build-terminal-modal .modal-body');
      const panes = document.getElementById('terminal-panes');
      const content = document.querySelector('#build-terminal-modal .modal-content');
      return {
        panesBottom: panes.getBoundingClientRect().bottom,
        bodyBottom: body.getBoundingClientRect().bottom,
        contentBottom: content.getBoundingClientRect().bottom,
        viewport: window.innerHeight
      };
    });
    check('terminal stays inside its panel',
      fits.panesBottom <= fits.bodyBottom + 1 && fits.contentBottom <= fits.viewport + 1,
      JSON.stringify(fits));

    // Closing a tab ends only that session.
    const afterKill = await win.evaluate(async () => {
      window.__killFirstTerminal();
      await new Promise((r) => setTimeout(r, 600));
      return window.__terminalCount();
    });
    check('closing one tab ends only that session', afterKill === 1, `${afterKill}`);

    await screenshot(win, '07-terminals');
    await win.evaluate(async () => {
      window.__killAllTerminals();
      await new Promise((r) => setTimeout(r, 400));
    });

    // --- Installers -----------------------------------------------------
    //
    // Shell, not UI, but they belong in the same gate: each behaviour below was
    // found by running installers on clean machines, and each is invisible
    // until it bites. A syntax slip or a dropped guard should fail here rather
    // than on someone's fresh install.
    console.log('\ninstallers');
    const { execSync } = require('child_process');
    const fsMod = require('fs');
    const pathMod = require('path');
    const { ROOT } = require('./helpers');

    const REQUIRED = [
      // Cloud images and CI grant NOPASSWD alongside a password-requiring rule,
      // and plain `sudo -v` prompts anyway — which aborted the CLI installer.
      ['probes sudo -n before sudo -v', /sudo -n true/],
      // set -e is inherited by the subshell; without `|| true` the keepalive
      // dies instantly and the trap kills a dead PID.
      ['guards the sudo keepalive', /sudo -n -v 2>\/dev\/null \|\| true/],
      // A bare `exit` returns the status of `kill`, reporting failure after a
      // fully successful install.
      ['trap preserves the exit status', /trap 'rc=\$\?;/],
      // Otherwise ./podium-gui/install-*.sh from the parent silently re-clones
      // instead of installing the checkout you are standing in.
      ['detects a local checkout', /BASH_SOURCE\[0\]/],
      // The GUI is useless without the CLI, so it is never installable alone.
      ['installs the CLI first', /command -v podium/],
      // Ubuntu 24.04 still ships Node 18; presence is not enough.
      ['checks the Node VERSION, not just presence', /NODE_MIN_MAJOR/],
      // node-pty must match Electron's ABI or the embedded terminal fails.
      ['rebuilds native modules for Electron', /electron\/rebuild/]
    ];

    for (const file of ['install-ubuntu.sh', 'install-fedora.sh', 'install-arch.sh', 'install-mac.sh']) {
      const full = pathMod.join(ROOT, file);
      check(`${file} exists and is executable`,
        fsMod.existsSync(full) && (fsMod.statSync(full).mode & 0o111) !== 0);

      let syntaxOk = true;
      try {
        execSync(`bash -n ${JSON.stringify(full)}`, { stdio: 'pipe' });
      } catch (error) {
        syntaxOk = false;
      }
      check(`${file} parses`, syntaxOk);

      const body = fsMod.readFileSync(full, 'utf8');
      const missing = REQUIRED.filter(([, re]) => !re.test(body)).map(([label]) => label);
      check(`${file} keeps every hard-won guard`, missing.length === 0, missing.join('; '));
    }

    // Arch-only landmines, both from the CLI's installer.
    const archBody = fsMod.readFileSync(pathMod.join(ROOT, 'install-arch.sh'), 'utf8');
    check('arch initialises the pacman keyring', /pacman-key --init/.test(archBody));
    check('arch warns when the running kernel was replaced',
      /usr\/lib\/modules\/\$\(uname -r\)/.test(archBody));

    // The menu entry must invoke the launcher. `podium gui` is not a CLI
    // subcommand — it printed "Unknown command: gui" and did nothing.
    const desktop = fsMod.readFileSync(
      pathMod.join(ROOT, 'packaging/debian-package/usr/share/applications/podium-gui.desktop'), 'utf8');
    check('desktop entry execs the launcher, not a nonexistent subcommand',
      /^Exec=podium-gui$/m.test(desktop), desktop.match(/^Exec=.*$/m)?.[0] || '');
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
