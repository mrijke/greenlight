# Checks Pane Workflow Grouping — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group the checks pane by GitHub workflow, as collapsible groups whose headers show an aggregate pass/fail/pending indicator; failing groups auto-expand, Enter toggles a header or analyzes a check.

**Architecture:** Carry the workflow display name through the existing `statusCheckRollup` GraphQL call (no new API calls); group in a new pure module keyed on the already-present `workflowRunId`; render a flattened `Row[]` (headers + expanded children) in `Detail.tsx`; drive expansion as a pure function of check status plus sticky user overrides, and track the cursor by stable row identity in `App.tsx`.

**Tech Stack:** TypeScript (ESM/NodeNext), React 19 + Ink, Vitest, ink-testing-library.

## Global Constraints

- **Node ≥ 22.**
- **ESM + NodeNext:** every relative import MUST carry an explicit `.js` extension (e.g. `import { groupChecks } from "./checkGroups.js"`), even from `.ts`/`.tsx`.
- **No hard-coded colors:** all hues come from the theme tokens in `src/theme.ts` (`theme.pass`/`fail`/`pending`/`skip`/`meta`/`selection`/`title`/`checkName`/`border`/`conflict`).
- **Tests are colocated** next to source (`src/**/*.test.ts[x]`).
- Full check: `pnpm test` (vitest run) and `pnpm typecheck` (tsc --noEmit) must both pass.
- Design spec of record: `docs/superpowers/specs/2026-07-01-checks-pane-workflow-grouping-design.md`.
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- `src/types.ts` — **modify**: add `workflowName: string | null` to `Check`.
- `src/github/checks.ts` — **modify**: add `workflow { name }` to the GraphQL selection.
- `src/github/rollup.ts` — **modify**: extend `RollupCheckRun` and map `workflowName`.
- `src/ui/checkGroups.ts` — **create**: pure grouping/expansion/row-identity logic + group glyph/color helpers.
- `src/ui/checkGroups.test.ts` — **create**: unit tests for the pure module.
- `src/ui/Detail.tsx` — **modify**: render `Row[]` (group headers + children) instead of a flat check list.
- `src/ui/Detail.test.tsx` — **modify**: rewrite around groups.
- `src/ui/App.tsx` — **modify**: derive groups/rows, track `overrides` + `cursorId`, rework keyboard.
- `src/ui/App.test.tsx` — **modify**: adapt analyze tests to the header-first cursor; add grouping tests.
- Test-literal upkeep (add `workflowName`): `src/format.test.ts`, `src/github/rerun.test.ts`, `src/store.test.ts`, `src/github/logs.test.ts`, `src/analysis/heuristic.test.ts`, `src/ui/AnalysisPane.test.tsx`, `src/ui/PrList.test.tsx`, `src/smoke.test.ts`.

---

## Task 1: Carry the workflow name through the data layer

**Files:**
- Modify: `src/types.ts` (the `Check` interface, ~line 6-17)
- Modify: `src/github/rollup.ts` (`RollupCheckRun` ~line 12-22; `mapRollupContexts` ~line 32-48)
- Modify: `src/github/checks.ts` (the `QUERY` CheckRun selection, ~line 13)
- Modify (typecheck upkeep): `src/format.test.ts:5`, `src/github/rerun.test.ts:7`, `src/store.test.ts:6`, `src/github/logs.test.ts:7`, `src/analysis/heuristic.test.ts:5`, `src/ui/AnalysisPane.test.tsx:8`, `src/ui/PrList.test.tsx:11`, `src/smoke.test.ts:4`
- Test: `src/github/rollup.test.ts`

**Interfaces:**
- Produces: `Check.workflowName: string | null` — the workflow's display name (CheckRun), `null` for legacy `StatusContext`. `Check.workflowRunId: number | null` is unchanged (already present, used as the group key in Task 2).

- [ ] **Step 1: Write the failing test**

Add to `src/github/rollup.test.ts` (after the existing `nodes` tests):

```ts
test("maps workflow name from CheckRun and null for status contexts", () => {
  const checks = mapRollupContexts([
    { __typename: "CheckRun", name: "ci-cd", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: null, startedAt: null, completedAt: null, databaseId: 21, checkSuite: { databaseId: 91, workflowRun: { databaseId: 700, workflow: { name: "Project A" } } } },
    { __typename: "StatusContext", context: "ci/legacy", state: "SUCCESS", targetUrl: null, createdAt: null },
  ]);
  expect(checks[0].workflowName).toBe("Project A");
  expect(checks[0].workflowRunId).toBe(700);
  expect(checks[1].workflowName).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/github/rollup.test.ts -t "maps workflow name"`
Expected: FAIL — `expected undefined to be "Project A"` (field not yet on `Check`).

- [ ] **Step 3: Add the field to `Check`**

In `src/types.ts`, inside the `Check` interface, add after `workflowRunId`:

```ts
  workflowName: string | null;   // CheckRun workflow display name; null for status contexts
```

- [ ] **Step 4: Extend the rollup source type and mapping**

In `src/github/rollup.ts`, change the `RollupCheckRun.checkSuite` shape to include an optional `workflow` (optional so existing fixtures that omit it still typecheck):

```ts
  checkSuite: { databaseId: number | null; workflowRun: { databaseId: number | null; workflow?: { name: string | null } | null } | null } | null;
```

In the `CheckRun` branch of `mapRollupContexts`, add to the returned object:

