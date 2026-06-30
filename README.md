# greenlight

**Is my CI green, and if not, is it my fault or just flaky?**

`greenlight` is a terminal UI for babysitting *your own* open pull requests and the
health of their CI checks, without leaving the repo you're working in. It answers the
two questions you actually have while waiting on a build: *what's red*, and *is it worth
my attention*. Then it lets you rerun the failed jobs with one keystroke.

It's a dense power-tool, not a dashboard: an instrument-panel feel, closer to `lazygit`
and `htop` than to a web app squeezed into a terminal.

```
┌─PRs──────────────┐┌─#142 Fix auth flow──────────┐
│✗ #142 Fix auth   ││feat/auth→main ↑3↓0 ⊙2 ⟳1    │
│✓ #138 Bump deps  ││─────────────────────────────│
│• #131 Refactor   ││✓ build      1m12s           │
│✓ #129 Docs       ││✗ test(unit) 0m44s  ⚑ real?  │
│✗ #120 API v2     ││• e2e        running 2m08s   │
└──────────────────┘└─────────────────────────────┘
 ↑↓ move · ⇥ pane · ↵ details · R rerun · r refresh · o open · ? help · q quit
```

---

## Why it exists

You open a few PRs, the checks churn, and a job goes red. Was it your assertion, or a
DNS blip in the runner? Today that means tabbing to the browser, clicking into Actions,
scrolling a multi-megabyte log, and (if it was flaky) clicking *Re-run failed jobs* before
tabbing back. `greenlight` collapses that loop into a pane that's already open, and adds
a triage signal so you're not reading logs by hand.

**What you get:**

- **Your PRs, this repo, at a glance.** Open PRs authored by you, each row carrying a
  status glyph and a mini check-summary (`✓3 ✗1 •1`) so you can triage without selecting.
- **Flaky-vs-real triage, zero config.** A heuristic classifier reads the failed-job logs
  and annotations, flags each failure `likely flaky` / `likely real` / `unclear` with a
  confidence, and pulls out the failing step and the relevant error lines.
- **One-key rerun.** `R` reruns all failed jobs for the selected PR behind a confirm
  dialog. Affected checks optimistically flip to *pending* immediately so you see movement,
  not a stale red.
- **Optional LLM second opinion.** Press `a` to escalate the trimmed failure context to any
  OpenAI-compatible endpoint for a plain-language "what broke, flaky or real, and why."
  Entirely opt-in; the tool is fully useful with it switched off.
- **Uses your existing `gh` login.** It borrows the token `gh` already has, so there's
  nothing to set up before the first run: no OAuth app, no token to paste.

---

## Install

Requires **Node ≥ 22** and an authenticated [`gh`](https://cli.github.com/) (or a
`GITHUB_TOKEN`).

