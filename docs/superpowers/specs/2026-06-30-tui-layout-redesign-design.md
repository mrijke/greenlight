# Greenlight TUI layout redesign

**Date:** 2026-06-30
**Status:** Design approved, pending implementation plan
**Supersedes the layout decisions in:** `2026-06-29-git-pr-tui-design.md` (that doc's
analysis of polling, GitHub access, and heuristics is unchanged; only the on-screen
arrangement of panes changes here).

## 1. Feature summary

The current UI is a side-by-side layout: a fixed `width={36}` PR list on the left, with
Detail (checks) and Analysis stacked in the right column. Every pane height is hardcoded
to `12`, and nothing reads the terminal size. This redesign makes the UI a **vertical
stack that fills the whole terminal**, so PR titles are readable at full width and as many
checks as possible are visible at once, with explicit "more" indicators when content
overflows. Check analysis moves into a **pop-up third pane** that appears on demand.

It's for the same user as before: a developer triaging the CI health of their own open PRs
in the current repo, typically glancing at it repeatedly during a work session.

## 2. Primary user action

Scan your open PRs, land on a failing one, and read **all** of its checks at a glance —
then analyze a specific failure without losing sight of the PR and its other checks.

## 3. The three problems being fixed

1. **PR titles are unreadable.** The fixed 36-wide left pane truncates titles to 16 chars.
2. **The UI ignores the terminal.** Hardcoded `height={12}` wastes most of the window.
3. **Hidden checks.** `windowRows` silently slices off-screen checks with no indication
   that more exist.

## 4. Layout strategy

A single vertical stack (`flexDirection="column"`) that consumes the full terminal height,
measured at runtime:

```
┌─ PRs ───────────────────────────────────────┐   region A — auto-sized to # of PRs
│ ❯ ✗ #128 Fix flaky retry logic   ✓6 ✗1 •0   │     (full terminal width → full titles)
│   ✓ #131 Bump deps to node 24    ✓7 ✗0 •0   │
└──────────────────────────────────────────────┘
┌─ #128 Fix flaky retry logic ────────────────┐   region B — fills remaining height
│ ✓ build (ubuntu)            1m12s           │     (shrinks when analysis opens)
│ ✗ test (e2e)             ❯  4m41s           │
│ ✓ lint                      0m22s           │
│                            ↓ 3 more         │
└──────────────────────────────────────────────┘
┌─ ⚑ analysis · ✗ test (e2e) ─────────────────┐   region C — pop-up, only while analyzing
│ likely flaky · 72% · timeout, network       │
│ step: Run e2e suite                         │
│ Error: ETIMEDOUT connect 30000ms            │
│   at Socket.onTimeout (net.js:511)          │
│ [a] ask LLM · [o] open · [esc] close        │
└──────────────────────────────────────────────┘
  ↑↓ move · ⇥ pane · ↵ analyze · R rerun · r refresh · o open · ? help · q quit
```

**Height budget**, recomputed on every render and on terminal `resize`:

