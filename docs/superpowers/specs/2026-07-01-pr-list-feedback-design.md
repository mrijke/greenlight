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
  `commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) {
  nodes { … } } } } } }` — the same rollup shape `src/github/checks.ts` already fetches for
  a single PR.
- **Extract the rollup-context → `Check[]` mapper** from `checks.ts` into a new shared
  module `src/github/rollup.ts` (e.g. `mapRollupContexts(nodes): Check[]`), covering the
  `CheckRun` / `StatusContext` union and the status/conclusion mapping. Both `checks.ts`
  and `prs.ts` import it. Single source of truth for the mapping (DRY).
- `listMyOpenPrs` returns `{ prs: PullRequest[]; checks: Record<number, Check[]> }` instead
  of `PullRequest[]`.

### Store ownership split (the non-obvious part)
`state.checks` is shared between two poll paths. To avoid the list poll clobbering the
selected PR's fresher state:

- `loadPrs` (slow list poll, ~30s) merges the query's per-PR checks into `state.checks`
  **for every PR except `state.selectedPr`**.
- The selected PR's `state.checks` entry stays owned exclusively by `loadChecks` (fast
  ~10s poll). This preserves the existing stale-response guard and the `markRequeued`
  optimistic flip, which would otherwise be overwritten by a ~30s-stale list rollup.

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
  verdict accent (⚑). Suggested hue: `#f9e2af` (warning yellow), distinct from `fail`
  (`#f38ba8`).

### Display (both places)
- `PrList.tsx` row: a `⚠` marker (colored `theme.conflict`) on conflicting PRs.
- `Detail.tsx` header: a `⚠ merge conflict` line (colored `theme.conflict`) under the
  branch line when the selected PR is `CONFLICTING`.

## Testing

- `rollup.ts`: unit-test the shared mapper against existing fixtures (moves/reuses the
  mapping assertions currently exercised via `checks.ts`).
- `prs.ts`: extend fixture/test to assert the new return shape `{ prs, checks }`, rollup
  counts, and `mergeable` passthrough.
- `store.ts`: test that `loadPrs` populates counts for non-selected PRs and does **not**
  overwrite the selected PR's checks (guard against clobbering a `markRequeued` flip).
- `PrList.test.tsx`: conflict marker renders only for `CONFLICTING`.
- `Detail.test.tsx`: `❯` cursor marker on the selected check row; `⚠ merge conflict` line
  on a conflicting PR.
- `theme.test.ts`: `conflict` token present.

## Files touched

- `src/github/rollup.ts` (new), `src/github/checks.ts`, `src/github/prs.ts`
- `src/store.ts`, `src/types.ts`, `src/theme.ts`
- `src/ui/PrList.tsx`, `src/ui/Detail.tsx`
- Colocated `*.test.ts[x]` for each.
