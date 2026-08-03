# AGENTS.md — Podium GUI

Brief for an AI agent working on this repo. Written 2026-07-31 from a session that
had just spent a long day inside the Podium CLI, so the CLI facts here are current
as of `podium-cli` commit `f2e3ea3`. (That was on `beta`, which no longer
exists — podium-cli is `master` + `dev`, the same shape as this repo.)

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

Full published docs: <https://podiumcli.com/guide/>

### The podium-cli directory is READ-ONLY to you

`/usr/local/share/podium-cli` (and `~/repos/podium/podium-cli` — same directory, one
shared clone via symlink) is a **different project**. Read it freely. Do **not** edit,
stage, commit, or `git` anything in it. If you find a CLI bug, write it down and
report it; do not fix it from here. Two agents editing one working tree at once has
already caused a near-miss in this codebase.

---

## 1. The CLI contract — re-synced 2026-07-31, keep it that way

The GUI was last pushed September 2025 and every call had drifted. That re-sync is
**done**: all of the below is what the code now does. It is recorded because the
failure mode is silent — a wrong flag or a changed positional fails at runtime,
often looking like a GUI bug.

The signatures the GUI depends on:

| Command | Contract |
|---|---|
| `podium new <framework> <name>` | framework is the **first positional**. There is no `--framework` flag. Org is `--github-org`, not `--org`. |
| `podium install <app> [name]` | database is fixed by the installer; never offer a choice. |
| `podium clone <mode> <repo> [name]` | mode is **required**: `work-directly`, `fork`, `new-repo`. |
| `podium remove <name>` | database is **preserved** unless `--force-db-delete`. `--force` is a destructive alias, NOT "skip prompts". |
| `podium status [name]` | lists only **running** projects; needs `--all` for the rest. |
| `podium create --classify-only --json-output "<idea>"` | phase 1 on its own — see §2A. |
| `podium ai-set --json-output` | reports the configured agent; installs one when `--agent` is set. |
| `podium resume <project>` | reopens the AI session in that project. |
| `start-services` / `stop-services` | take no arguments the GUI needs; judge by exit code. |

**Do not hardcode anything the CLI publishes.** The app list, each framework's
supported databases, the projects directory and the shared-service container
names are all read at runtime from `src/catalog/*.json` and
`/etc/podium-cli/.env`. Every one of those was previously a hardcoded copy in
this repo, and every one had drifted.

Re-verify with `podium <command> --help` before changing a call. When something
looks wrong in the CLI, write it up in `CLI_GUI_ISSUES.md` — that loop produced
eight fixes during the re-sync — and never edit `podium-cli` directly.

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
contract. **This is built.** The CLI-side flag it needed was requested rather than
worked around, and shipped as `podium create --classify-only [--json-output]`,
which runs phase 1, prints the classification and creates nothing. The GUI renders
those candidates natively and then drives phase 2 with `install`/`new` directly.

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

Four installers matching the CLI's, same platforms, same shape — **these exist**
(`install-ubuntu.sh` is the reference and the only one run end to end on real
hardware; the other three are syntax- and guard-checked by the suite):

`install-ubuntu.sh`, `install-fedora.sh`, `install-arch.sh`, `install-mac.sh`

They are not reinvented — the CLI's four are the template. These behaviours are
lint-asserted by the e2e suite so they cannot be dropped silently, and each was
found by running installers on clean machines:

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

**This is built** — `npm run test:e2e` runs `tests/e2e.js` against the real app.
What it consists of:

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

## 6. Where this stands

All five steps of the original plan are done and verified on real hardware:

1. **CLI contract re-synced** — the GUI could not previously start at all (it
   probed a config path that no longer exists and always opened the installer).
2. **`podium install`** — all 102 apps, catalogue read at runtime.
3. **Playwright + `data-testid`** — `npm run test:e2e`, see §4.
4. **Create with AI** — driven phase by phase against `create --classify-only`,
   which was requested from the CLI rather than worked around.
5. **Installers and first-run configure** — four platform installers; the CLI is
   installed first when missing.

Since then: tabbed embedded terminals, an AI agent panel, Modify with AI,
streamed output for long operations, and the framework picker driven from
`frameworks.json`.