- Reserve the **status bar** as a fixed **1 row** (`STATUS_ROWS = 1`). The current
  `StatusBar.tsx` is always a single `<Box>` with no two-row mode, so the budget must not
  assume a second line. A long transient message **truncates to the measured width** (reuse
  `truncate`) rather than wrapping, keeping the budget stable. (If we ever want wrapping,
  that's a separate change and the budget would need to react to the wrapped height.)
- **Region A (PR list):** `2` (border) + `1` (header) + `min(prs.length, PR_CAP)` rows.
  `PR_CAP` ≈ 8. If `prs.length > PR_CAP`, the list windows around the cursor and shows an
  overflow footer. Sized to content so a 2-PR list doesn't waste half the screen.
- **Region C (analysis):** present only when open. Height =
  `clamp(floor(regionB_inner / 3), ANALYSIS_MIN, ANALYSIS_CAP)`, where `ANALYSIS_MIN` ≈ 6
  and `ANALYSIS_CAP` ≈ 14. It grows to fit its content up to the cap, then windows.
- **Region B (checks):** gets **all remaining** height after A, C, and the status bar.
  Inner rows = box height − `2` (border) − `3` (title, branch, divider). This is where the
  user wants the space to go.

**Small-terminal degradation:** regions have preferred minimum inner heights (A ≥ 1 row,
B ≥ 3 rows, analysis body ≥ 1 row). These are **best-effort**, not absolute: below roughly
20 rows with the pop-up open the minimal feasible sum exceeds the height, so they cannot all
hold simultaneously. B keeps priority by being reduced **last** — space is borrowed in order
from the analysis body (down to its min), then the PR list (down to 1 row), then the analysis
body again (down to a hard floor of 1, never empty); only then does B fall below its preferred
floor, landing at ≥ 1. Every overflowing region shows its "more" footer, so nothing is
silently lost, and there is no crash on tiny windows.

## 5. Key states

| Region | State | What the user sees |
|--------|-------|--------------------|
| A | No open PRs | "No open PRs by @viewer in owner/repo." (unchanged copy) |
| A | > PR_CAP PRs | Windowed list + `↑ N` / `↓ N more` footer |
| B | No PR selected | "Select a PR to see its checks." |
| B | PR selected, checks loading | Existing pending glyphs / empty until first poll resolves |
| B | More checks than fit | Windowed list + `↓ N more` (and `↑ N` when scrolled) footer |
| C | Closed (default) | Region C absent; B uses the full remaining height |
| C | Open, heuristic ready | Verdict, confidence, signals, failing step, error lines |
| C | Open, LLM loading | Spinner + "analyzing…" |
| C | Open, LLM done / error | LLM text, or error line |
| C | Open, no LLM configured | `[a]` shows "LLM not configured" — **a new behavior**, not just copy. The current handler doesn't consult config at all. `App` doesn't see config today, so thread a small `llmEnabled` boolean (e.g. `Boolean(config.llm.apiKey)`) as a prop from `cli.tsx` (the only place that owns config) and gate `[a]` on it, giving a clear message instead of a thrown error. |

## 6. Interaction model

- **Focus** toggles between region A (list) and region B (checks) with `⇥` / `h` `l`, as
  today. `↑↓` / `j` `k` move within the focused region.
- **Opening analysis:** `↵` on a check in region B opens region C for that check and runs
  the heuristic (existing `onAnalyze`). Opening C **pins an `analyzedCheckIndex`** that is
  *separate* from `checkCursor`: the user can keep moving the cursor in B (it stays visible
  and scrollable) while C continues to show — and act on — the check that was analyzed.
  Region B shrinks; region C appears.
- **While analysis is open:** `a` runs the deferred LLM call, `o` opens the **analyzed
  check's** `detailsUrl` (the pinned `analyzedCheckIndex`, *not* the current `checkCursor`),
  `esc` closes the pane and clears the pin, B reclaims the space. `↑↓` scroll region C when
  its content overflows.
- **Input routing is centralized in `App.tsx`, not in the pane.** Ink's `useInput` is
  global — there is no per-component focus trap at the React level — so the existing
  Help/Confirm "trap" works purely by early-returning inside `App`'s top-level handler
  (today `App.tsx:44–49`). Region C uses the *same* pattern: a
  `if (analysisOpen) { handle a / o / esc / ↑↓; return; }` guard at the top of App's
  handler. `AnalysisPane.tsx` is **presentational only** and must **not** register its own
  `useInput` — doing so would double-fire alongside App's handler. "Replaces only region
  C's slice" describes the *rendering* (A and B stay on screen, so it reads as a third pane
  rather than a full-screen modal), not the input wiring.
- **`a` and `o` must be gated on `analysisOpen`.** Today `a` fires the LLM call
  unconditionally (`App.tsx:105–111`) and `o` opens the focused region's URL
  (`App.tsx:56`). After this change both are handled *inside* the `analysisOpen` guard so
  they only act on the pop-up; the global (non-analysis) `o` keeps its current
  list-vs-detail behavior, and the global `a` is removed. The action behind `a` is
  unchanged (run the deferred LLM) — only *when* it fires is gated.
