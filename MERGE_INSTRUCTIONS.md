# How to get work onto `master`

`master` is protected as of 2026-08-01. **You cannot push to it directly** — not
with `--force`, not as an admin, not as the repo owner. This file is the whole
procedure.

Same setup as `podium-cli`, so if you have seen that repo's rules, these are
identical.

---

## What is enforced

Repository ruleset **`protect-default`** (id `20205352`), enforcement **active**,
applying to `refs/heads/master` and `refs/heads/main`:

| Rule | Effect |
|---|---|
| `pull_request` | changes must arrive via a PR — **0 approvals required** |
| `deletion` | the branch cannot be deleted |
| `non_fast_forward` | no force-pushing, no history rewrites |

**`bypass_actors` is empty.** The API reports `current_user_can_bypass: never`
for everyone, including the owner. There is no override and no emergency valve —
if you find yourself looking for one, the answer is a PR.

A direct push fails like this:

```
! [remote rejected] master -> master (protected branch hook declined)
error: failed to push some refs
```

`GH013` in the output means the same thing.

---

## The procedure

Work on a branch — the current one is `cli-resync-and-install` — commit as
normal, push the branch, then:

```bash
# 1. open the PR (once per batch, not per fix)
gh pr create --base master --head "$(git branch --show-current)" \
  --title "..." --body "..."

# 2. merge it yourself — 0 approvals are required
gh pr merge <number> --merge --delete-branch=false

# 3. confirm
git fetch origin
git log --oneline origin/master..origin/$(git branch --show-current) | wc -l   # want 0
```

Keep the branch after merging (`--delete-branch=false`) and carry on committing
to it; the next batch is another PR from the same branch.

---

## Batch, do not drip

**Do not open a PR per fix.** Shawn has asked for this explicitly on the CLI side
and the same applies here. Accumulate related commits on the branch and promote
them together. A promotion PR with fifteen commits is fine and normal; fifteen
PRs with one commit each is noise.

Write the PR body as a summary of *what changed and why it is safe*, not a list
of commit subjects — the commit list is already on the PR page.

---

## Current state (2026-08-01)

`master` is **19 commits behind** `cli-resync-and-install` — it still holds only
`AGENTS.md`. Everything else lives on the branch: the CLI re-sync, the app
installer, Create with AI, the four installers, the Playwright e2e suite, the
multi-tab terminals, the AI agent panel, plus README, docs-link, licence and
funding commits.

**That is 5,200+ lines that have never been promoted.** Whenever you are at a
stopping point, open the PR and merge it. Nothing is blocking it — the full
matrix run (13/13 frameworks, 102/102 apps) already passed against the current
CLI `master`.

---

## Things that will bite you

- **Never `git push --force` anything at `master`.** `non_fast_forward` rejects
  it, and if you are rewriting history on a shared branch you will also strand
  work from any other session on it. Revert instead of rebasing away a commit
  someone else has built on.
- **`git push --dry-run` does not test protection.** Its output is produced
  client-side; it never reaches the server hook, so it will happily report a
  direct push to `master` as succeeding. To check what is actually enforced:
  ```bash
  gh api repos/CaneBayComputers/podium-gui/rules/branches/master
  ```
- **`gh api .../branches/master/protection` returns 404 here.** That endpoint is
  for *classic* branch protection; this repo uses a **ruleset**, a different API.
  A 404 there does **not** mean unprotected. Use the `rules/branches/master`
  endpoint above.
- **`podium-cli` is still read-only to you.** Unchanged. Report CLI issues via
  `CLI_GUI_ISSUES.md`; do not edit, stage or commit anything in that repo.
- **This repo is private and proprietary.** `LICENSE` is the commercial licence
  and `package.json` says `UNLICENSED` with `private: true`. Do not relicense it,
  and do not publish the package.
