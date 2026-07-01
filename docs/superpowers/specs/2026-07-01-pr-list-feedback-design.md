# PR-list feedback: up-front counts, check cursor, merge-conflict indicator

Date: 2026-07-01
Status: Approved (design)

Three refinements from using the app, addressed together because they all touch the
PR-list → checks display path.

## Motivation

1. **Counts blank until you scroll.** On launch only the auto-selected PR (`prs[0]`) has
   its checks fetched, so every other row shows `✓0 ✗0 •0` until scrolling selects it and
   triggers a fetch. The counts should be present up front.
2. **Check-pane cursor is ambiguous.** `Detail.tsx` only recolors the selected check's
   name. Unlike `PrList` (which has a `❯` arrow), there's no positional cursor marker, so
   it's hard to tell which check is selected.
3. **No merge-conflict visibility.** Nothing shows when a PR can't merge due to conflicts.

## Non-goals

- **Listing which files conflict.** GitHub exposes no API for the conflicting file set.
  The only routes are local `git merge-tree` (needs both branches fetched; unreliable for
  fork PRs, which the tool targets on the parent) or an overlapping-changed-files
  approximation (frequently wrong). Decision: **conflict indicator only.**
- No change to the hybrid polling cadence, the stale-response guard, or `markRequeued`.

## Item 1 — Check counts on launch

### Data
- Extend the `listMyOpenPrs` GraphQL query (`src/github/prs.ts`) to fetch, per PR,
  `commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 50) {
  nodes { … } } } } } }` — the same rollup shape `src/github/checks.ts` fetches for a single
  PR, but capped at `first: 50` (see cost note below) instead of the detail query's `100`.
- **Extract the rollup-context → `Check[]` mapper** from `checks.ts` into a new shared
  module `src/github/rollup.ts` (e.g. `mapRollupContexts(nodes): Check[]`), covering the
  `CheckRun` / `StatusContext` union and the status/conclusion mapping. Both `checks.ts`
  and `prs.ts` import it. Single source of truth for the mapping (DRY).
- `listMyOpenPrs` returns `{ prs: PullRequest[]; checks: Record<number, Check[]> }` instead
  of `PullRequest[]`.

### Cost (GraphQL rate limit)
The list query is `search(first:50)` + `commits(last:1)` + `contexts(first:50)` per PR.
By GitHub's connection-based scoring the worst case is ~50 + 50 + 2500 ≈ **~26 points per
list poll**; at ~30s `listMs` that's ~3,100/hr — within the 5,000/hr primary budget, and
it scales linearly with PR count (a realistic <15-PR "my own open PRs" set is ~1,000/hr).
The `first: 50` cap (vs `100`) roughly halves the ceiling while still covering essentially
all real repos. The single-PR fast poll (`fetchChecks`, ~1 point) is unchanged.
**Trade-off (S3):** reusing the full mapper means the list over-fetches fields
(`checkSuiteId`/`workflowRunId`/timestamps) that non-selected rows don't render. We accept
this for DRY and because those ids are needed when the user hits `R` on a freshly-selected
PR *before* `loadChecks` returns (rerun reads the list-derived `Check[]`; see tests).

### Store ownership split (the non-obvious part)
`state.checks` is shared between two poll paths. To avoid the list poll clobbering the
selected PR's fresher state:

- `loadPrs` (slow list poll, ~30s) **rebuilds** `state.checks` from the query's per-PR
  checks (so PRs that have closed/merged drop out — N3), but **preserves the existing
  entry for two protected sets**: (a) the currently-selected PR, and (b) recently-requeued
  PRs (see below).
- The selected PR's `state.checks` entry stays owned exclusively by `loadChecks` (fast
  ~10s poll), preserving its stale-response guard.
- **Apply-time selection read (S2):** `loadPrs` awaits the query, so it must read
  `state.selectedPr` *at the `set()` merge point*, not capture it before the await —
  otherwise a selection change mid-flight preserves the wrong PR. This mirrors the stale
  guard `loadChecks` already uses (`store.ts:58`).

### `markRequeued` protection across navigation (B1)
`markRequeued` optimistically flips the selected PR's failed checks to pending and
deliberately does **not** refetch, because GitHub hasn't propagated the new attempt yet.
The new list poll *is* a periodic refetch of every non-selected PR, so if the user reruns
PR #5 then navigates away within the propagation window, the next `loadPrs` would overwrite
#5's flip with the stale failed rollup (row reverts pending → ✗). Current code can't hit
this because `loadPrs` never wrote `checks`.

