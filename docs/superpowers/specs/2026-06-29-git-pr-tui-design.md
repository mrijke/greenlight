# Greenlight — Design Spec

**Date:** 2026-06-29
**Status:** Approved design, pre-implementation

> **Name:** Greenlight — binary `greenlight` (alias `gl`). "All checks pass → you're
> greenlit to merge." Default theme: `mocha`.

## 1. Overview

A terminal UI for tracking *your own* open pull requests in the current repository
and the health of their CI checks. Two-pane layout: PR list on the left, PR + checks
detail on the right. Drill into a failed check for heuristic (and optional LLM)
triage of *flaky vs. real* failures, and rerun all failed jobs with one confirmed
keystroke.

**Target user:** a developer babysitting several in-flight PRs who wants to answer
"is my CI green, and if not, is it my fault or flaky?" — and act on it — without
leaving the terminal.

**Run model:** invoked inside a git repo; it infers the repo from the working
directory and shows only PRs authored by the current user there.

## 2. Stack & Foundational Decisions

- **Language/framework:** Ink + TypeScript (React-for-the-terminal). Single Node CLI.
- **GitHub access:** Octokit (typed REST + GraphQL). No OAuth app, no token storage.
  - Token resolution: `gh auth token` (via `execa`) → fallback `GITHUB_TOKEN` env →
    friendly error if neither.
- **LLM analysis:** opt-in, via *any OpenAI-compatible endpoint* configured with
  `baseURL` / `apiKey` / `model`. Defaults `baseURL` to GitHub Models
  (`https://models.github.ai/inference`). Uses the `openai` npm package. Heuristic
  analysis works with **zero** LLM config; the LLM is a pure add-on.
- **Name:** Greenlight — binary `greenlight`, alias `gl`.

### Why these choices
- `gh` is already authenticated locally, so borrowing its token gives full Octokit
  access with no OAuth flow or app registration. Falls back to `GITHUB_TOKEN` so it
  still works in environments without `gh`.
- GitHub Models is OpenAI-SDK-compatible, but it needs a token with the **`models:read`**
  scope **and** is gated by org/enterprise policy. The token from `gh auth login` carries
  `repo`/`gist`/`read:org`/`workflow` — **not** `models` — so the GitHub Models default
  will *not* work with the borrowed `gh` token out of the box. Enabling it requires
  `gh auth refresh -s models` or a fine-grained PAT with `models:read`. We therefore do
  **not** assume GitHub Models works automatically; it is one configurable endpoint among
  many. The pluggable design means the tool ships and is useful regardless: heuristics
  standalone, LLM lights up whenever *any* compatible endpoint is configured (GitHub
  Models at work once scoped, Anthropic/Ollama/OpenAI elsewhere). "Models scope missing"
  is a distinct, named error state — separate from "LLM unconfigured" (see §8).

## 3. Architecture

Modules, each with one clear purpose and independently testable:

| Module | Responsibility |
|---|---|
| `auth.ts` | Resolve a token (`gh auth token` → `GITHUB_TOKEN`); clear error if none. |
| `config.ts` | Load/validate `~/.config/greenlight/config.json` + env overrides (theme, LLM endpoint, poll intervals). Sensible defaults; never throws on missing file. |
| `repo.ts` | Resolve `owner/repo` from the cwd git remotes (see remote-resolution note); resolve current user login + the viewer's permission on that repo. |
| `octokit.ts` | Construct the Octokit client with `@octokit/plugin-throttling` + retry (secondary-rate-limit / abuse backoff). Single shared instance. |
| `github/prs.ts` | List open PRs authored by the current user in this repo → PR summaries (Search API). |
| `github/checks.ts` | Fetch the unified check list for a PR via GraphQL `statusCheckRollup` (source of truth); normalize to `{ name, status, conclusion, detailsUrl, checkSuiteId?, workflowRunId? }`. |
| `github/rerun.ts` | Map failed checks → workflow runs and call `rerun-failed-jobs` per run (preconditions checked first). |
| `github/logs.ts` | Fetch failed-job logs and check annotations; cap/trim download. |
| `store.ts` | Framework-agnostic state store + **poll engine**: single-flight per resource, injectable timer, reconciliation by stable id, "last-good" retention. UI subscribes; no `setInterval` in components. |
| `analysis/heuristic.ts` | Pure function: classify a failure, isolate the failing step + error lines, emit a flaky-vs-real signal + confidence. |
| `analysis/llm.ts` | Optional: send trimmed failure context to an OpenAI-compatible endpoint for a natural-language verdict. |
| `ui/*` | App shell, PR list pane, detail pane, check-detail/analysis region, confirm/help overlays, status bar, theme tokens. |

