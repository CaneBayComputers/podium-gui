# GUI tightening — spec

Requested 2026-08-05. Captured verbatim in intent; grouped by area, with open
questions and CLI dependencies called out.

**Status: every item is implemented.** Each section notes the commit that landed
it. The one item that needed a CLI change got one (`332f83a`); a follow-up
performance issue found while verifying it is recorded under Terminals and has
been raised, but it does not block anything here.

## Themes — done (`b259923`)

- **Light**: header is too dark. Modal header text must be **white**.
- **Dark**: currently too close to Retro and Podium. Make it an ordinary,
  run-of-the-mill dark theme — plainer, but not colourless.
- **Podium**: modal header text must be **dark grey**.

## Header / nav — done (`b259923`, `6407988`)

- Remove the "Podium, without the terminal" subtitle.
- Tighten the top nav height.
- Move **Settings** and **Donate** into the top nav.
- Remove the **Install App** button (folded into New Project — see below).

## New Project — done (`6407988`)

- First step is now a choice: **scaffold a framework** or **install an app**.
  The separate Install App entry point is gone.

The installer flow itself is unchanged — only the way into it. Its Cancel gained
a **Back** beside it, since a wrong turn now costs a modal rather than a misread
button. Back is hidden while an install is running, so it cannot bury a live
install behind a form.

The framework catalogue now loads when that path is chosen rather than on modal
open, so someone heading for the app installer does not wait on it.

## Project tiles — done (`2df1eee`)

- **Filter** by running / not running / all.
- **Sort** by name, last-on, or newest.
- **Filter by emoji**: selecting emoji shows only projects with those emoji, and
  each emoji shows a **count** of matching projects.

Notes on what the implementation commits to:

- Filter state lives in module scope and is persisted, not read back from the
  DOM — reading it from the controls lets the grid and the controls disagree.
- The emoji a chip counts resolves through the same fallback chain the tiles
  use, so a chip can never count an emoji different from the one on screen.
- An empty result renders its own placeholder ("N projects hidden by the current
  filter" + Show all) rather than falling through to the first-run placeholder.
  A filter that looks like data loss is a bad filter.
- A project with a **live agent session is never filtered out**. Hiding it would
  leave a running agent with no window and no way to reach it.

> **CLI dependency — resolved (CLI `eb81685`, GUI `2d07e1d`).** `last_on` is now
> written into each project's `x-metadata` as ISO-8601 UTC, on both start and
> stop — so it means "last time this was up", not "last time somebody started
> it", which is what makes it sort correctly for a project that ran for a week
> and stopped yesterday.
>
> Wiring it up exposed a GUI bug: the sort was reading `last_on` straight off the
> parsed project objects, which never carry it — it comes out of the compose file
> and is merged in at render time — so the comparison was `undefined` against
> `undefined` and the order never changed. Fixed to read through the merge.
>
> Projects that have not been started or stopped since the CLI began writing it
> have no value and sort **last**: absent means unknown, and there is no
> backfill by design.

## AI agent settings — done (`5358ff9`)

- **Preset removed.** It was a second control fighting the first: choosing
  "OpenRouter" silently reassigned the agent above it, and "Custom" was a menu
  entry that did nothing when selected.
- What it was actually good for — not having to remember
  `http://localhost:11434/v1` — survives as **endpoint chips** under the API
  Endpoint field. They fill that field and nothing else, and are offered only
  for agents whose wire format suits the endpoint. A placeholder token gets
  filled in alongside, but never over a key already typed.
- **API endpoint is now optional for Claude Code**: it sits behind a reveal,
  since signing in to Anthropic is the normal case. An endpoint already stored
  always shows expanded — folding away a setting that is in force would make the
  panel disagree with the CLI.

## Footer — done (`b259923`)

- Help section removed entirely.
- "Podium CLI on GitHub" is now just **GitHub**, linking to the GUI repo.
- Descriptive bottom text removed.
- MIT licence link and © Shawn Welch added.

## Donate — done (`bd62d1e`)

Patreon, Ko-fi (`ko-fi.com/canebaycomputers`), ValorPay (via
`donate.podiumcli.com`) and GitHub Sponsors (`shrimpwagon`).

## Terminals — done (`96fccb4`, CLI `332f83a`)

- ✅ **Modify with AI must not run a podium up/start when the project is already
  running.** Fixed in the CLI (`332f83a`), which is where it belonged — no GUI
  change was needed. See below.
- Settings gained a **Project layout** tab:
  - projects per row — default 2, max 4 ✅
  - toggle: open the CLI in a **system terminal** or **inside Podium**
    (default: inside Podium) ✅
- **Modify with AI opens a terminal in the tile itself**, below the buttons ✅
- The terminal is **collapsible**, with a sliver of recent output still
  visible ✅

Implementation notes worth keeping:

- The grid is rebuilt wholesale on every status poll, so a tile-hosted pane is
  lifted into a detached holder before the rebuild and moved back after. It is
  never re-created. The test asserts the *same DOM node* survives — a re-created
  terminal would look identical while having lost its scrollback and its pty.
- Collapsing **clips rather than resizes**. Refitting to the sliver would tell
  the pty it has two rows and wreck whatever the agent is drawing, so the pane
  keeps its full pixel height inside a clipping viewport and slides up.
- The slide anchors to the **cursor**, not the pane's bottom edge. A session that
  has printed two lines into a 24-row terminal has 22 blank rows at the bottom,
  so anchoring there gave an empty sliver exactly when you most wanted to see
  what had just happened.
- The tile bar carries the session status and turns green on exit, because when
  collapsed it is the only part guaranteed to be on screen.

> **CLI dependency — resolved (`332f83a`).** `podium resume` used to run
> `startup.sh` unconditionally. The CLI added an early return in `startup.sh`
> when the containers are already up, rather than the `--no-start` flag that was
> the other option on the table. That was the better call and no flag is needed:
> the CLI checks the container's real state at the moment of use, whereas a flag
> would have carried the GUI's belief about that state, formed at status-poll
> time and already stale by the time the user clicks — and the GUI would have
> had to reimplement the same running-check to decide whether to pass it.
>
> Verified here: `podium up` on a running project reports "already running" and
> does not restart it.
>
> **Still slower than it should be, reported not fixed:** a no-op `podium up`
> takes 12.58s, reproducibly. `podium status` alone is 0.44s, and the nine
> connectivity pings plus two HTTP checks are 0.15s. A `bash -x` trace with an
> `EPOCHREALTIME` PS4 puts 12.00s of it on a single statement — a hardcoded
> `sleep 12` at `startup.sh:243`, below the early return, which still waits for
> containers to boot when nothing was started. Raised with the CLI.

> **Open question, unresolved**: how to signal "the agent is finished" while
> collapsed. The status bar covers the exit case (it reports the exit code and
> goes green). A stronger *idle* signal — the agent waiting on input rather than
> having exited — still needs a reliable way to detect idle, and a quiet pty is
> not the same as a finished agent. Left alone deliberately.

## Also fixed along the way

- **`spawn podium ENOENT` on packaged installs** (`dba8cb2`). Every packaged
  install failed from the panel launcher while working from a terminal: a
  `.desktop` launch has no `/usr/local/bin` on PATH. One call site had a
  fallback; the four that mattered did not. `resolvePodium()` now answers for
  all of them, and is deliberately uncached so the test can strip PATH — running
  that check from a normal shell is a test that cannot fail.
- **Stale terminal tab** left in the bar after the last modal session ended.
