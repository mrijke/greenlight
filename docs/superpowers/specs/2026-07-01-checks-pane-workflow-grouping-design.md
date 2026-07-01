# Checks pane: workflow-grouped, collapsible checks

## Problem

In a monorepo where many projects call the same shared/reusable workflow, every
project's check run is named after the shared **job** (`ci-cd`). The checks pane
(`src/ui/Detail.tsx`) renders a flat list keyed on that job name, so the pane shows a
wall of identical `ci-cd` rows with no way to tell which project each belongs to.

The distinguisher GitHub exposes is the **calling workflow's name** — each project's
caller workflow file has its own top-level `name:`. It reaches us via the same
`statusCheckRollup` GraphQL call we already make, as
`CheckRun.checkSuite.workflowRun.workflow.name`.

## Goal

Group the checks pane by workflow name. A workflow with multiple jobs becomes one
collapsible group whose header shows an aggregate pass/fail/pending indicator. Groups
start collapsed except failing ones (triage-first). Pressing Enter on a group toggles it.

## Non-goals

- Group-level actions. `R` still reruns **all** failed jobs on the PR; `o` on a header
  falls back to the PR URL. (Explicitly decided: navigation-only headers.)
- Any change to the PR list pane, analysis pane, polling, or the rerun/log REST paths.
- Cross-repo grouping. Greenlight already targets one repo per invocation.

## Data: carry the workflow name through

The name rides the existing rollup query — no new API calls. The **grouping key** is
`Check.workflowRunId`, which is *already* fetched (`checks.ts:13`, `workflowRun { databaseId }`)
and already on the `Check` type (`types.ts:15`). We only add the workflow's display **name**,
used purely as the group *title*.

- **`src/github/checks.ts`** — extend the `CheckRun` selection with `workflow { name }`:
  ```graphql
  checkSuite { databaseId workflowRun { databaseId workflow { name } } }
  ```
- **`src/github/rollup.ts`** — `RollupCheckRun.checkSuite.workflowRun` gains
  `workflow: { name: string | null } | null`. Map into a new field.
- **`src/types.ts`** — `Check` gains `workflowName: string | null`.
  - CheckRun: `n.checkSuite?.workflowRun?.workflow?.name ?? null`.
  - StatusContext (legacy commit statuses): always `null` — no workflow exists.