```ts
        workflowName: n.checkSuite?.workflowRun?.workflow?.name ?? null,
```

In the `StatusContext` branch, add:

```ts
      workflowName: null,
```

- [ ] **Step 5: Add the field to the GraphQL query**

In `src/github/checks.ts`, change the CheckRun `checkSuite` selection (line ~13) to request the workflow name:

```graphql
          checkSuite { databaseId workflowRun { databaseId workflow { name } } }
```

- [ ] **Step 6: Run the rollup test to verify it passes**

Run: `pnpm vitest run src/github/rollup.test.ts`
Expected: PASS (all tests, including the new one).

- [ ] **Step 7: Fix the other `Check` literals so the type checks**

Adding a required field breaks every `Check` literal. Add `workflowName: null,` to each of these object literals (for the spread-helper ones, adding it to the base object covers all call sites):

- `src/format.test.ts:5` — base object in `mk`
- `src/github/rerun.test.ts:7` — base object in `mk`
- `src/store.test.ts:6` — base object in `check`
- `src/github/logs.test.ts:7` — the `check` literal
- `src/analysis/heuristic.test.ts:5` — the `baseCheck` literal
- `src/ui/AnalysisPane.test.tsx:8` — the `check` literal
- `src/ui/PrList.test.tsx:11` — the check literal inside the record
- `src/smoke.test.ts:4` — the `c` literal
- `src/ui/Detail.test.tsx:9` — the `mkCheck` base object (rewritten in Task 3, but must typecheck now)
- `src/ui/App.test.tsx:11` — the `checks` literal (rewritten in Task 3, but must typecheck now)

- [ ] **Step 8: Verify the whole suite and types are green**

Run: `pnpm typecheck && pnpm test`
Expected: PASS — every `Check` literal now carries `workflowName`, so `tsc` is clean and the suite (with the new rollup assertion) is green.

- [ ] **Step 9: Commit**

```bash
git add src/types.ts src/github/rollup.ts src/github/checks.ts src/github/rollup.test.ts src/format.test.ts src/github/rerun.test.ts src/store.test.ts src/github/logs.test.ts src/analysis/heuristic.test.ts src/ui/AnalysisPane.test.tsx src/ui/PrList.test.tsx src/smoke.test.ts src/ui/Detail.test.tsx src/ui/App.test.tsx
git commit -m "feat: carry workflow name through the checks rollup

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Pure grouping module `src/ui/checkGroups.ts`

**Files:**
- Create: `src/ui/checkGroups.ts`
- Test: `src/ui/checkGroups.test.ts`

**Interfaces:**
- Consumes: `Check` (with `workflowRunId`, `workflowName`, `checkRunId`, `name`) from `src/types.ts`; `checkCounts` from `src/format.ts`; `Theme` from `src/theme.ts`.
- Produces:
  - `type GroupStatus = "fail" | "pending" | "pass" | "skip"`
  - `interface CheckGroup { key: string; title: string; checks: Check[]; counts: { pass: number; fail: number; pending: number }; status: GroupStatus }`
  - `type Override = "expanded" | "collapsed"`
  - `type Row = { kind: "header"; group: CheckGroup; expanded: boolean } | { kind: "check"; check: Check; group: CheckGroup }`
  - `groupChecks(checks: Check[]): CheckGroup[]`
  - `flattenRows(groups: CheckGroup[], expanded: Set<string>): Row[]`
  - `deriveExpanded(groups: CheckGroup[], overrides: Map<string, Override>): Set<string>`
  - `rowId(row: Row): string`
  - `groupGlyph(status: GroupStatus): "✓" | "✗" | "•" | "⊘"`
  - `groupColor(status: GroupStatus, theme: Theme): string`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/checkGroups.test.ts`:

