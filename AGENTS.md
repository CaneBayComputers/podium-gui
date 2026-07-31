# AGENTS.md — Podium GUI

Brief for an AI agent working on this repo. Written 2026-07-31 from a session that
had just spent a long day inside the Podium CLI, so the CLI facts here are current
as of `podium-cli` commit `f2e3ea3` (branch `beta`).

---

## 0. Read these first, before writing any code

In this order:

1. `/usr/local/share/podium-cli/AGENTS.md` — the condensed platform reference. Shared
   services, hostnames, credentials, VPC layout, base images, installer format.
2. `/usr/local/share/podium-cli/README.md` — the human framing and the "why".
3. `/usr/local/share/podium-cli/DEVELOPMENT.md` — internals, only if you need them.
4. **Run `podium help`** — and `podium <command> --help` for anything you intend to
   call. The docs describe intent; `--help` is the argument contract, and it is the
   thing that has actually moved.

Full published docs: <https://canebaycomputers.github.io/podium-cli/guide/>

### The podium-cli directory is READ-ONLY to you

`/usr/local/share/podium-cli` (and `~/repos/podium/podium-cli` — same directory, one
shared clone via symlink) is a **different project**. Read it freely. Do **not** edit,
stage, commit, or `git` anything in it. If you find a CLI bug, write it down and
report it; do not fix it from here. Two agents editing one working tree at once has
already caused a near-miss in this codebase.

---

## 1. Every CLI call in this repo is out of date

The GUI was last pushed **September 2025**. The CLI has changed substantially since —
including a complete rework of `podium create`. **Assume nothing here still works
until you have re-verified it against `--help`.**

Audited on 2026-07-31. What this repo currently calls:

`projects-dir`, `configure`, `up`, `down`, `status`, `start-services`, `stop-services`,
`new`, `clone`, `setup`, `remove`

Confirmed breakages, not hypothetical:

| Where | Problem |
|---|---|
| `src/renderer.ts` ~1181 | Passes `--emoji`. **`podium new` does not accept it.** |
| `src/renderer.ts` ~1203 | Passes `--org`. The flag is **`--github-org`**. |
| `podium new` | Signature is now `podium new <framework> <name>` — framework is the **first positional**, not a flag. |
| `podium clone` | Now requires a **mode as the first argument**: `work-directly`, `fork`, or `new-repo`. |
| `podium remove` | **Preserves the database by default.** Pass `--force-db-delete` to drop it. |
| `podium configure` | No longer asks for AWS or GitHub at all. Gained `--non-interactive`. |
| `podium status` | Only lists **running** projects by default; `--all` includes stopped. |

What this repo does not know exists at all:

- **`podium create`** — the flagship path (see §2)
- **`podium install`** — the entire 100+ app library
- `up-all` / `down-all`
- `enable-service` / `disable-service` — optional shared services (MinIO, Meilisearch)
- `resume`, `ai`, `ai-set`
- The full dev-tool surface: `exec`, `shell`, `composer`, `art`, `npm`, `django`, `supervisor`, …

Run `podium help` and diff it against what the GUI offers. That gap is the roadmap.

### `--json-output` — read this before relying on it

The GUI already uses `--json-output` in ~15 places. Two things to know:

- Not every command supports it. Container-execution commands (`exec`, `composer`,
  `art`, `npm`, `shell`, `supervisor`, `redis`, `memcache`) do not.
- It suppresses **all** human-readable output, including error text. A command can
  fail with exit 1 and an **empty stdout**. That exact bug was found and fixed in
  `podium create` this week, but assume other commands still have it. **Always check
  the exit code — never infer success from parseable output alone.**

---

## 2. Three ways to create a project. Lead with `podium create`.

This distinction is the single most important thing to get right in the UI. They are
not variations of one flow; they are three different products.

### A. `podium create "<plain english idea>"` — lead with this

The flagship. The user describes what they want; Podium works out the stack and
builds it. **This should be the primary, most prominent path in the GUI** — the big
obvious thing on the landing screen. The other two are for people who already know
exactly what they want.