**Verified**: 13/13 frameworks and 102/102 apps created through the GUI's own
buttons, checked over HTTP, then removed — zero failures. That run found eight
CLI bugs, two of which were only ever reproducible through the GUI.

---

## 7. Things that will bite you

- **Never pass `--json-output` when you need to know *why* something failed.** It
  suppresses the human-readable output, including the error. Judge success by the
  **exit code**, always. The GUI streams plain output for anything long-running.
- **A CLI older than the GUI is dangerous, not merely limited.** A CLI predating
  `--classify-only` does not reject the flag — it falls through to a full
  `podium create` and builds a project. The GUI probes `create --help` before
  using it. Assume the same shape for any future flag.
- **`podium status` is running-only** without `--all`, and `port_mapped` is **not**
  a liveness signal — projects reachable by hostname alone (everything
  `podium install` produces) have no published port. Key "running" on
  `docker_running`.
- **Display metadata is GUI-owned.** The CLI no longer writes `x-metadata` and
  `status` does not return name/description/emoji. The GUI keeps them in the
  project's compose file and applies them at render time — never onto the parsed
  status object, which gets rebuilt underneath you.
- **Optional shared services** (MinIO, Meilisearch) are reported as `stopped`
  whether or not they were ever enabled. Filter on `OPTIONAL_SERVICES` in
  `/etc/podium-cli/.env` or they read as broken.
- **`--version` only means something for laravel and wordpress.** The CLI's help
  once advertised PHP `8 or 7`; nothing read it.
- **Modals must be top-level.** One was nested inside another, and since `.modal`
  is `display:none`, it could never be shown — that button had never worked. The
  suite asserts no modal is nested inside another.
- **Screenshots catch what assertions miss.** A submit button pushed below the
  fold and a stale validation error under a field labelled optional both passed
  every assertion. Look at `debug/*.png`.
- **The e2e suite needs a live desktop.** Electron exits with "Missing X server"
  over a bare SSH session.

---

## 8. Getting work onto `master`

`master` is protected by repository ruleset `protect-default` (id `20205352`),
enforcement **active**, covering `refs/heads/master` and `refs/heads/main`:

| Rule | Effect |
|---|---|
| `pull_request` | changes must arrive via a PR — **0 approvals required** |
| `deletion` | the branch cannot be deleted |
| `non_fast_forward` | no force-pushing, no history rewrites |

**`bypass_actors` is empty** — the API reports `current_user_can_bypass: never`
for everyone, including the owner. There is no override. A direct push fails with
`protected branch hook declined` / `GH013`.

### The procedure

All work happens on **`dev`**. Do not create a branch per feature, fix or update —
commit them all to `dev` and promote in batches.

```bash
# 1. open the PR (once per batch, not per fix)
gh pr create --base master --head dev --title "..." --body "..."

# 2. merge it yourself — 0 approvals are required
gh pr merge <number> --merge --delete-branch=false

# 3. confirm
git fetch origin
git log --oneline origin/master..origin/dev | wc -l   # want 0
```

`dev` is permanent: keep it after merging and carry on committing to it.

**Batch, do not drip.** A promotion PR with fifteen commits is fine and normal;
fifteen PRs with one commit each is noise. Write the PR body as a summary of what
changed and why it is safe — the commit list is already on the PR page.

### Traps

- **Never `git push --force` at `master`.** `non_fast_forward` rejects it, and
  rewriting a shared branch strands other sessions' work. Revert instead.
- **`git push --dry-run` does not test protection.** Its output is client-side and
  never reaches the server hook, so it will happily report a direct push to
  `master` as succeeding. Check what is actually enforced with:
  ```bash
  gh api repos/CaneBayComputers/podium-gui/rules/branches/master
  ```
- **`gh api .../branches/master/protection` returns 404 here.** That endpoint is
  for *classic* protection; this repo uses a **ruleset**. A 404 there does not
  mean unprotected.
- **This repo is MIT licensed** (relicensed 2026-08-03, matching podium-cli).
  `LICENSE` is MIT and `package.json` says `MIT`. `private: true` stays in
  package.json — that blocks an accidental `npm publish` of a desktop app and
  has nothing to do with the licence.
