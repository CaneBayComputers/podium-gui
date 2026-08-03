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

## One caveat, stated plainly

**The `qwen` arms in the CLI are untested.** Qwen Code was not installed on the
machine where this was written, so the invocation is modelled on the `gemini` arm
it was forked from. The flags (`--yolo`, `--model`, `--prompt`, `-i`,
`--resume latest`) are believed right but not verified. **If you install
`@qwen-code/qwen-code` and drive it through the GUI, you will be the first to
actually exercise that path** — report anything wrong via `CLI_GUI_ISSUES.md` as
usual.

Everything else here was verified: the base URL exports only when set and reaches
child processes, `--api-base` round trips both ways, and the existing agents are
unaffected.