Fix: `markRequeued` records a per-PR suppression expiry
(`requeuedUntil: Map<number, number>`, ~45s). The `loadPrs` merge skips any PR whose
suppression is still active, so the flip survives navigation. Entries lapse after the
window (by then the attempt has propagated), after which the list poll reconciles normally.
The selected PR is already protected by its own ownership, so this specifically covers the
navigate-away case.

On selecting a PR, its list-derived counts are already present (Detail shows them
immediately instead of blank), then `selectPr → loadChecks` refreshes with full detail.

### Result
Counts render on launch and refresh every list poll; the fast detail fetch for the
selected PR is unchanged. All-green PRs still generate no fast-poll traffic.

## Item 2 — Check-pane cursor indicator

`src/ui/Detail.tsx`: prepend a two-column marker to each check row — `❯ ` for the row where
`checks.indexOf(c) === checkCursor`, `  ` otherwise — mirroring `PrList.tsx`. Keep the
existing selection recolor. Presentational only; no store/data change.

## Item 3 — Merge-conflict indicator

### Data
- Add `mergeable` to the `listMyOpenPrs` query.
- Add to `PullRequest` (`src/types.ts`):
  `mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN"`.
- GitHub computes `mergeable` lazily, so `UNKNOWN` is common on first fetch and resolves on
  a later poll. Treat **only `CONFLICTING`** as a conflict; `UNKNOWN` shows no badge.

### Theme
- Add a dedicated `conflict` token to `Theme` and the `mocha` palette (token-only addition,
  allowed by conventions). Do **not** reuse `flag` — it already denotes the analysis
  verdict accent (⚑). Use a **visually distinct hue**: `#eba0ac` (mocha "maroon"), which
  reads separately from both `flag`/`#f9e2af` (⚑, yellow) and `fail`/`#f38ba8` (✗, pink).
  Note the earlier draft's `#f9e2af` was identical to `flag` — avoid that collision.

### Display (both places)
- `PrList.tsx` row: a `⚠` marker (colored `theme.conflict`) on conflicting PRs.
- `Detail.tsx` header: a `⚠ merge conflict` line (colored `theme.conflict`) under the
  branch line when the selected PR is `CONFLICTING`.

## Testing

- `rollup.ts`: unit-test the shared mapper against existing fixtures (moves/reuses the
  mapping assertions currently exercised via `checks.ts`).
- `prs.ts`: extend fixture/test to assert the new return shape `{ prs, checks }`, rollup
  counts, and `mergeable` passthrough.
- `store.ts`:
  - `loadPrs` populates counts for non-selected PRs and does **not** overwrite the selected
    PR's checks.
  - **Navigate-away clobber (B1):** requeue PR #5, select #7, run a `loadPrs` that returns a
    stale failed rollup for #5 → #5's flipped-pending checks are preserved (suppression
    window), not reverted to ✗. And after the window lapses, a `loadPrs` *does* reconcile.
  - **Apply-time selection (S2):** selection changing during the `loadPrs` await preserves
    the PR selected at merge time, not the one captured before the await.
  - Closed PRs drop out of `state.checks` after a `loadPrs` that no longer lists them (N3).
- `prs.ts`: return shape `{ prs, checks }`, rollup counts, and `mergeable` passthrough.
- `PrList.test.tsx`: conflict marker renders only for `CONFLICTING` (not `UNKNOWN`).
- `Detail.test.tsx`: `❯` cursor marker on the selected check row; `⚠ merge conflict` line
  on a conflicting PR.
- **`mergeable` lazy resolution (S4):** a PR that is `UNKNOWN` shows no badge, and after a
  later poll returns `CONFLICTING` the badge appears.
- **Rerun-on-fresh-select (S4):** hitting `R` on a just-selected PR before `loadChecks`
  returns uses the list-derived `Check[]`, which carry `workflowRunId` (guards the S3
  full-field choice against a future "trim list fields" regression).
- `theme.test.ts`: `conflict` token present and distinct from `flag`.

## Files touched

- `src/github/rollup.ts` (new), `src/github/checks.ts`, `src/github/prs.ts`
- `src/store.ts`, `src/types.ts`, `src/theme.ts`
- `src/ui/PrList.tsx`, `src/ui/Detail.tsx`
- Colocated `*.test.ts[x]` for each.