It now runs in three phases:

1. **Classify** — the AI is asked *only* which stack fits and answers in JSON:
   ranked ready-to-run apps, exactly one framework, a recommended database with a
   reason, and a suggested project name (or `null` if the idea doesn't imply one).
2. **Create** — **Podium** runs `podium new` or `podium install` itself.
   No AI involved in creation.
3. **Build** — the original idea goes to the agent inside the finished project.
   Skipped entirely when the request was just "install app X".

**This is the hard part for a GUI:** between phases 1 and 2 the CLI presents
*interactive terminal menus* — pick app vs framework, pick a database, confirm the
project name. A GUI shelling out to `podium create` will hang on those menus.

Non-interactive mode (`--one-off`, `--json-output`, or no TTY) silently auto-picks the
top recommendation, which loses the user's choice — the whole point of the menus.

The right design is almost certainly: **do not shell out to `podium create` as one
call.** Instead drive the phases yourself — run the classifier, render the choices as
native GUI components, then call `podium install` or `podium new` directly with the
user's picks. Read `src/scripts/classify.sh` and `src/scripts/create.sh` to see the
contract. Confirm this approach before building it; it may want a CLI-side flag to
emit the classification as JSON and stop, which would be a **CLI change to request,
not to make yourself**.

### B. `podium new <framework> <name>` — scaffold a project you write

Gives you an empty project **you build**. 13 frameworks:

`laravel`, `kavera`, `octobercms`, `wordpress`, `php`, `fastapi`, `flask`, `django`,
`python`, `express`, `nestjs`, `fastify`, `node`

Database auto-selected per framework; override with `--database mysql|postgres|mongodb|sqlite`.
Not every framework supports every engine — WordPress is MySQL-only, Django has no
native MongoDB. The authoritative matrix is `src/catalog/frameworks.json` in podium-cli.
**Read that file rather than hardcoding a list in the GUI.**

### C. `podium install <app> [name]` — deploy a finished app

Gives you software **someone else wrote**, already built. 102 installers. The database
is **fixed by the installer** — never ask the user to choose one for an app.

The catalogue lives in `src/catalog/apps.json` (slug, display name, database). It is
generated from the installers, so read it rather than maintaining your own list.

**Do not blur B and C in the UI.** "New project" and "Install an app" are different
user intentions. The CLI itself now detects a mix-up and redirects
(`podium new grafana` → "that's an app, use `podium install`"); the GUI should simply
not create the confusion.

---

## 3. Installers for the GUI — piggyback the CLI's

Ship four installers matching the CLI's, same platforms, same shape:

`install-ubuntu.sh`, `install-fedora.sh`, `install-arch.sh`, `install-mac.sh`

Do not reinvent them. Read the CLI's four as the template — they encode a lot of hard-won
behaviour, all of it found by running them on clean machines:

- Probe `sudo -n true` **before** `sudo -v`. Cloud images and CI runners grant NOPASSWD
  alongside a password-requiring rule, and plain `sudo -v` prompts anyway — it aborted
  the installer outright on Fedora and Ubuntu cloud images.
- Guard the sudo-keepalive loop with `|| true`, and capture `$?` in the EXIT trap.
  Without both, a successful install exits non-zero.
- Detect a local checkout from `BASH_SOURCE`, falling back to `pwd` — otherwise running
  `./podium-gui/install-ubuntu.sh` from the parent directory silently re-clones instead
  of linking the checkout.
- Arch: initialise the pacman keyring if absent, and detect when `pacman -Syu` replaced
  the running kernel (Docker cannot start until reboot).
- Fedora: `dnf5` dropped `config-manager --add-repo` in favour of `addrepo`.

**The intended flow is: the GUI installer calls the CLI installer first** (or checks
`command -v podium` and installs it if missing), then installs the GUI itself. The GUI
is useless without the CLI, so it should never be installable alone.

### First run → `podium configure`

On first launch, if `/etc/podium-cli/.env` is missing or `PROJECTS_DIR` is unset, run
the setup. `podium configure` now supports full non-interactive use:

```
podium configure --non-interactive \
  --git-name "..." --git-email "..." \
  --projects-dir "..." [--vpc-subnet A.B.C]
```

It no longer asks about AWS or GitHub — both were removed as first-run friction — and
the VPC subnet is chosen automatically. So the GUI can collect the two or three fields
it genuinely needs in a native form and pass them as flags. Do not try to drive the
interactive wizard through a pty.

---

## 4. AI-drivable GUI — use Playwright, not MCP

The requirement: an AI agent should be able to drive this GUI directly — click things,
read state, and **take screenshots for debugging and development** — the way Playwright
drives a browser.

**Playwright already supports Electron natively.** This is not a workaround; it is a
first-class API:

```js
const { _electron: electron } = require('playwright');

const app = await electron.launch({ args: ['dist/main.js'] });
const win = await app.firstWindow();

await win.click('#create-project');
await win.screenshot({ path: 'debug/create-screen.png' });

// and it can reach into the MAIN process, not just the renderer:
const projectsDir = await app.evaluate(async ({ app }) => app.getPath('userData'));

await app.close();
```

That gives an agent: launch, full DOM query/click/type in the renderer, `evaluate` in
the main process (so IPC handlers can be exercised directly), screenshots, and video.
It is strictly more capable than an MCP wrapper and needs no protocol of your own.

What to build on top of it:

- A `test:e2e` script and a `tests/` directory, so driving the GUI is a normal,
  documented action rather than something bespoke.
- **Stable `data-testid` attributes on every interactive element.** This is the part
  that actually determines whether AI control works. Selectors built from CSS classes
  or DOM position break on every restyle; the agent then silently clicks the wrong
  thing. Add them as you touch each component.
- A screenshot helper that writes to a gitignored `debug/` directory with predictable
  names, so an agent can point a human at an exact image.
- Consider `--remote-debugging-port` in dev builds as a fallback: it exposes CDP, which
  anything speaking Chrome DevTools Protocol can attach to.

MCP is still worth adding **later**, but for a different job — exposing GUI actions to
an agent that isn't running a test harness. Playwright is the right tool for
"test the GUI and screenshot it for debugging", which is what was asked for.

---

## 5. Keep TypeScript

Decided 2026-07-31. This is ~3,300 lines across `main.ts`, `renderer.ts`, `installer.ts`,
with 8+ IPC channels (`execute-podium`, `execute-command-stream`, `get-project-status`,
`select-directory`, …). Electron IPC is stringly-typed message passing across a process
boundary — a wrong channel name or payload shape fails **silently at runtime**. That is
exactly where types pay for themselves.

If the language is revisited, do it as an isolated change **after** the CLI re-sync,
never during. Otherwise every bug is ambiguous: contract drift, or migration slip?

---

## 6. Suggested order of work

1. Re-establish the CLI contract. Audit every call against `--help`, fix `--emoji` and
   `--org` first — those are certain breakage. Get the existing GUI working again
   before adding anything.
2. Add `podium install` — the largest missing capability, and the easiest to get right
   because the catalogue is a JSON file and there are no interactive menus.
3. Add Playwright + `data-testid` attributes. Do this **before** the big `create` work,
   so the hardest feature is the first one you can actually watch the AI test.
4. Design the `podium create` flow, phases driven natively (see §2A). Confirm the
   approach before building.
5. Installers and first-run configure.

---

## 7. Things that will bite you

- **`podium status` output changed.** Running-only by default. If the GUI shows an empty
  project list, that is probably why.
- **`podium remove` keeps the database now.** A GUI "delete project" button that assumes
  the old behaviour will leave databases behind. Decide deliberately and label the UI
  to match.
- **Optional shared services exist.** MinIO and Meilisearch are off unless enabled per
  machine; check `OPTIONAL_SERVICES` in `/etc/podium-cli/.env` before showing them.
- **Never pass `--json-output` when you need to know *why* something failed.** See §1.
- **`podium create` and `podium configure` are the only interactive commands.**
  Everything else fails with a clear "required argument" error rather than prompting,
  which is exactly what a GUI wants.
