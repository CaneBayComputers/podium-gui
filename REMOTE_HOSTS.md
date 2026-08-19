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

## Invoke podium by absolute path, never by name

Reported by the CLI session from the Mac rig, 2026-08-19, before the executor
existed — which is the only reason it is not a bug yet.

`ssh <mac> 'podium status --json-output'` fails with **command not found**, on a
machine where Podium is installed and working:

```
non-interactive (ssh host 'cmd'):  PATH=/usr/bin:/bin:/usr/sbin:/sbin   -> not found
login shell      (zsh -lc):        PATH=/usr/local/bin:...:/opt/homebrew/bin:... -> found
```

macOS builds PATH from `/etc/paths` via `path_helper`, which runs only for
**login** shells. A non-interactive `ssh host 'cmd'` gets a bare four-entry PATH
with `/usr/local/bin` missing — exactly where podium lives.

This is the worst shape of the bug because **it works against a Linux host**,
where `/usr/local/bin` is normally on PATH regardless. So the naive executor
passes every test against `cassie` and fails against a Mac, looking like the host
is misconfigured or Podium is not installed when both are fine.

**Use `/usr/local/bin/podium`, not `zsh -lc "podium ..."`.** A login shell also
sources the user's rc files, so their aliases, version managers and shell noise
end up in a stream being parsed as JSON. The absolute path is the same on macOS
and Linux — both installers symlink there.

### The general rule, because there will be a fourth

These are not three bugs. They are **one fact showing up in three places**: a
context that is not a login shell never gets the PATH a login shell builds.

| surface | missing | why |
|---|---|---|
| `.desktop` launch | `/usr/local/bin` | Debian policy strips it from maintainer/launcher PATH |
| Finder launch | `/opt/homebrew/bin` | added by `~/.zprofile`, never sourced |
| `ssh host 'cmd'` | both | macOS `path_helper` runs for login shells only |

**Anything Podium invokes must be resolved absolutely, never by name.** The
fourth surface will look novel to whoever meets it — a launchd job, a cron entry,
a systemd unit, a CI runner — and it will be this same fact again. Stating it as
a rule rather than three fixes is the point.

The executor resolves remotely the same way the local one does.

### Smoke-test against the Mac, not a Linux host

`ssh cassie 'podium status'` works, because `/usr/local/bin` is on PATH there
regardless. So a Linux target passes and proves nothing. The first executor
smoke test goes against the Mac at `192.168.1.193` — recommended by the CLI
session, whose own week has been every macOS bug being invisible on Linux and
none of them subtle once a real Mac ran the code.

## Shell scripts must run on bash 3.2

macOS ships bash 3.2.57 and always will — Apple froze it at the last GPLv2
release. Every script here uses `#!/usr/bin/env bash`, which resolves to that
unless Homebrew's bash is installed; on the Mac rig it is not.

The CLI's `podium configure` crashed there on `mapfile: command not found`.
Verified: all three scripts here parse under the rig's real bash 3.2, and a test
now rejects `mapfile`, `readarray`, `declare -A`, `${v,,}`, `${v^^}`, negative
array indices, `coproc` and `|&`.

`bash -n` alone would not have caught it — `mapfile` parses fine and fails at
runtime, which is precisely how it broke.

## Built so far

**SSH profiles tab** (PR #36) — multiple hosts, each with a connection test that
probes for podium and remembers where it found it.

**Executor** (PR #37) — one `exec` interface with a local and an SSH
implementation, and `execute-podium-on <hostId> <subcommand>`. One ssh2
connection per host, reused: measured against the dell-laptop, the first call
costs 1035ms and later ones 772-786ms, so roughly 250ms of handshake is
amortised away. Paid per poll per host, that is the difference between usable
and not.

An unknown host id **fails** rather than falling back to local. A project
pointing at a removed host running its command against a different machine and
reporting success is worse than any error.

Not yet built: streaming and pty channels. Both are separate from `exec` and
neither has a caller yet; designing them before one exists would be guessing.

### A fourth PATH surface, found by running it

Resolving podium absolutely is necessary but **not sufficient**. Podium's own
scripts shell out to `docker`, `git` and `sed`, and those inherit the same
PATH-less environment:

```
$ ssh mac '/usr/local/bin/podium status --all --json-output'
status.sh: line 137: docker: command not found     # /usr/local/bin/docker exists

$ ssh mac 'PATH=/usr/local/bin:/opt/homebrew/bin:$PATH /usr/local/bin/podium status ...'
{ "shared_services": { ...                          # works
```

So every remote command carries an explicit PATH prefix. Same fact as the other
three surfaces, one layer deeper: it is not only what Podium invokes, but what
Podium invokes invokes.

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