With [Volta](https://volta.sh/):

```bash
volta install @mrijke/greenlight
```

Or with any package manager:

```bash
npm install -g @mrijke/greenlight     # or: pnpm add -g @mrijke/greenlight
```

Either way you get the `greenlight` binary and its `gl` alias. Run it from inside any
GitHub repo:

```bash
gl
```

### From source

For local development, skip the global install and run from a clone:

```bash
git clone https://github.com/mrijke/greenlight.git
cd greenlight
pnpm install
pnpm dev            # tsx src/cli.tsx — no build needed
```

---

## Usage

```bash
gl                      # PRs you authored in the current repo
gl --repo owner/name    # target a specific repo explicitly
gl --help               # keybindings + flags
gl --version
```

### Keybindings

| Key | Action |
|---|---|
| `↑`/`↓` or `j`/`k` | Move within the focused pane |
| `Tab` / `h` / `l` | Switch pane (PR list ⇄ detail) |
| `Enter` | Drill into the selected check (logs + heuristic) |
| `Esc` | Collapse the analysis region |
| `r` | Force-refresh now |
| `R` | Rerun failed jobs (confirm dialog) |
| `a` | LLM-analyze the current check |
| `o` | Open the PR / check in your browser |
| `?` | Help overlay |
| `q` / `Ctrl-C` | Quit |

---

## How it works

A small set of single-purpose, independently tested modules behind an Ink (React) UI.

### Authentication
Token resolution is `gh auth token` → `GITHUB_TOKEN` env → a friendly error if neither.
No OAuth app, no stored credentials. Octokit is wrapped with throttling + retry so
secondary-rate-limit and abuse backoff are handled for you.

### Checks come from one GraphQL call
GitHub has two check backends (Actions **check runs** and legacy **commit statuses**),
both attached to the PR's *head* commit. Rather than reconstruct and dedup them from two
REST calls, `greenlight` reads the PR's `statusCheckRollup` over **GraphQL**: a single
call returning the authoritative, pre-merged list GitHub itself shows on the PR (the same
source `gh pr checks` uses). REST is reserved for the *actions*: reruns and log fetches.

### Fork-aware repo resolution
In a fork workflow, `origin` is your fork but your PRs target the **upstream** repo, so
querying `origin` would return zero PRs and the tool would look broken for exactly its
target user. `greenlight` reads `origin`, and if the repo is a fork it targets the
**parent** for PR and check queries. An explicit `--repo` (or config `repo`) always wins.

### Reruns are gated on real access
`rerun-failed-jobs` needs `actions:write`, and the run must be a **completed, latest**
attempt. "My own PRs" includes fork-based PRs where you have *no* write access to the
target repo, so rerun can be impossible. When it is, `R` is **disabled with a visible
reason** ("no write access to owner/repo" / "run still in progress") rather than firing a
doomed call and surfacing a silent 403.

### Polling and refresh
A framework-agnostic store drives refresh so no component owns a `setInterval`:

- The **selected PR's checks** poll fast (~10s) *while anything is pending*; the **PR
  list** polls slow (~30s).
- Polling **pauses** once every check is terminal, so there are no pointless API calls
  against an all-green PR.
- **Single-flight per resource:** a poll never stacks on a slow predecessor, and results
  reconcile against UI state **by stable id** (PR number, check name), so a late response
  can't reset your selection, scroll offset, or open analysis pane.
- Spinners for running checks are driven by **one shared ticker**, keeping redraw cost
  bounded over SSH.

---

## Configuration

Everything has a sensible default; the config file is optional and never required to run.
Values resolve **flags → env → config file → built-in default**.

Config lives at `~/.config/greenlight/config.json` (honors `XDG_CONFIG_HOME`):

```json
{
  "theme": "mocha",
  "repo": "owner/name",
  "pollListMs": 30000,
  "pollChecksMs": 10000,
  "llm": {
    "baseURL": "https://models.github.ai/inference",
    "apiKey": "...",
    "model": "openai/gpt-4o-mini"
  }
}
```

### Environment variables

| Variable | Purpose |
|---|---|
| `GITHUB_TOKEN` | Fallback token when `gh` isn't available |
| `GREENLIGHT_REPO` | Override target repo (`owner/name`) |
| `GREENLIGHT_THEME` | Theme name (`mocha`) |
| `GREENLIGHT_POLL_LIST_MS` | PR-list poll interval |
| `GREENLIGHT_POLL_CHECKS_MS` | Checks poll interval |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | OpenAI-compatible endpoint for `a` analysis |

### Enabling LLM analysis

Heuristic triage runs with **zero** LLM configuration; the LLM is a pure add-on. Point
`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` (or the `llm` config block) at any
OpenAI-SDK-compatible endpoint: GitHub Models, a local Ollama, Anthropic via a gateway,
or OpenAI itself.

> **Note on the GitHub Models default:** the `baseURL` defaults to GitHub Models, but the
> token from `gh auth login` carries `repo`/`workflow`/`read:org`, **not** `models`. So
> the default endpoint won't work out of the box. Enable it with
> `gh auth refresh -s models`, or use a fine-grained PAT with `models:read`. greenlight
> reports this as a distinct, named state ("`models:read` scope missing"), kept separate
> from "LLM unconfigured", so you always know which knob to turn.

---

## Failure analysis

**Heuristic (always on).** Downloads failed-job logs + annotations, trims to the failing
region, and classifies:

- *Flaky signals:* passed-on-retry, network/DNS/`ETIMEDOUT`/503/rate-limit, OOM /
  exit 137 / "Killed".
- *Real-failure signals:* assertion diffs, compile/type errors, lint failures.
- *Output:* a `likely flaky` / `likely real` / `unclear` label + confidence, the failing
  step name, and the extracted error lines.

It's a pure function, which makes it the highest-value test target.

**LLM (opt-in, `a`).** Sends the same trimmed region plus the heuristic findings to your
configured endpoint and returns plain-language *what broke, flaky vs. real + why, and a
suggested next step*. Rate-limit (`429`) and scope errors surface as status-bar notices
with backoff, never silent failures.

---

## Tech stack

| | |
|---|---|
| **UI** | [Ink](https://github.com/vadimdemedes/ink) 7 + React 19 (alternate-screen, full TUI) |
| **GitHub** | [Octokit](https://github.com/octokit) REST + GraphQL, throttling plugin |
| **LLM** | `openai` SDK against any compatible `baseURL` |
| **Validation** | Zod |
| **Build / dev** | tsup, tsx |
| **Tests** | Vitest + `ink-testing-library` |

### Development

```bash
pnpm dev          # run from source
pnpm test         # vitest run  (59 tests across 21 files)
pnpm typecheck    # tsc --noEmit
pnpm build        # tsup → dist/
```

Because Ink offers no scroll container and no floating overlays, both panes scroll via
**manual windowing** (cursor index + measured terminal height), and the confirm/help
"overlays" are **focus-trapped views** that replace the region rather than layered modals.

---

## Status

v0.1. The core loop works: list → checks → heuristic triage → rerun, with optional LLM
analysis. The theme layer ships `mocha` (Catppuccin) today and is a token-only swap away
from a second palette (`tokyo-night` is specced and deferred until the loop is solid).
