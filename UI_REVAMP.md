# GUI tightening — spec

Requested 2026-08-05. Captured verbatim in intent; grouped by area, with open
questions and CLI dependencies called out.

**Status:** everything below is implemented except the one item blocked on the
CLI, marked ⛔. Each section notes the commit that landed it.

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

> **CLI dependency (still open)**: sort-by-last-on needs a `last_on` timestamp in
> the `x-metadata` section of each project's `docker-compose.yml`. Until the CLI
> writes it, that sort option falls back to sorting by name — stable rather than
> arbitrary. ISO-8601 UTC agreed with the CLI session; x-metadata now survives
> regeneration (CLI `aef13ca`).

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

## Terminals — done (`96fccb4`), except one item

- ⛔ **Modify with AI must not run a podium up/start when the project is already
  running.** See the CLI dependency below — this cannot be fixed from the GUI.
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

> **CLI dependency (blocking)**: `podium resume <project>` unconditionally runs
> `startup.sh` (`src/scripts/resume.sh`, around line 50) with no flag to skip it.
> On an already-running project that costs seconds and can prompt for sudo. The
> GUI cannot work around it without duplicating the CLI's per-agent resume flags
> (`claude --continue`, `codex resume --last`, `qwen --continue`,
> `gemini --resume latest`, `aider --restore-chat-history`), which would rot on
> the next agent change. **Asked for:** a `--no-start` flag on `podium resume`,
> or an early return in `startup.sh` when the project's containers are already
> up. Report this to the CLI session; do not patch podium-cli from here.

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