```ts
import { expect, test } from "vitest";
import { groupChecks, flattenRows, deriveExpanded, rowId, groupGlyph } from "./checkGroups.js";
import type { Check } from "../types.js";

const mk = (o: Partial<Check>): Check => ({ name: "c", status: "completed", conclusion: "success", detailsUrl: null, startedAt: null, completedAt: null, checkRunId: null, checkSuiteId: null, workflowRunId: null, isStatusContext: false, workflowName: null, ...o });

test("groups checks by workflowRunId and titles them by workflow name", () => {
  const groups = groupChecks([
    mk({ name: "build", workflowRunId: 1, workflowName: "Project A", conclusion: "success" }),
    mk({ name: "lint", workflowRunId: 1, workflowName: "Project A", conclusion: "success" }),
    mk({ name: "ci-cd", workflowRunId: 2, workflowName: "Project B", conclusion: "failure" }),
  ]);
  expect(groups.map((g) => g.title)).toEqual(["Project A", "Project B"]);
  expect(groups[0].checks.map((c) => c.name)).toEqual(["build", "lint"]); // push order preserved
  expect(groups[0].counts).toEqual({ pass: 2, fail: 0, pending: 0 });
  expect(groups[1].status).toBe("fail");
});

test("two workflows sharing a name stay separate groups (keyed by run id)", () => {
  const groups = groupChecks([
    mk({ name: "ci-cd", workflowRunId: 10, workflowName: "CI" }),
    mk({ name: "ci-cd", workflowRunId: 11, workflowName: "CI" }),
  ]);
  expect(groups).toHaveLength(2);
});

test("workflow-less checks collect into an 'Other' group sorted last, rest alphabetical", () => {
  const groups = groupChecks([
    mk({ name: "vercel", workflowRunId: null, workflowName: null }),
    mk({ name: "build", workflowRunId: 5, workflowName: "Zeta" }),
    mk({ name: "build", workflowRunId: 3, workflowName: "Alpha" }),
  ]);
  expect(groups.map((g) => g.title)).toEqual(["Alpha", "Zeta", "Other"]);
});

test("a group of only skipped checks reads as skip with a ⊘ glyph", () => {
  const groups = groupChecks([mk({ workflowRunId: 1, workflowName: "S", conclusion: "skipped" })]);
  expect(groups[0].status).toBe("skip");
  expect(groupGlyph(groups[0].status)).toBe("⊘");
});

test("flattenRows emits children only for expanded groups", () => {
  const groups = groupChecks([
    mk({ name: "a", workflowRunId: 1, workflowName: "One" }),
    mk({ name: "b", workflowRunId: 2, workflowName: "Two" }),
  ]);
  expect(flattenRows(groups, new Set()).map((r) => r.kind)).toEqual(["header", "header"]);
  expect(flattenRows(groups, new Set(["1"])).map((r) => r.kind)).toEqual(["header", "check", "header"]);
});

test("deriveExpanded opens failing groups by default", () => {
  const groups = groupChecks([
    mk({ workflowRunId: 1, workflowName: "Fails", conclusion: "failure" }),
    mk({ workflowRunId: 2, workflowName: "Passes", conclusion: "success" }),
  ]);
  expect(deriveExpanded(groups, new Map())).toEqual(new Set(["1"]));
});

test("overrides win: collapsed keeps a failing group closed, expanded keeps a green group open", () => {
  const groups = groupChecks([
    mk({ workflowRunId: 1, workflowName: "Fails", conclusion: "failure" }),
    mk({ workflowRunId: 2, workflowName: "Passes", conclusion: "success" }),
  ]);
  const overrides = new Map<string, "expanded" | "collapsed">([["1", "collapsed"], ["2", "expanded"]]);
  expect(deriveExpanded(groups, overrides)).toEqual(new Set(["2"]));
});

test("a flake re-opens from status alone (no override) on each new failure", () => {
  const failing = groupChecks([mk({ workflowRunId: 1, workflowName: "Flaky", conclusion: "failure" })]);
  const passing = groupChecks([mk({ workflowRunId: 1, workflowName: "Flaky", conclusion: "success" })]);
  expect(deriveExpanded(failing, new Map())).toEqual(new Set(["1"]));
  expect(deriveExpanded(passing, new Map())).toEqual(new Set());
  expect(deriveExpanded(failing, new Map())).toEqual(new Set(["1"]));
});

test("rowId is stable per header key and per check", () => {
  const groups = groupChecks([mk({ name: "build", workflowRunId: 1, workflowName: "One", checkRunId: 99 })]);
  const rows = flattenRows(groups, new Set(["1"]));
  expect(rowId(rows[0])).toBe("h:1");
  expect(rowId(rows[1])).toBe("c:99");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/ui/checkGroups.test.ts`
Expected: FAIL — cannot find module `./checkGroups.js`.

- [ ] **Step 3: Implement the module**

Create `src/ui/checkGroups.ts`:

