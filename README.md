# Podium GUI

## Podium, without the terminal

**Describe what you want to build, pick from what it suggests, and watch it go — plus a live view of every project and service on the machine.**

A desktop front end for [Podium CLI](https://github.com/CaneBayComputers/podium-cli). The CLI does the work; the GUI makes it visible and clickable. Same projects, same shared services, same URLs — you can switch between the two freely.

---

## What it does

- **Create with AI** — describe a project in plain English. Podium works out the stack, shows you the candidates with a reason for each, and lets you choose the app or framework, the database and the name before anything is created.
- **Install an app** — browse and search the 100+ app library, install with a name. The database comes fixed by the installer, so there is nothing to get wrong.
- **New project** — scaffold any supported framework with a database of your choosing.
- **Clone** — pull an existing repo into a Podium project, work directly or fork it.
- **Modify with AI** — every project tile can reopen its AI session where you left off, in an embedded terminal.
- **Services at a glance** — start, stop and flush the shared services; live status for every project.
- **Embedded terminals, tabbed** — AI sessions run in real terminals inside the window. Several at once, each in its own tab; hiding the window leaves them running.
- **AI agent setup** — choose between Claude, Codex, Gemini and Aider from the app. Podium installs the one you pick if it is not already on the machine.
- **Live output** — creates and installs stream their CLI output as they run, and a failure keeps that output on screen instead of hiding it.

Projects get PHP 8.3, Python 3 or Node 22 containers with nginx, supervisor and the database drivers already compiled in, and a real hostname instead of a port number.

---

## Requirements

- **Podium CLI** — installed automatically if missing; the GUI cannot run without it.
- **Docker** — for the containers.
- **Node 20+** — for building from source only. Not needed to run a release.

---

## Install

```bash
git clone https://github.com/CaneBayComputers/podium-gui.git
cd podium-gui
./install-ubuntu.sh          # or install-fedora.sh / install-arch.sh / install-mac.sh
```

**The Podium CLI is installed first if it is missing.** The GUI is a front end for the CLI and is useless without it, so it is never installable alone — if `podium` is not on PATH, the matching CLI installer runs first (from a sibling `podium-cli/` checkout when there is one, otherwise fetched from GitHub).

Run the installer from a checkout and *that* checkout is installed (symlinked) rather than a fresh clone, so a development tree stays the live install.

On first launch, if Podium has not been configured yet, the GUI collects what `podium configure` needs and runs it for you.

Three things the installers handle that are worth knowing about:

- **Node is version-checked, not just detected.** Ubuntu 24.04 still ships Node 18, which is too old for the build tooling, so the installer upgrades to 20+.
- **`node-pty` is rebuilt against Electron's ABI**, or the embedded build terminal cannot load. A failure here is a warning, not an abort — the GUI works without it.
- **`xdotool`/`wmctrl`** are installed to support `--no-focus`; without them the window still opens unfocused.

---

## Development

```bash
npm install
npm run dev          # build TypeScript, then launch
npm run build-ts     # types only
npm run build        # package for distribution
```

### Launching without stealing focus

```bash
electron dist/main.js --no-focus
```

Opens the window **unfocused and behind the other windows**, for background or automated launches — a test run should not grab the keyboard from whoever is at the machine. The e2e harness passes it automatically.

On X11 the stacking part uses `wmctrl`/`xdotool` if either is installed; without them the window still opens unfocused, which is the part that matters. The `below` hint is cleared the first time the window is focused, so once you click it, it behaves like any other window. A normal launch focuses as usual.

---

## Testing

The GUI is driven end-to-end with Playwright, which supports Electron natively — it launches the real app, queries and clicks the renderer DOM, and can call into the **main** process to exercise IPC handlers directly.

```bash
npm run test:e2e     # builds TypeScript, then runs tests/e2e.js
```

The suite is deliberately **read-only**: it never creates, installs, clones or removes a project, and never stops the shared services. It does require Podium to be installed and configured (`/etc/podium-cli/.env` with `PROJECTS_DIR`), since it asserts against real `podium status` output. A real `podium install` run is verified separately on a throwaway box.

Screenshots land in a gitignored `debug/` directory with predictable names (`01-dashboard.png`, `02-install-picker.png`, …), so a failing run can point at an exact image.

### Writing tests

Select elements by `data-testid`, never by CSS class or DOM position — restyling must not break selectors, or an agent silently clicks the wrong thing:

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

Two traps, both of which produced convincing false results here:

- **Screenshot animations.** Modals animate in (`fadeIn` + `scaleIn`, 0.3s). Capturing immediately yields a half-transparent overlay that looks like a serious CSS bug. `helpers.screenshot()` passes `animations: 'disabled'` to fast-forward them; use it rather than `win.screenshot()` directly.
- **`offsetParent` on fixed elements.** The loading splash is `position: fixed`, and fixed elements always report `offsetParent === null` — so using that to detect "hidden" passes instantly and every subsequent assertion races the initial render. Check `display`/`visibility` instead.

---

## License

MIT — see [LICENSE](LICENSE). Same as [Podium CLI](https://github.com/CaneBayComputers/podium-cli). Free to use, modify and distribute.

## Support

- 📧 canebaycomputers@gmail.com
- 🐛 [Issues](https://github.com/CaneBayComputers/podium-gui/issues)
- 📖 [Podium documentation](https://podiumcli.com/guide/)

---

© 2024 Cane Bay Computers. Released under the MIT License.
