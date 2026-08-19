# Remote hosts — spec

Requested 2026-08-19. Not yet implemented. Captured before building because the
identity change underneath it touches more than it looks like.

## The shape

- **Settings gains an SSH profiles tab.** Multiple profiles: name, host, port,
  user, key path. These are Podium installations on other machines.
- **New Project asks where.** `Local` or any configured profile. That choice is
  where the project is created and where it lives from then on.
- **The dashboard is the union.** Run `podium status --all --json-output` on the
  local install if there is one, and on every configured profile. Merge, tagged
  by host.

`local` is deliberately optional. On Windows there is no local Podium, so the
dashboard is remote-only — which is the point of the feature.

## Why per-host rather than per-project

A project does not have a location; a **Podium installation** does. Each host
owns its own projects directory, `/etc/hosts`, Docker network and shared
services. So the host is the unit, and creating a project picks one.

The alternative — a GUI-side registry mapping project to host — is a second
source of truth that can disagree with reality. Asking each host what it has
cannot.

## Browsing a remote project is nearly free

`podium status` already reports `external_port` and `lan_url`, and the GUI
already renders `lanUrl`. A remote project's URL is `http://<host-ip>:<port>`:
the same field, pointed elsewhere. No tunnels, no proxy, no wildcard DNS.

This was the part that looked hardest and turned out to be already solved.

## The real work is identity, not SSH

Everything is currently keyed on `project.name` alone:

- `projectMetadata[name]` — the display metadata cache
- terminal session keys — `resume-${name}`, `build-${name}`
- tile lookup, the emoji filter, `hasTileTerminal(name)`
- `data-terminal-host="<name>"` in the DOM

Two hosts can both have `drupal-test`. Identity has to become `host:name`
throughout. That is the refactor; the SSH transport is the easy half.

## One channel, if the CLI request lands

Requested from the CLI on 2026-08-19: put the five `x-metadata` fields
(`emoji`, `display_name`, `description`, `last_on`, `status`) into the status
JSON under a nested `metadata` key.

With that, remote mode is **run a command, parse JSON** — the thing SSH is best
at. Without it, 17 filesystem reads become SFTP calls with path translation and
per-host layout assumptions, on a code path that runs on a poll timer.

A `podium set-metadata` command would remove the last file *write* path too.
Lower priority: the read makes the feature tractable, the write makes it clean.

`ssh2` is the transport of choice — pure JavaScript, so no native module on
Windows, and it does exec, sftp and pty channels. **Connection multiplexing is
not optional**: the dashboard polls on a timer, and a fresh handshake per poll
is 200-500ms of nothing.

## Things that are per-host, not per-project

- **Shared services.** `enable-service` affects one machine, and each host has
  its own enabled set. The service manager needs a host selector.
- **AI settings.** `ai-set` writes to the agent's own config on the machine the
  agent runs on. A remote project's agent runs remotely, with its own API key.
  So the AI tab configures a host, not the app.
- **The catalogues.** `apps.json` and `frameworks.json` come from a CLI install.
  Nearly identical everywhere; decide which host to read them from.

## Open question, unresolved

**Does the AI agent run on the remote host or locally?**

`podium resume` starts the agent in the project directory, so a remote project
means a remote agent — a second install, a second API key, a second `ai-set`.
The alternative is a local agent editing remote files, which needs a mount and
loses the "podium resume does it all" property.

This changes what the GUI has to show and has not been decided.

## Deliberately deferred

`podium install` on a remote host. Slow first boots already take minutes, and
every status poll in that window is a round trip. Worth measuring before
designing.
