# GUI tightening — spec

Requested 2026-08-05. Captured verbatim in intent; grouped by area, with open
questions and CLI dependencies called out. Not yet implemented.

## Themes

- **Light**: header is too dark. Modal header text must be **white**.
- **Dark**: currently too close to Retro and Podium. Make it an ordinary,
  run-of-the-mill dark theme — plainer, but not colourless.
- **Podium**: modal header text must be **dark grey**.

## Header / nav

- Remove the "Podium, without the terminal" subtitle.
- Tighten the top nav height.
- Move **Settings** and **Donate** into the top nav.
- Remove the **Install App** button (folded into New Project — see below).

## New Project

- First step becomes a choice: **scaffold a framework** or **install an app**.
  The separate Install App entry point goes away.

## Project tiles

- **Filter** by running / not running / all.
- **Sort** by name, last-on, or newest.
- **Filter by emoji**: selecting emoji shows only projects with those emoji, and
  each emoji shows a **count** of matching projects.

> **CLI dependency**: sort-by-last-on needs a `last_on` timestamp written into
> the `x-metadata` section of each project's `docker-compose.yml`. The GUI
> already reads and writes that section, so it can consume it as soon as the CLI
> records it. Raised with the CLI session.

## AI agent settings

- **Preset is confusing and probably unnecessary** — remove it, or justify it.
  "Custom" in particular reads as meaningless.
- **API endpoint should be optional when Claude Code is selected.**

## Footer

- **Remove the Help section entirely** (no Help button for now).
- "Podium CLI on GitHub" becomes just **GitHub**, linking to the **GUI** repo.
- Remove the descriptive bottom text.
- Add **MIT licence link** and **© Shawn Welch**.

## Donate

Lists all four destinations:
- Patreon
- Ko-fi
- ValorPay
- GitHub Sponsors (`shrimpwagon`)

> **Open question**: exact Ko-fi and GitHub Sponsors URLs needed. The existing
> Patreon and ValorPay links are already in the footer markup.

## Terminals — reworked

- **Modify with AI must not run a podium up/start** when the project is already
  running. Go straight to the CLI.
- Settings gains a **Project layout** tab:
  - projects per row — **default 2, max 4**
  - toggle: open CLI in a **system terminal** or **inside Podium** (default:
    inside Podium)
- **Modify with AI opens a terminal in the tile itself**, below the buttons —
  not in a separate modal.
- The terminal is **collapsible**. When collapsed, show a sliver of the bottom
  of the terminal so recent output is still visible.

> **Open question**: how to signal "the agent is finished" while collapsed. The
> sliver may be sufficient. A stronger signal (tile badge, colour change on the
> collapsed bar) would need a reliable way to detect idle — the pty going quiet
> is not the same as the agent being done, and getting this wrong is worse than
> not having it.

## Notes on sequencing

The terminal rework is the largest item and touches the session registry, the
tile renderer and the settings panel at once. The footer/nav/theme items are
independent and low-risk, so they can land first without blocking it.
