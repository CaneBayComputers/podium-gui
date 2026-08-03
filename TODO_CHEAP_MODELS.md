# TODO: surface cheap and local models in the GUI

The CLI gained this today (podium-cli `beta`, not yet on `master` — pull before
building against it). Read
[`docs/guide/cheap-models.md`](https://podiumcli.com/guide/cheap-models/) in the
CLI repo first; this file is only the GUI-side work.

## Why it matters

Podium is free and is staying free. The nearest thing it has to a "saving people
money" story is that it costs almost nothing to run against a cheap or local
model — Qwen Coder is roughly **30x cheaper than Claude Sonnet**, and Ollama is
**free**. Right now that is invisible unless you read the docs, which nobody
does. Making it a visible choice in the GUI is the whole point of this task.

## What changed in the CLI

**A fifth agent, `qwen`** (Qwen Code — `npm install -g @qwen-code/qwen-code`).
So `podium ai-set --agent` now accepts: `codex`, `claude`, `gemini`, `qwen`,
`aider`.

**`--api-base` now applies to more than aider.** Podium passes it to whichever
environment variable the agent CLI reads:

| Agent | Endpoint it needs | Needs a model name? |
|---|---|---|
| `codex` | OpenAI-compatible | optional |
| `qwen` | OpenAI-compatible | **required** |
| `aider` | OpenAI-compatible | **required** |
| `claude` | **Anthropic**-compatible (LiteLLM proxy for local) | optional |
| `gemini` | none — Google account auth | optional |

**`--api-base none` (or empty) clears the endpoint.** It used to store the
literal string. Same for `--api-key ""`.

## The work

### 1. Add `qwen` to the agent picker

Wherever the AI agent list is rendered. Note `qwen` and `aider` both **require**
a model name — the form should block submission without one, the way it presumably
already does for aider.

### 2. Make the endpoint field available for more than aider

If the GUI currently shows the API-base field only when aider is selected, widen
it: show it for `codex`, `qwen` and `aider`, and for `claude` with a note that it
needs an Anthropic-compatible proxy rather than a raw Ollama URL. Hide it for
`gemini`, which has no such option.

### 3. Presets — this is the part users will actually use

A dropdown of known-good configurations beats a blank URL field. Suggested:

| Preset | Fills in |
|---|---|
| **Ollama (local, free)** | agent `qwen`, base `http://localhost:11434/v1`, key `ollama`, model left for the user |
| **OpenRouter** | agent `qwen`, base `https://openrouter.ai/api/v1`, model `qwen/qwen3-coder-next`, key blank |
| **LM Studio (local)** | agent `codex`, base `http://localhost:1234/v1`, key `local` |
| **Default (hosted)** | agent `claude`, base and key cleared |

For the Ollama preset specifically: if you can reach `http://localhost:11434/api/tags`,
you can list the models the user has actually pulled and offer them as a picker
instead of a free-text field. That turns the hardest step into a click. Fail
quietly to free text if Ollama is not running.

### 4. Clearing must work

"Default (hosted)" has to send `--api-base none` and `--api-key ""` — not omit
the flags, which leaves the old values in place. Verify with
`podium ai-set --json-output` afterwards: `api_base` should be `""` and
`has_api_key` `false`.

### 5. Set expectations in the UI

One line near the local presets, so cheap models do not read as broken:

> Local models need roughly 24GB of VRAM for a 32B coder model. Smaller models
> struggle to complete a full Create with AI build.

Worth saying plainly, because the failure mode is a build that runs and produces
something subtly wrong, which users will report as a Podium bug.

## Verify with

```bash
podium ai-set --json-output          # shape unchanged: agent, model, api_base, has_api_key
podium ai-set --help                 # documents all five agents
```

Then drive it: set a preset in the GUI, confirm `ai-set --json-output` matches,
run a small `podium ai` prompt, and switch back to Default.

## Update — qwen is now installed and tested

The earlier "untested" caveat is withdrawn. `@qwen-code/qwen-code` 0.21.4 was
installed and driven against a local Ollama end to end through Podium. Two of the
three guessed flags were wrong and are now fixed in the CLI:

- **`--auth-type openai` is required.** Without it qwen refuses every
  non-interactive run with "No auth type is selected", even with key and endpoint
  set.
- **`--resume latest` was wrong** — qwen's `--resume` takes a session ID or
  title, so it looked up "latest" literally. `--continue` is correct.
- **`--yolo` is real but undocumented**, and prints a warning about
  auto-executing tools on every headless run. Suppressed, because it would have
  landed inside `podium create`'s JSON and broken the classifier.

Verified: `podium ai --one-off` returns exactly the requested string via Ollama,
and `--classify-only` produces valid, correctly shaped JSON.

## What the testing means for your UI copy

**The VRAM warning in section 5 is now measured, not guessed — and it is worse
than "smaller models struggle".** On `qwen2.5-coder:1.5b` the classifier returned
*perfectly well-formed JSON* that recommended a **budgeting app for a guitar
pedal tracker**, reasoning "Laravel is great for building budgeting apps".

That is the failure mode to design the UI around: small models do not error, they
succeed mechanically and are wrong on the substance. A user will see a plausible
result and blame Podium. Suggested wording:

> Local models need roughly 24GB of VRAM for a 32B coder model. Smaller models
> return confident, well-formed answers that are simply wrong — they will not
> look like errors.

Also worth surfacing: **Qwen Code wants Node 22+.** It installs and runs on Node
20 with an `EBADENGINE` npm warning, but that is unsupported, and your installers
currently enforce Node 20 as the minimum. If the GUI offers to install qwen, it
should check for 22.

Everything else was verified too: the base URL exports only when set and reaches
child processes, `--api-base none` and `--api-key ""` both clear, and the existing
agents are unaffected.