```ts
import type { Check } from "../types.js";
import type { Theme } from "../theme.js";
import { checkCounts } from "../format.js";

export type GroupStatus = "fail" | "pending" | "pass" | "skip";

export interface CheckGroup {
  key: string;
  title: string;
  checks: Check[];
  counts: { pass: number; fail: number; pending: number };
  status: GroupStatus;
}

export type Override = "expanded" | "collapsed";

export type Row =
  | { kind: "header"; group: CheckGroup; expanded: boolean }
  | { kind: "check"; check: Check; group: CheckGroup };

const OTHER_KEY = "__other__";

function groupStatus(counts: { pass: number; fail: number; pending: number }): GroupStatus {
  if (counts.fail > 0) return "fail";
  if (counts.pending > 0) return "pending";
  if (counts.pass > 0) return "pass";
  return "skip"; // checks present but all skipped/neutral (or empty)
}

// Real groups sort alphabetically by title; the synthetic "Other" group is always last.
// Alphabetical is deterministic and stable across polls (unlike rollup order or a status
// sort, which would reorder rows as CI transitions).
function compareGroups(a: CheckGroup, b: CheckGroup): number {
  if (a.key === OTHER_KEY) return 1;
  if (b.key === OTHER_KEY) return -1;
  return a.title.toLowerCase().localeCompare(b.title.toLowerCase());
}

export function groupChecks(checks: Check[]): CheckGroup[] {
  const buckets = new Map<string, Check[]>();
  for (const c of checks) {
    const key = c.workflowRunId != null ? String(c.workflowRunId) : OTHER_KEY;
    let list = buckets.get(key);
    if (!list) { list = []; buckets.set(key, list); }
    list.push(c);
  }
  const groups: CheckGroup[] = [];
  for (const [key, list] of buckets) {
    const title = key === OTHER_KEY ? "Other" : (list.find((c) => c.workflowName)?.workflowName ?? "Workflow");
    const counts = checkCounts(list);
    groups.push({ key, title, checks: list, counts, status: groupStatus(counts) });
  }
  return groups.sort(compareGroups);
}

export function flattenRows(groups: CheckGroup[], expanded: Set<string>): Row[] {
  const rows: Row[] = [];
  for (const group of groups) {
    const isOpen = expanded.has(group.key);
    rows.push({ kind: "header", group, expanded: isOpen });
    if (isOpen) for (const check of group.checks) rows.push({ kind: "check", check, group });
  }
  return rows;
}

// Expansion is a pure function of current status plus sticky user overrides: a group is
// open iff it is failing, unless the user has explicitly overridden it.
export function deriveExpanded(groups: CheckGroup[], overrides: Map<string, Override>): Set<string> {
  const open = new Set<string>();
  for (const g of groups) {
    const o = overrides.get(g.key);
    if (o ? o === "expanded" : g.status === "fail") open.add(g.key);
  }
  return open;
}

// Stable identity for cursor tracking across polls (index-free).
export function rowId(row: Row): string {
  return row.kind === "header"
    ? `h:${row.group.key}`
    : `c:${row.check.checkRunId ?? `${row.group.key}:${row.check.name}`}`;
}

export function groupGlyph(status: GroupStatus): "✓" | "✗" | "•" | "⊘" {
  return status === "fail" ? "✗" : status === "pending" ? "•" : status === "skip" ? "⊘" : "✓";
}

export function groupColor(status: GroupStatus, theme: Theme): string {
  return status === "fail" ? theme.fail : status === "pending" ? theme.pending : status === "skip" ? theme.skip : theme.pass;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/ui/checkGroups.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/ui/checkGroups.ts src/ui/checkGroups.test.ts
git commit -m "feat: pure module for grouping checks by workflow

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Render and drive the grouped, collapsible pane (Detail + App)

`Detail.tsx` and `App.tsx` share the pane's prop boundary, so they change together in one green commit: `Detail` switches from `checks`+`checkCursor` to `rows`+`cursor`, and `App` computes the rows and drives the cursor by identity. Tests for each are written before their implementation.

**Files:**
- Modify: `src/ui/Detail.tsx`
- Modify: `src/ui/Detail.test.tsx` (rewrite)
- Modify: `src/ui/App.tsx`
- Modify: `src/ui/App.test.tsx`

**Interfaces:**
- Consumes: everything Produced by Task 2; `checks: Check[]` from the store.
- Produces:
  - `Detail` props: `{ pr: PullRequest | null; rows: Row[]; cursor: number; focused: boolean; theme: Theme; width: number; visibleRows: number }`.
  - App keyboard contract (detail focus): ↑/↓ move the cursor across the flattened rows; Enter toggles a header's group or analyzes a check; `o` opens a check's URL or falls back to the PR URL; `R` unchanged (whole-PR rerun).

- [ ] **Step 1: Rewrite the Detail tests (failing)**

Replace the body of `src/ui/Detail.test.tsx` with:

```tsx
import { render } from "ink-testing-library";
import { expect, test } from "vitest";
import React from "react";
import { Detail } from "./Detail.js";
import { getTheme } from "../theme.js";
import { groupChecks, flattenRows } from "./checkGroups.js";
import type { PullRequest, Check } from "../types.js";

const pr: PullRequest = { number: 142, title: "Fix auth flow", url: "", isCrossRepository: false, mergeable: "MERGEABLE", headRefName: "feat/auth", baseRefName: "main", headSha: "s" };
const mk = (o: Partial<Check>): Check => ({ name: "c", status: "completed", conclusion: "success", detailsUrl: null, startedAt: "2026-06-29T10:00:00Z", completedAt: "2026-06-29T10:01:12Z", checkRunId: 1, checkSuiteId: 1, workflowRunId: 1, isStatusContext: false, workflowName: null, ...o });

const checks: Check[] = [
  mk({ name: "build", workflowRunId: 1, workflowName: "Project A", conclusion: "success", checkRunId: 11 }),
  mk({ name: "ci-cd", workflowRunId: 1, workflowName: "Project A", conclusion: "failure", checkRunId: 12 }),
  mk({ name: "deploy", workflowRunId: 2, workflowName: "Project B", conclusion: "success", checkRunId: 21 }),
];
const rowsFor = (expanded: Set<string>) => flattenRows(groupChecks(checks), expanded);

test("renders a group header with workflow name and aggregate counts", () => {
  const { lastFrame } = render(<Detail pr={pr} rows={rowsFor(new Set())} cursor={0} focused theme={getTheme("mocha")} width={80} visibleRows={10} />);
  expect(lastFrame()).toContain("Project A");
  expect(lastFrame()).toContain("✓1 ✗1 •0");
  expect(lastFrame()).toContain("▸");
});

test("a collapsed group hides its children", () => {
  const { lastFrame } = render(<Detail pr={pr} rows={rowsFor(new Set())} cursor={0} focused theme={getTheme("mocha")} width={80} visibleRows={10} />);
  expect(lastFrame()).not.toContain("ci-cd");
  expect(lastFrame()).not.toContain("build");
});

test("an expanded group shows its children under the header", () => {
  const { lastFrame } = render(<Detail pr={pr} rows={rowsFor(new Set(["1"]))} cursor={0} focused theme={getTheme("mocha")} width={80} visibleRows={10} />);
  expect(lastFrame()).toContain("ci-cd");
  expect(lastFrame()).toContain("build");
  expect(lastFrame()).toContain("▾");
});