**Why the id, not the name, is the key** (review finding #4): GitHub does not enforce
uniqueness of a workflow's top-level `name:` across files, so two distinct caller workflows
both named `CI` would merge into one group and defeat the feature. The name is also nullable
and can flicker null across polls, which would migrate checks between their real group and
`__other__`. `workflowRunId` is collision-free, non-null for every Actions run, and stable
across rerun *attempts* (so grouping survives `markRequeued`).

No other consumer of `Check` needs to change; `workflowName` is additive and nullable.

## Grouping logic — new pure module `src/ui/checkGroups.ts`

This is the highest-value test target: pure functions over `Check[]`, no Ink, no I/O.

```ts
export interface CheckGroup {
  key: string;                 // String(workflowRunId), or "__other__"
  title: string;               // workflowName, or "Other"
  checks: Check[];
  counts: { pass: number; fail: number; pending: number };  // via checkCounts()
  status: "fail" | "pending" | "pass" | "skip";             // aggregate for glyph/color
}

export type Override = "expanded" | "collapsed";

export type Row =
  | { kind: "header"; group: CheckGroup; expanded: boolean }
  | { kind: "check"; check: Check; group: CheckGroup };
```

**`groupChecks(checks: Check[]): CheckGroup[]`**
- Bucket by `check.workflowRunId != null ? String(check.workflowRunId) : "__other__"`. All
  workflow-less checks (legacy status contexts **and** any non-Actions/integration check
  run without a `workflowRun`) collect into the single `__other__` group.
- `title` = the first non-null `workflowName` among the group's checks, else `"Other"` for
  `__other__` (defensively `"Workflow"` if an Actions run ever reports a null name).
- Ordering: real groups sorted **alphabetically by title** (case-insensitive); `__other__`
  always **last**. Alphabetical is deterministic and stable across polls (unlike
  `statusCheckRollup` order or a status-based sort, which would reorder rows as CI
  transitions — review finding #7). Check order within a group is preserved.
- `counts` = `checkCounts(group.checks)` (reused from `src/format.ts`).
- `status` = `fail` if `counts.fail > 0`, else `pending` if `counts.pending > 0`, else
  `pass` if `counts.pass > 0`, else `skip` (checks present but all skipped/neutral). `skip`
  renders with the `⊘`/skip color rather than a misleading green `✓` (finding #11).

**`flattenRows(groups: CheckGroup[], expanded: Set<string>): Row[]`**
- For each group in order: emit a `header` row; then, if `expanded.has(group.key)`, emit a
  `check` row per check. This flat list is the **single source of truth** for both
  rendering and cursor arithmetic.

**Expansion is derived, not accumulated** (replaces the earlier `reconcileExpansion`, per
findings #2/#5/#6). There is no per-poll reconciliation to leak or race. Expansion is a pure
function of current group status plus a small map of explicit user overrides:
```ts
export function deriveExpanded(groups: CheckGroup[], overrides: Map<string, Override>): Set<string> {
  const open = new Set<string>();
  for (const g of groups) {
    const o = overrides.get(g.key);
    if (o ? o === "expanded" : g.status === "fail") open.add(g.key);
  }
  return open;
}
```
- **Default** (no override): a group is expanded **iff** it is currently failing. So a
  newly-failing group auto-expands, a group that turns green auto-collapses, and a
  fail→pass→fail flake re-expands on the new failure — all continuously, no history needed.
- **Override** wins and is sticky: pressing Enter on a header records `expanded`/`collapsed`
  for that key, so a manually-collapsed failing group stays collapsed and a manually-opened
  green group stays open.
- `overrides` is keyed by `workflowRunId` and **reset on PR change**. Within one PR it is
  bounded by the workflow count; no pruning needed.

Trade-off (accepted): a failing group you were reading auto-collapses the moment it goes
green on a poll. That declutters once a job is done; if you want it kept open, Enter re-opens
it (which sets a sticky override).

## App wiring — `src/ui/App.tsx`

**State.** Two pieces replace `checkCursor`:
- `overrides: Map<string, Override>` — user expand/collapse choices. A single effect keyed
  on `[state.selectedPr]` resets it to an empty map on PR change (the *only* writer besides
  the Enter handler — no second effect, so the cross-PR race of finding #2 can't occur).
- `cursorId: string | null` — the **stable identity** of the selected row, not a raw index
  (finding #3). Reset to `null` on PR change.

**Row identity.** A helper `rowId(row)` returns `` `h:${group.key}` `` for a header and
`` `c:${check.checkRunId ?? group.key + ":" + check.name}` `` for a check. Identity is stable
across polls even as rows are inserted/removed, so the selection follows its row instead of
drifting when an auto-expand inserts children above it.

**Per-render derivation** (one source of truth for both view and keys):
```ts
const groups   = groupChecks(checks);
const expanded = deriveExpanded(groups, overrides);
const rows     = flattenRows(groups, expanded);
const cursor   = clampCursor(rows, cursorId);   // rows.findIndex(r => rowId(r)===cursorId), -> 0 on miss, clamped to [0, len-1]
```
`rows` + `cursor` are passed to `Detail`, and the same `rows`/`cursor` are read inside
`useInput` (Ink re-registers the handler each render, capturing current values).

**Keyboard (detail focus):**
- ↑/↓ → compute `next = clamp(cursor ± 1, 0, rows.length - 1)`, then set
  `cursorId = rowId(rows[next])`. Storing identity (not the index) is what makes the cursor
  poll-stable.
- **Enter** → `const row = rows[cursor]; if (!row) return;` (mirrors the existing
  `checks[checkCursor]?.` guard against a stale cursor after a poll shrinks `rows`,
  finding #1). If `row.kind === "header"`, set `overrides.set(row.group.key, expanded.has(key) ? "collapsed" : "expanded")`; if `"check"`, `analyze(row.check)`.
- **o** → `const row = rows[cursor];` check row: `row.check.detailsUrl ?? selectedPr.url`;
  header row (or no row): `selectedPr.url`.
- `analyze()` takes the current row's check instead of `checks[checkCursor]`, with the same
  `if (!check) return` guard it already has.
- **R** / rerun gate unchanged: `canRerun(checks)` / `failedRunIds(checks)` still operate on
  the whole PR's checks.

## Rendering — `src/ui/Detail.tsx`

Props change: `checks` + `checkCursor` → `rows: Row[]` + `cursor` (index). Title, branch
line, conflict line, divider, and the `windowRows` overflow handling are unchanged
(windowing now runs over `rows`).

```
❯ ▾ ✗ Project A                 ✓3 ✗2 •1     header: caret, ▸/▾, aggregate glyph, name, counts
      ✗ ci-cd                   1m20s        child row (indented), only when expanded
      ✓ lint                    0m48s
  ▸ ✓ Project B                 ✓4 ✗0 •0     collapsed group, all green
```

- **Header row:** selection caret (`❯ `/`  `), disclosure `▾` (expanded) / `▸` (collapsed),
  aggregate glyph colored by `group.status` (theme `fail`/`pending`/`pass`, and `skip` for
  an all-skipped group → `⊘`/skip color), truncated `group.title`, then
  `✓{pass} ✗{fail} •{pending}` in `theme.meta` (same format string as `PrList`).
- **Check row:** rendered only when its group is expanded; indented under the header, same
  glyph + name + duration as today, minus the redundant workflow context.
- **Selection:** compute per rendered row as `win.offset + i === cursor` (finding #10),
  rather than `rows.indexOf(row)`, which is both cheaper and immune to duplicate-row
  identity surprises. The caret follows whichever row (header or check) is current.
- **React keys:** prefix by kind — `` `h:${group.key}` `` / `` `c:${rowId}` `` — so a header
  and a child that share a display name can't collide (finding #13).

No `CHECKS_CHROME` change — the header/branch/divider chrome is untouched, so
`src/ui/layout.ts` needs no edit.

## Testing

- **`src/ui/checkGroups.test.ts`** (primary):
  - `groupChecks`: bucketing by `workflowRunId`; two workflows sharing a `name` stay
    **separate** groups (the collision case #4 guards against); `"Other"` collects
    null-`workflowRunId` checks and sorts last; alphabetical title order; check order within
    a group preserved; counts and aggregate `status` (incl. all-skipped → `skip`).
  - `flattenRows`: collapsed hides children; expanded emits children in order.
  - `deriveExpanded`: failing groups default-open, passing default-closed; a `collapsed`
    override keeps a failing group closed; an `expanded` override keeps a green group open;
    a fail→pass→fail transition (no override) re-opens on the new failure.
- **`src/github/rollup.test.ts`**: `workflowName` mapped from CheckRun; `null` for
  StatusContext; `workflowRunId` still populated as today.
- **`src/ui/Detail.test.tsx`**: header shows counts + disclosure glyph; collapsed group
  hides children; expanded group shows them; caret tracks the cursor.
- **`src/ui/App.test.tsx`**: Enter on a header toggles expansion; Enter on a check opens
  analysis; ↑/↓ traverse the flattened rows across headers and children; **cursor survives a
  poll** — after checks reload with an extra failing group inserted above, the selection
  stays on the same logical row (finding #3); **stale-cursor safety** — a poll that shrinks
  `rows` below the cursor index does not crash Enter/`o` (finding #1); **PR switch** clears
  overrides so the new PR starts from status-derived defaults (finding #2).

## Decisions / trade-offs

- **Group key is `workflowRunId`, title is `workflowName`** (review #4) — collision-free and
  poll-stable; the name is display-only.
- **Expansion is derived from status, not accumulated** (review #2/#5/#6) — failing ⇒ open,
  passing ⇒ closed, unless a sticky user override says otherwise. A failing group that turns
  green auto-collapses; Enter re-opens it if you want it kept.
- **Cursor is a stable row identity, re-derived to an index each render** (review #3) — so
  auto-expanding a group above the cursor never silently moves the selection.
- **Group ordering is alphabetical by title, `Other` last** (review #7) — deterministic and
  stable, chosen over a status-sort that would reorder rows as CI transitions.
- **Every workflow is a group.** In the target monorepo the shared `ci-cd` job invokes a
  reusable workflow that fans out into several sub-jobs; because all jobs of a `workflow_call`
  run share one `workflowRun`, they share one `workflowRunId` and land in **one multi-child
  group** under the project's workflow-name header. So groups are genuinely multi-item and the
  singleton concern (review #8) does not arise in practice; a truly single-job workflow simply
  renders as a one-child group.
- **All-skipped groups read as `skip` (`⊘`), not green** (review #11).
