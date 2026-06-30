# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`greenlight` (binary `greenlight`, alias `gl`) is an Ink + React 19 terminal UI for
tracking *your own* open pull requests in the current repo and the health of their CI
checks. It triages each failed check as flaky-vs-real and can rerun failed jobs. The full
design rationale lives in `docs/superpowers/specs/2026-06-29-git-pr-tui-design.md` — read
it before any non-trivial change; it documents decisions (and rejected alternatives) that
aren't obvious from the code.

## Commands

```bash
pnpm install
pnpm dev                              # run from source (tsx src/cli.tsx), no build needed
pnpm build                            # tsup → dist/cli.js (ESM, node22, adds shebang)
pnpm test                             # vitest run (full suite)
pnpm test:watch
pnpm typecheck                        # tsc --noEmit

pnpm vitest run src/analysis/heuristic.test.ts   # single file
pnpm vitest run -t "flaky"                        # single test by name
```

Requires **Node ≥ 22**. Running the tool needs an authenticated `gh` (or `GITHUB_TOKEN`)
and a GitHub repo as the cwd.

## Critical conventions

- **ESM + NodeNext.** Every relative import must carry an explicit `.js` extension
  (e.g. `import { classify } from "./analysis/heuristic.js"`) even though the source is
  `.ts`/`.tsx`. Omitting it breaks the build.
- **No hard-coded colors.** All hues come from the theme-token layer in `src/theme.ts`
  (`getTheme(name)`). v1 ships `mocha` only; a second palette is a token-only addition.
- **Tests are colocated** (`src/**/*.test.ts[x]`). Most modules are designed to be tested
  in isolation against fixtures in `test/fixtures/`.

## Architecture

The flow is a one-way pipeline assembled by `src/cli.tsx`, which is the only place that
performs I/O wiring. It resolves a token, builds the Octokit client and the store, then
injects everything the UI needs as callbacks (`onRerun`, `onAnalyze`, `openUrl`) into a
single `<App>`. **Modules don't reach for each other's side effects** — they take their
dependencies as arguments, which is what makes them unit-testable (the store takes an
injectable `Timer`; GitHub mappers run against recorded JSON).

Boot sequence: `resolveToken` → `createOctokit` → `resolveTarget` → `createStore` →
`render(<App>)`.

**`src/store.ts` is the heart and the least obvious part.** It's a framework-agnostic
state container *and* the poll engine — UI subscribes; no component owns a `setInterval`.
Key invariants enforced here, not in the UI:
- **Single-flight** per resource via `prsInFlight` / `checksInFlight` — a poll never
  stacks on a slow predecessor.
- **Hybrid polling:** PR list polls slow (`listMs`, ~30s); the selected PR's checks poll
  fast (`checksMs`, ~10s) *only while `hasPending()` is true*. An all-green PR stops
  generating API calls.
- **Stale-response guard:** `loadChecks` captures `selectedPr` before awaiting and discards
  the result if selection changed, so a late response can't overwrite newer UI state.
- **`markRequeued`** optimistically flips just the *failed* checks of the rerun workflow
  runs to pending, and deliberately does **not** refetch — GitHub hasn't propagated the new
  attempt yet, so a refetch would clobber the flip with the stale rollup. The flip makes
  `hasPending()` true, so the normal fast poll reconciles once the new attempt appears.

**GitHub access boundary (`src/github/`, `src/octokit.ts`, `src/repo.ts`):**
- Checks come from **one GraphQL call** to the PR's `statusCheckRollup` (`github/checks.ts`)
  — the authoritative pre-merged list across both check backends. REST is reserved for the
  *actions*: rerun (`github/rerun.ts`) and log fetches (`github/logs.ts`).
- `repo.ts` is **fork-aware**: it reads `origin`, and if the repo is a fork it targets the
  **parent** for PR/check queries (your PRs live upstream, not on your fork). It also
  resolves the viewer's write permission, which gates rerun.
- Checks join to workflow **runs** via `checkSuiteId` (carried on `Check`), since rerun/logs
  need run ids, not check-run ids. See `src/types.ts` for the `Check` shape and which id is
  used for what.

**Analysis (`src/analysis/`):** `heuristic.ts` is a **pure function** (`classify`) — the
highest-value test target — that labels a failure flaky/real/unclear from logs +
annotations. `llm.ts` is opt-in: it sends the trimmed context to any OpenAI-compatible
endpoint. Heuristics work with zero LLM config; the LLM is a pure add-on.

**Config (`src/config.ts`):** resolution order is **flags → env → config file → default**.
Never throws on a missing/invalid file. File lives at `~/.config/greenlight/config.json`
(honors `XDG_CONFIG_HOME`).

**UI (`src/ui/`) and Ink's constraints:** Ink has **no scroll container and no
floating/z-index overlays**. Both panes therefore scroll via **manual windowing** (track a
cursor index, measure terminal height, slice the visible range), and the confirm/help
"overlays" are **focus-trapped views that replace** the region, not layered modals. Keep
this in mind before adding any scrolling or modal UI.