- **Rerun (`R`) and refresh (`r`)** behave exactly as today.
- **Resize:** the layout recomputes from the new terminal size; cursors and windows clamp
  to valid ranges.

## 7. Content / microcopy

- Region titles: `PRs`; the checks region uses the PR title (`#128 Fix flaky retry logic`);
  the analysis region uses `⚑ analysis · ✗ test (e2e)`.
- Overflow footers: `↓ {n} more` and `↑ {n}` (dim, `theme.meta`).
- Analysis footer hints: `[a] ask LLM · [o] open · [esc] close`.
- All existing copy (empty PR list, "Select a PR…", verdict labels) is preserved.

## 8. Components & files

- **New `src/ui/useTerminalSize.ts`** — hook over Ink's `useStdout()` that returns
  `{ rows, columns }` and updates on the stdout `resize` event, with sane fallbacks
  (`rows: 24, columns: 80`) when undefined. Single source of truth for sizing. Two caveats
  to handle: (1) `useStdout()` exposes the **raw TTY** rows/columns; Ink wraps its own
  output, so usable height can differ if a prompt or alt-screen is in play — treat the
  measured size as the budget ceiling and let the bottom-most overflow footer absorb any
  off-by-one. (2) Read the size in a **layout effect** (`useLayoutEffect`) after first
  render and seed state from it, so the first painted frame uses the real size instead of
  flashing at the `24×80` fallback for one frame.
- **`src/format.ts`** — extend the windowing helper to also report overflow above/below
  (e.g. `windowRows` returns `{ rows, offset, above, below }`) so panes can render the
  "more" footers from one tested function. Pure, unit-tested.
- **`src/ui/App.tsx`** — root becomes a column stack. Computes the height budget from
  `useTerminalSize`; owns `analysisOpen` state; routes input to region C when open;
  passes dynamic heights and full width down. No more hardcoded `12`.
- **`src/ui/PrList.tsx`** — full terminal width (drop fixed `width={36}`), truncate titles
  to the *measured* available width instead of 16, auto-size rows to `min(prs, PR_CAP)`,
  render the overflow footer.
- **`src/ui/Detail.tsx`** (checks pane) — full width, dynamic height, overflow footer, keep
  the selected check within the window. The header is **three rows that count toward
  region B's `−3`**: the title (currently truncated to a hardcoded `40` at `Detail.tsx:28`
  → truncate to *measured* width instead), the branch line, and the divider. The divider is
  currently `"─".repeat(30)` (`Detail.tsx:30`) and must become **width-aware** (repeat to
  the measured inner width) or it will look wrong at full width.
- **New `src/ui/AnalysisPane.tsx`** — bordered pop-up replacing the current borderless
  `Analysis.tsx`: title, heuristic block, windowed error/LLM body, footer hints.
  Presentational only — **no `useInput`** (see §6). The current `Analysis.tsx` content moves
  here **including the `label` helper and the signal-join logic**. Delete `Analysis.tsx`
  outright (not a thin re-export) so there aren't two live analysis components; update the
  import in `App.tsx` and rename `Analysis.test.tsx` → `AnalysisPane.test.tsx`.
- **`src/ui/StatusBar.tsx`** — unchanged except the hint string (stays a single row; long
  messages truncate to width per §4).
- **Tests** — colocated tests updated for new props; new `format` overflow cases covered.
  `useTerminalSize` is tested through **`ink-testing-library`** (`render` with a stdout
  stub that exposes `rows`/`columns` and emits `resize`), **not** as a bare hook call —
  `useStdout` reads from React context and throws without Ink's provider.

## 9. Constraints honored

- **Ink has no scroll container / no z-index** (per CLAUDE.md): all three regions scroll by
  manual windowing, and region C is a focus-trapped slice, not a layered modal.
- **No hard-coded colors:** footers/titles use existing `theme` tokens.
- **ESM `.js` import extensions** on every new relative import.

## 10. Open questions for implementation

- Exact values of `PR_CAP`, `ANALYSIS_MIN`, `ANALYSIS_CAP`, `STATUS_ROWS` (=1) — tune the
  three caps by eye during build; the design fixes the *strategy*, not the magic numbers.