test("the caret marks whichever row the cursor points at", () => {
  // rows: [header A, build, ci-cd, header B] — cursor 2 is "ci-cd"
  const { lastFrame } = render(<Detail pr={pr} rows={rowsFor(new Set(["1"]))} cursor={2} focused theme={getTheme("mocha")} width={80} visibleRows={10} />);
  expect(lastFrame()).toMatch(/❯ .*ci-cd/);
  expect((lastFrame()!.match(/❯/g) ?? []).length).toBe(1);
});

test("shows a 'more' footer when rows overflow", () => {
  const many = Array.from({ length: 30 }, (_, i) => mk({ name: `job-${i}`, workflowRunId: i, workflowName: `W${i}` }));
  const rows = flattenRows(groupChecks(many), new Set());
  const { lastFrame } = render(<Detail pr={pr} rows={rows} cursor={0} focused theme={getTheme("mocha")} width={80} visibleRows={5} />);
  expect(lastFrame()).toMatch(/more/);
});

test("shows placeholder when no PR selected", () => {
  const { lastFrame } = render(<Detail pr={null} rows={[]} cursor={0} focused theme={getTheme("mocha")} width={80} visibleRows={10} />);
  expect(lastFrame()).toMatch(/Select a PR/i);
});

test("shows a merge-conflict line when the PR is CONFLICTING", () => {
  const conflicted: PullRequest = { ...pr, mergeable: "CONFLICTING" };
  const { lastFrame } = render(<Detail pr={conflicted} rows={rowsFor(new Set())} cursor={0} focused theme={getTheme("mocha")} width={80} visibleRows={10} />);
  expect(lastFrame()).toMatch(/⚠ merge conflict/);
});
```

- [ ] **Step 2: Run Detail tests to verify they fail**

Run: `pnpm vitest run src/ui/Detail.test.tsx`
Expected: FAIL — `Detail` still expects `checks`/`checkCursor`; `rows`/`cursor` props render nothing meaningful.

- [ ] **Step 3: Rewrite `Detail.tsx` to render rows**

Replace the whole file `src/ui/Detail.tsx` with:

```tsx
import React from "react";
import { Box, Text } from "ink";
import type { PullRequest } from "../types.js";
import type { Theme } from "../theme.js";
import { formatDuration, glyph, glyphColor, truncate, windowRows } from "../format.js";
import { groupGlyph, groupColor, rowId, type Row } from "./checkGroups.js";

interface Props { pr: PullRequest | null; rows: Row[]; cursor: number; focused: boolean; theme: Theme; width: number; visibleRows: number; }

export function Detail({ pr, rows, cursor, focused, theme, width, visibleRows }: Props) {
  const borderColor = focused ? theme.selection : theme.border;
  if (!pr) {
    return (
      <Box flexGrow={1} width={width} borderStyle="round" borderColor={borderColor} paddingX={1}>
        <Text color={theme.meta}>Select a PR to see its checks.</Text>
      </Box>
    );
  }
  const inner = Math.max(4, width - 4); // minus border(2) + paddingX(2)
  const overflow = rows.length > visibleRows;
  const win = windowRows(rows, cursor, overflow ? Math.max(1, visibleRows - 1) : visibleRows);
  return (
    <Box flexDirection="column" width={width} borderStyle="round" borderColor={borderColor} paddingX={1}>
      <Text color={theme.title}>#{pr.number} {truncate(pr.title, Math.max(8, inner - 8))}</Text>
      <Text color={theme.meta}>{pr.headRefName} → {pr.baseRefName}{pr.isCrossRepository ? " (fork)" : ""}</Text>
      {pr.mergeable === "CONFLICTING" ? <Text color={theme.conflict}>⚠ merge conflict</Text> : null}
      <Text color={theme.border}>{"─".repeat(inner)}</Text>
      {win.rows.map((row, i) => {
        const isSel = win.offset + i === cursor;
        const caret = isSel ? "❯ " : "  ";
        if (row.kind === "header") {
          const g = row.group;
          return (
            <Box key={rowId(row)}>
              <Text color={isSel ? theme.selection : undefined}>{caret}</Text>
              <Text color={isSel ? theme.selection : theme.meta}>{row.expanded ? "▾ " : "▸ "}</Text>
              <Text color={groupColor(g.status, theme)}>{groupGlyph(g.status)} </Text>
              <Text color={isSel ? theme.selection : theme.checkName}>{truncate(g.title, 20).padEnd(20)} </Text>
              <Text color={theme.meta}>{`✓${g.counts.pass} ✗${g.counts.fail} •${g.counts.pending}`}</Text>
            </Box>
          );
        }
        const c = row.check;
        return (
          <Box key={rowId(row)}>
            <Text color={isSel ? theme.selection : undefined}>{caret}</Text>
            <Text color={theme.meta}>{"  "}</Text>
            <Text color={glyphColor(c, theme)}>{glyph(c)} </Text>
            <Text color={isSel ? theme.selection : theme.checkName}>{truncate(c.name, 20).padEnd(20)} </Text>
            <Text color={theme.meta}>{formatDuration(c.startedAt, c.completedAt)}</Text>
          </Box>
        );
      })}
      {overflow ? <Text color={theme.meta}>{`${win.above > 0 ? `↑${win.above} ` : ""}${win.below > 0 ? `↓${win.below} ` : ""}more`}</Text> : null}
    </Box>
  );
}
```

- [ ] **Step 4: Run Detail tests to verify they pass**

Run: `pnpm vitest run src/ui/Detail.test.tsx`
Expected: PASS. (`App.tsx` does not compile yet — it still passes the old props. That is fixed next, before any commit.)

- [ ] **Step 5: Rework `App.tsx` — imports, state, derived rows**

In `src/ui/App.tsx`:

Add the import (with the other `./` imports):

```ts
import { groupChecks, flattenRows, deriveExpanded, rowId, type Override } from "./checkGroups.js";
```

Replace the cursor state line

```ts
  const [checkCursor, setCheckCursor] = useState(0);