### Source of truth: GraphQL `statusCheckRollup`
GitHub has two check backends — Actions **check runs** + legacy **commit statuses** — and
both attach to the PR's **head commit** (`pull_request.head.sha`), not the temporary merge
commit the workflow executes against. You *can* reconstruct the unified list with two REST
calls at the head SHA (`checks.listForRef` + `getCombinedStatusForRef`) and dedup them —
that's the older approach, and it does see both backends. `checks.ts` instead reads the
PR's `commits(last:1).nodes.commit.statusCheckRollup` via **GraphQL**: one call returning
the authoritative pre-merged rollup GitHub itself shows on the PR (what `gh pr checks`
uses, and what Octokit's maintainer now recommends over the manual REST combination).
Normalize to `{ name, status, conclusion, detailsUrl, checkSuiteId?, workflowRunId? }`.
One call, no dedup, no SHA/ref guesswork. REST is reserved for the rerun/log *actions*.

> **Verified (2026-06-29):** checks bind to the PR head SHA (so REST *would* catch them),
> but GraphQL `statusCheckRollup` is the recommended authoritative unified source.
> Sources: gr2m's "combined PR status" guide (updated to GraphQL); Ken Muse, "The Many
> SHAs of a GitHub Pull Request."

### Mapping checks → runs (for rerun & logs)
To rerun/fetch logs we need workflow **run** ids, not check-run ids. Join via
**`check_suite_id`** (carried on both the check run and the workflow run) rather than
re-querying by SHA. When multiple attempts exist, take the **latest `run_attempt`** per
workflow (dedup by workflow id) so we never act on superseded attempts. Then per failing
run call `POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs`. For logs:
list jobs for the run (`actions.listJobsForWorkflowRun`), pick failed jobs, download logs
(`actions.downloadJobLogsForJob` — returns the **entire** job log via a short-lived 302
redirect, can be multiple MB; stream and trim to the failing region *after* download,
and treat 410 Gone as "logs expired"); annotations via `checks.listAnnotations`.

### Rerun preconditions & write access
`rerun-failed-jobs` requires `actions:write`, and the run must be **completed** and the
**latest** attempt (rerunning while jobs are pending → 403/409). Critically, "my own PRs"
includes **fork-based PRs** where the user has no write access to the repo the PR targets
— rerun is then impossible. `rerun.ts` checks the viewer's permission (from `repo.ts`)
and run state up front; when rerun isn't possible the `R` action is **disabled with a
visible reason** rather than firing a doomed API call.

### Remote resolution (fork-aware)
"Infer the repo from the cwd" is not enough for the common case. In a fork workflow,
`origin` is the user's fork but their PRs are opened against the **upstream/parent** repo;
querying `origin` would return zero PRs and the tool would look broken for exactly its
target user. `repo.ts` therefore: (1) reads the `origin` remote → `owner/repo`; (2) calls
`repos.get()` and, if the repo is a fork (`.parent` present), targets the **parent** repo
for PR/check queries; (3) honors an explicit config/flag override
(`repo: owner/name`). The viewer's permission is resolved against whichever repo is
chosen (drives the rerun gate above).

## 4. Data Flow

```
boot → resolve token + repo + current user + viewer permission
     → fetch PR list (author:@me is:pr is:open repo:owner/name)
     → select PR → fetch its checks (GraphQL statusCheckRollup)
     → Enter on a failed check → resolve run via check_suite_id → fetch logs + annotations
                               → heuristic auto-runs
                               → 'a' escalates trimmed context to LLM
```

## 5. Refresh Model (hybrid)

- **Selected PR's checks:** poll fast (~10s) *while any check is pending*.
- **PR list:** poll slow (~30s).
- **`r`:** force-refresh now.
- Polling **pauses** when all checks are terminal (nothing pending) to avoid pointless
  API calls.
- **Single-flight + reconciliation (poll engine, `store.ts`):** at most one in-flight
  request per resource (a poll never stacks on a slow predecessor); when a poll resolves,
  results are reconciled against current UI state **by stable id** (PR number, check
  name) so a late response can't reset the user's selection, scroll offset, or open
  analysis pane.
- **Rate-limit reality:** core REST is 5000/hr (ample for one repo), but the **Search
  API** used for the PR list is a separate **30 req/min** bucket, and **GitHub Models**
  has tight per-minute + daily caps. The throttling plugin handles REST backoff; LLM
  429s get explicit backoff + a status-bar notice rather than silent failure.

## 6. UX & Visual Design

**Personality:** dense power-tool — instrument-panel feel, closer to `htop`/`lazygit`
than a marketing dashboard. Every row earns its space (status, timing, signal counts).
Win with rhythm and alignment, not chrome.

**Color:** themed palette (Catppuccin/Tokyo-Night family). Consistent hues per category
(PR titles, check names, timing/meta, status glyphs). Color is structural *and*
semantic, drawn from a **theme-token layer** — no hard-coded hues anywhere. **v1 ships
`mocha` only**; the token layer makes a second palette a ~30-line addition, so
`tokyo-night` is **deferred until the core loop works** (documented below so it's a drop-in
later, not a rebuild).

- **`mocha`** (v1 default, Catppuccin Mocha) — warm, low-contrast pastels on indigo
  (`base #1e1e2e`): mauve titles `#cba6f7`, teal check names `#94e2d5`, blue selection
  `#89b4fa`, dim meta `#6c7086`, green `#a6e3a1` / red `#f38ba8` / peach `#fab387`
  status, yellow `#f9e2af` flags.
- **`tokyo-night`** *(deferred, post-v1)* — cooler, higher-contrast navy (`bg #1a1b26`):
  magenta titles `#bb9af7`, cyan check names `#7dcfff`, blue selection `#7aa2f7`, dim meta
  `#565f89`, green `#9ece6a` / red `#f7768e` / orange `#ff9e64` status, yellow `#e0af68`
  flags. (Values recorded now; wired up once the core loop is solid.)

**Motion:** noticeable but professional, and **redraw-frugal** (timed full-tree
re-renders flicker over SSH). Two mechanisms:
- **Spinners** for running checks are driven by **one shared ticker** (a single interval
  in `store.ts`), not a per-spinner interval — bounded redraw cost regardless of how many
  checks are running.
- **Change affordance:** instead of a 1s decaying flash (which you'd also miss if you
  glanced away for longer), a check that flips to a terminal state gets a **persistent
  "changed" marker** on its row that **clears when you focus/visit it**. This catches a
  change whenever you look back, and needs no animation timer. *(This refines the earlier
  "brief highlight" choice — same intent, steadier rendering.)*

### Layout

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

- **Left pane (~36 cols, fixed):** PR list. Each row: `status-glyph #num title`
  (truncated) + trailing mini-summary of check counts (`✓3 ✗1 •1`) for triage without
  selecting. Selected row gets the accent selection bar.
- **Right pane (flex):** stacked zones — header (title, `branch → base`, ahead/behind,
  review/comment counts), a rule, the checks table (glyph · name · duration ·
  flaky/real flag), then the detail/analysis region that fills on `Enter`.
- **Status bar (bottom):** dim, context-sensitive keybinding hints; transient messages
  (errors, "rerunning 3 jobs…") surface here.
- **Hierarchy** via weight + hue + alignment: status glyphs loudest (semantic color),
  names in foreground, timing/meta dimmed (`overlay`), durations right-aligned into a
  scannable column.

**Ink rendering reality (call out so it isn't discovered mid-build):** Ink has **no
scroll container** and **no floating/z-index overlays**. So: (1) both the PR list and the
checks table scroll via **manual windowing** — track a cursor index, measure terminal
height, slice the visible row range around the cursor; (2) the confirm and help "overlays"
are **focus-trapped views that replace** the pane/screen region, not layered modals.

### Keybindings

`↑/↓` or `j/k` move · `Tab`/`h`/`l` switch pane · `Enter` drill into check · `Esc`
collapse analysis · `r` refresh now · `R` rerun failed (**confirm dialog**) · `a` LLM
analyze current check · `o` open PR/check in browser · `?` help overlay · `q`/`Ctrl-C`
quit.

### Key states

- **Loading (first paint):** skeleton rows + header spinner; never a blank screen.
- **Populated:** default dense view.
- **Empty (no open PRs):** centered message — "No open PRs by @you in owner/repo" +
  hint (`r` refresh, `o` open repo).
- **Pending checks:** spinner glyph per running check; list mini-summary shows `•`
  counts; fast poll active.
- **Failure selected:** check row flagged `⚑ real?` / `⚑ flaky?` once heuristics run.
- **Analysis view:** failing step name, trimmed error region, heuristic verdict +
  confidence; `a` adds an LLM section with its own inline spinner while thinking.
- **Rerun confirm:** centered prompt — "Rerun 3 failed jobs across 2 workflows? (y/n)".
- **Rerun unavailable:** when the viewer lacks `actions:write` (e.g. a fork PR) or the run
  isn't a completed latest attempt, `R` is shown **disabled with the reason** ("no write
  access to owner/repo" / "run still in progress") — never a silent 403.
- **Requeued (post-rerun):** on a successful rerun, affected checks **optimistically flip
  to pending immediately** and the fast poll is kicked at once, so the user sees movement
  rather than the stale failed/green state (and doesn't re-mash `R`).
- **Error states:** not a repo / no token / rate-limited / expired logs (410) / **models
  scope missing** / LLM unconfigured — each a one-line status-bar message in the `error`
  hue, keeping last-good data on screen.
- **All-green:** restrained — header turns green + a quiet "all checks passing" line.

### Content / glyph language

- `✓` pass · `✗` fail · `•`/spinner pending · `⊘` skipped/neutral · `⚑` flaky/real flag.
  Consistent everywhere.
- Microcopy: empty state, rerun confirm, "LLM not configured — set an endpoint in
  config to enable analysis," rate-limit notice, "logs expired for this run."
- Dynamic ranges to design for: 0 / ~3 / 20+ PRs (list scrolls); 1 / ~6 / 30+ checks
  per PR (checks table scrolls independently); log slices trimmed to the failing region
  (capped before sending to an LLM).
- **Narrow terminals (<80 cols):** graceful degradation — drop the left-pane mini
  check-summary first, then collapse to a single pane.

## 7. Failure Analysis

### Heuristic (always on)
Download failed-job logs + annotations, then classify:

- **Flaky signals:** passed-on-retry (attempt > 1 now green), network/DNS/`ETIMEDOUT`/
  503/rate-limit, OOM / exit 137 / "Killed".
- **Real-failure signals:** assertion diffs, compile/type errors, lint failures.
- **Output:** a label (`likely flaky` / `likely real` / `unclear`) + confidence, the
  failing step name, and the extracted error lines (logs trimmed to the relevant
  region).

This is a pure function — the highest-value test target.

### LLM (opt-in, `a`)
Sends the trimmed failing region + heuristic findings → returns plain-language "what
broke, flaky vs. real + why, suggested next step." Config (via `config.ts`) from
`~/.config/greenlight/config.json` or env vars (`LLM_BASE_URL`, `LLM_API_KEY`,
`LLM_MODEL`); `baseURL` defaults to GitHub Models. Distinct failure messages:
**unconfigured** → "set an endpoint to enable analysis"; **403/`models:read` missing** →
"GitHub Models needs the `models:read` scope — run `gh auth refresh -s models` or use a
PAT"; **429** → backoff + "rate-limited, retrying." The borrowed `gh` token does **not**
include `models:read` by default (see §2), so the default GitHub Models path is opt-in,
not automatic.

## 8. Error Handling & Empty States

Every failure path is non-crashing and communicates clearly: no `gh`/token, not a git
repo, no remote, no open PRs, expired logs (410), no write access (rerun disabled),
`models:read` missing, LLM unconfigured.

- **Retry/backoff:** a shared request wrapper distinguishes **primary** rate limits
  (5000/hr) from **secondary/abuse** limits (403 + `Retry-After`) and **honors
  `Retry-After`** with bounded exponential backoff; `@octokit/plugin-throttling` provides
  the baseline. Network blips keep last-good data on screen + a status-bar notice.
- **Search staleness is expected, not a bug:** the Search API (PR list) indexes with a
  short lag, so a just-opened PR may not appear for a few seconds — surfaced as normal,
  not an error.

## 9. Testing (TDD)

- **Heuristic classifier:** prime target — pure function, log fixtures for flaky vs.
  real cases.
- **GitHub mappers:** unit tests against recorded JSON fixtures (incl. a **fork PR**
  fixture and a multi-attempt `check_suite_id` join case).
- **Store / poll engine:** tested headless with an **injectable fake timer** — verify
  single-flight (no stacked polls), pause-on-terminal, and that a late/stale response is
  **discarded** rather than overwriting newer selection state.
- **UI:** `ink-testing-library` for render + simulated keypresses.

## 10. Open Questions

- **Fork targeting default:** when `origin` is a fork, auto-targeting the parent is right
  for the common case — but is it ever wrong (someone who genuinely opens PRs against
  their own fork)? Override exists; confirm whether the default should ever prompt.
- Is the left-pane mini check-summary ever *too* dense at 20+ PRs? (Lean: keep it,
  revisit if cramped.)
- Confirm the <80-col degradation order (drop mini-summary → collapse to single pane).