```

with:

```ts
  const [overrides, setOverrides] = useState<Map<string, Override>>(new Map());
  const [cursorId, setCursorId] = useState<string | null>(null);
```

Immediately after the existing `const checks: Check[] = ...` line, add the per-render derivation:

```ts
  const groups = groupChecks(checks);
  const expanded = deriveExpanded(groups, overrides);
  const rows = flattenRows(groups, expanded);
  const foundCursor = rows.findIndex((r) => rowId(r) === cursorId);
  const cursorIndex = foundCursor >= 0 ? foundCursor : 0;
```

Add an effect (next to the existing effects, after the `setMessage(state.error)` one) to reset per-PR view state on selection change:

```ts
  useEffect(() => { setOverrides(new Map()); setCursorId(null); }, [state.selectedPr]);
```

- [ ] **Step 6: Rework `App.tsx` — the `o` handler**

Replace the current `o` handler (the non-analysis one, ~lines 102-106):

```ts
    if (input === "o") {
      const url = focus === "detail" ? checks[checkCursor]?.detailsUrl ?? selectedPr?.url : selectedPr?.url;
      if (url) void openUrl(url).catch((e) => setMessage(errorMessage(e)));
      return;
    }
```

with:

```ts
    if (input === "o") {
      let url: string | undefined = selectedPr?.url;
      if (focus === "detail") {
        const row = rows[cursorIndex];
        if (row?.kind === "check") url = row.check.detailsUrl ?? selectedPr?.url;
      }
      if (url) void openUrl(url).catch((e) => setMessage(errorMessage(e)));
      return;
    }
```

- [ ] **Step 7: Rework `App.tsx` — movement and Enter**

Replace the movement/return block (~lines 114-124):

```ts
    const up = key.upArrow || input === "k";
    const down = key.downArrow || input === "j";
    if (focus === "list" && (up || down)) {
      const idx = prs.findIndex((p) => p.number === state.selectedPr);
      const next = Math.min(prs.length - 1, Math.max(0, idx + (down ? 1 : -1)));
      if (prs[next]) { store.selectPr(prs[next].number); setCheckCursor(0); }
    } else if (focus === "detail" && (up || down)) {
      setCheckCursor((c) => Math.min(checks.length - 1, Math.max(0, c + (down ? 1 : -1))));
    } else if (key.return && focus === "detail") {
      void analyze();
    }
```

with:

```ts
    const up = key.upArrow || input === "k";
    const down = key.downArrow || input === "j";
    if (focus === "list" && (up || down)) {
      const idx = prs.findIndex((p) => p.number === state.selectedPr);
      const next = Math.min(prs.length - 1, Math.max(0, idx + (down ? 1 : -1)));
      if (prs[next]) store.selectPr(prs[next].number); // overrides/cursor reset via the selectedPr effect
    } else if (focus === "detail" && (up || down)) {
      const next = Math.min(rows.length - 1, Math.max(0, cursorIndex + (down ? 1 : -1)));
      const row = rows[next];
      if (row) setCursorId(rowId(row));
    } else if (key.return && focus === "detail") {
      const row = rows[cursorIndex];
      if (!row) return;
      if (row.kind === "header") {
        const gkey = row.group.key;
        const isOpen = expanded.has(gkey);
        setOverrides((prev) => { const n = new Map(prev); n.set(gkey, isOpen ? "collapsed" : "expanded"); return n; });
      } else {
        void analyze();
      }
    }
```

- [ ] **Step 8: Rework `App.tsx` — `analyze()` and the Detail render**

Change the head of `analyze()` from:

```ts
  async function analyze() {
    const check = checks[checkCursor];
    if (!check) return;
```

to:

```ts
  async function analyze() {
    const row = rows[cursorIndex];
    if (!row || row.kind !== "check") return;
    const check = row.check;
```

Change the `<Detail .../>` element from:

```tsx
      <Detail pr={selectedPr} checks={checks} checkCursor={checkCursor} focused={focus === "detail"} theme={theme} width={size.columns} visibleRows={layout.checksVisible} />
```

to:

```tsx
      <Detail pr={selectedPr} rows={rows} cursor={cursorIndex} focused={focus === "detail"} theme={theme} width={size.columns} visibleRows={layout.checksVisible} />
```

- [ ] **Step 9: Update the App tests**

In `src/ui/App.test.tsx`:

(a) Give the shared fixture a workflow name and a check-run id — replace line 11:

```ts
const checks: Check[] = [{ name: "test", status: "completed", conclusion: "failure", detailsUrl: null, startedAt: null, completedAt: null, checkRunId: 1, checkSuiteId: 1, workflowRunId: 1, isStatusContext: false, workflowName: "CI" }];
```

(b) The failing group auto-expands, so the child `test` row sits **below** its header. In each analyze test, move the cursor onto the child before pressing Enter. In these four tests — "↵ opens the analysis pop-up…", "scrolling reaches the last line…", "analysis pop-up survives a checks reload…", "an LLM resolve from a closed pane…" — insert a down-move right after the `stdin.write("\t")` focus line:

```ts
  stdin.write("\t"); await sleep(5);            // focus → detail (cursor on the group header)
  stdin.write("j"); await sleep(5);             // move onto the check row
```

(c) Add a check-builder helper near the top (after line 11):

```ts
const mkc = (o: Partial<Check>): Check => ({ name: "c", status: "completed", conclusion: "success", detailsUrl: null, startedAt: null, completedAt: null, checkRunId: null, checkSuiteId: null, workflowRunId: null, isStatusContext: false, workflowName: null, ...o });
```

(d) Append these grouping tests:

```ts
test("Enter on a group header collapses and expands its checks", async () => {
  const store = mkStore();
  await store.refreshNow(); store.selectPr(142); await store.refreshNow();
  const { lastFrame, stdin } = render(<App store={store} theme={getTheme("mocha")} target={target} onRerun={vi.fn()} onAnalyze={vi.fn()} openUrl={vi.fn()} llmEnabled={false} />);
  stdin.setRawMode(); stdin.resume(); await sleep(0);
  stdin.write("\t"); await sleep(5);            // focus → detail (cursor on the "CI" header)
  expect(lastFrame()).toContain("test");         // failing group auto-expanded
  stdin.write("\r"); await sleep(5);             // Enter on header → collapse
  expect(lastFrame()).not.toContain("test");
  stdin.write("\r"); await sleep(5);             // Enter again → expand
  expect(lastFrame()).toContain("test");
});

test("the selection stays on its check when a poll inserts a group above it", async () => {
  let current: Check[] = [mkc({ name: "zeta-job", workflowRunId: 9, workflowName: "Zeta", conclusion: "failure", checkRunId: 90 })];
  const store = createStore({ loadPrs: vi.fn().mockResolvedValue({ prs, checks: {} }), loadChecks: vi.fn().mockImplementation(() => Promise.resolve(current)), timer: noTimer, listMs: 1, checksMs: 1 });
  await store.refreshNow(); store.selectPr(142); await store.refreshNow();
  const { lastFrame, stdin } = render(<App store={store} theme={getTheme("mocha")} target={target} onRerun={vi.fn()} onAnalyze={vi.fn()} openUrl={vi.fn()} llmEnabled={false} />);
  stdin.setRawMode(); stdin.resume(); await sleep(0);
  stdin.write("\t"); await sleep(5);            // focus → detail (cursor on the "Zeta" header)
  stdin.write("j"); await sleep(5);             // move onto zeta-job
  expect(lastFrame()).toMatch(/❯ .*zeta-job/);
  current = [mkc({ name: "alpha-job", workflowRunId: 1, workflowName: "Alpha", conclusion: "failure", checkRunId: 10 }), ...current];
  await store.refreshNow(); await sleep(5);      // a poll adds "Alpha", which sorts ABOVE "Zeta"
  expect(lastFrame()).toMatch(/❯ .*zeta-job/);   // cursor still on the same check, not drifted onto Alpha
});

test("↑/↓ traverse group headers and their children", async () => {
  const multi: Check[] = [
    mkc({ name: "a-build", workflowRunId: 1, workflowName: "Alpha", conclusion: "failure", checkRunId: 1 }),
    mkc({ name: "a-test", workflowRunId: 1, workflowName: "Alpha", conclusion: "failure", checkRunId: 2 }),
    mkc({ name: "b-build", workflowRunId: 2, workflowName: "Beta", conclusion: "failure", checkRunId: 3 }),
  ];
  const store = createStore({ loadPrs: vi.fn().mockResolvedValue({ prs, checks: {} }), loadChecks: vi.fn().mockResolvedValue(multi), timer: noTimer, listMs: 1, checksMs: 1 });
  await store.refreshNow(); store.selectPr(142); await store.refreshNow();
  const { lastFrame, stdin } = render(<App store={store} theme={getTheme("mocha")} target={target} onRerun={vi.fn()} onAnalyze={vi.fn()} openUrl={vi.fn()} llmEnabled={false} />);
  stdin.setRawMode(); stdin.resume(); await sleep(0);
  // both groups failing → both auto-expanded. rows: [Alpha, a-build, a-test, Beta, b-build]
  stdin.write("\t"); await sleep(5);            // focus → detail (cursor on the "Alpha" header)
  stdin.write("j"); await sleep(5);
  expect(lastFrame()).toMatch(/❯ .*a-build/);
  stdin.write("j"); await sleep(5);
  expect(lastFrame()).toMatch(/❯ .*a-test/);
  stdin.write("j"); await sleep(5);
  expect(lastFrame()).toMatch(/❯ .*Beta/);       // stepped from a child into the next header
});

test("switching PRs resets expansion overrides", async () => {
  const prs2: PullRequest[] = [
    { number: 142, title: "First", url: "u", isCrossRepository: false, mergeable: "MERGEABLE", headRefName: "a", baseRefName: "main", headSha: "s" },
    { number: 143, title: "Second", url: "u", isCrossRepository: false, mergeable: "MERGEABLE", headRefName: "b", baseRefName: "main", headSha: "s" },
  ];
  const byPr: Record<number, Check[]> = {
    142: [mkc({ name: "one", workflowRunId: 1, workflowName: "CI", conclusion: "failure", checkRunId: 1 })],
    143: [mkc({ name: "two", workflowRunId: 2, workflowName: "CD", conclusion: "failure", checkRunId: 2 })],
  };
  const store = createStore({ loadPrs: vi.fn().mockResolvedValue({ prs: prs2, checks: {} }), loadChecks: vi.fn().mockImplementation((pr: number) => Promise.resolve(byPr[pr] ?? [])), timer: noTimer, listMs: 1, checksMs: 1 });
  await store.refreshNow(); store.selectPr(142); await store.refreshNow();
  const { lastFrame, stdin } = render(<App store={store} theme={getTheme("mocha")} target={target} onRerun={vi.fn()} onAnalyze={vi.fn()} openUrl={vi.fn()} llmEnabled={false} />);
  stdin.setRawMode(); stdin.resume(); await sleep(0);
  stdin.write("\t"); await sleep(5);            // focus → detail (cursor on CI header, expanded)
  expect(lastFrame()).toContain("one");
  stdin.write("\r"); await sleep(5);            // collapse CI on PR 142 (sets a "collapsed" override)
  expect(lastFrame()).not.toContain("one");
  stdin.write("\t"); await sleep(5);            // focus → list
  stdin.write("j"); await sleep(5);             // select PR 143
  await store.refreshNow(); await sleep(5);
  expect(lastFrame()).toContain("two");         // PR 143's failing group is expanded — overrides were reset
});

test("Enter and o stay safe when a poll empties the rows under the cursor", async () => {
  let current: Check[] = [
    mkc({ name: "j1", workflowRunId: 1, workflowName: "W", conclusion: "failure", checkRunId: 1 }),
    mkc({ name: "j2", workflowRunId: 1, workflowName: "W", conclusion: "failure", checkRunId: 2 }),
  ];
  const openUrl = vi.fn();
  const store = createStore({ loadPrs: vi.fn().mockResolvedValue({ prs, checks: {} }), loadChecks: vi.fn().mockImplementation(() => Promise.resolve(current)), timer: noTimer, listMs: 1, checksMs: 1 });
  await store.refreshNow(); store.selectPr(142); await store.refreshNow();
  const { lastFrame, stdin } = render(<App store={store} theme={getTheme("mocha")} target={target} onRerun={vi.fn()} onAnalyze={vi.fn()} openUrl={openUrl} llmEnabled={false} />);
  stdin.setRawMode(); stdin.resume(); await sleep(0);
  stdin.write("\t"); await sleep(5);            // focus → detail (cursor on the "W" header)
  stdin.write("j"); await sleep(5); stdin.write("j"); await sleep(5); // onto j2 (last row)
  expect(lastFrame()).toMatch(/❯ .*j2/);
  current = [];                                  // a poll returns no checks → rows becomes empty
  await store.refreshNow(); await sleep(5);
  stdin.write("\r"); await sleep(5);             // Enter with the cursor index now past the end
  stdin.write("o"); await sleep(5);              // and o
  expect(lastFrame()).toContain("#142");         // still rendering — neither handler threw
});
```

- [ ] **Step 10: Run the UI tests and typecheck**

Run: `pnpm vitest run src/ui/Detail.test.tsx src/ui/App.test.tsx && pnpm typecheck`
Expected: PASS. If a test times out on escape handling, keep the existing `await sleep(30)` used by the original tests.

- [ ] **Step 11: Run the whole suite**

Run: `pnpm test`
Expected: PASS (all files).

- [ ] **Step 12: Commit**

```bash
git add src/ui/Detail.tsx src/ui/Detail.test.tsx src/ui/App.tsx src/ui/App.test.tsx
git commit -m "feat: group the checks pane by workflow with collapsible headers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Manual verification (after Task 3)

Run against a repo whose PRs use multiple workflows: `pnpm dev`. Confirm:
- Each workflow shows as one header with its name and `✓ ✗ •` counts; a failing group is expanded on load, green/running groups are collapsed.
- ↑/↓ walk headers and (when expanded) children; Enter on a header toggles it; Enter on a check opens the analysis pop-up.
- `o` on a check opens its details URL; `o` on a header opens the PR.
- While a group's checks poll, collapsing a still-failing group keeps it collapsed; a group that goes green collapses on its own.

**Known limitation (accepted):** windowing reuses `windowRows` over the flattened `Row[]`, so when the visible window starts mid-group its first child rows render without their header in view. Cosmetic, only on overflow, and inherent to the single-list windowing model; not worth a bespoke group-aware windower for v1.

---

## Self-Review (completed by plan author)

- **Spec coverage:** data field (Task 1) ✓; group-by-runId + title + ordering + status incl. skip (Task 2) ✓; `deriveExpanded` derived-with-overrides (Task 2) ✓; `flattenRows` + `rowId` (Task 2) ✓; header/child rendering with `win.offset+i` selection + kind-prefixed keys (Task 3) ✓; cursor-by-identity, Enter toggle/analyze, `o` fallback, overrides reset on PR change (Task 3) ✓; tests for collision, Other-last, skip, derive, poll-stability, header toggle, **↑/↓ traversal, PR-switch override reset, stale-cursor safety** (Tasks 2-3) ✓; no `layout.ts` change ✓.
- **Placeholder scan:** none — every step carries real code/commands.
- **Type consistency:** `Override`, `Row`, `CheckGroup`, `GroupStatus`, `groupChecks/flattenRows/deriveExpanded/rowId/groupGlyph/groupColor` names match across Tasks 2-3; `Detail` props `rows`/`cursor` are consistent between the rewrite and the App call site.
