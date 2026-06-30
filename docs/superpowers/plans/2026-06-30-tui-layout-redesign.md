# Greenlight TUI Layout Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed-size side-by-side layout with a full-terminal-height vertical stack (PR list over checks), readable full-width PR titles, explicit overflow indicators, and a pop-up analysis pane.

**Architecture:** A new pure `computeLayout` function turns the measured terminal size into per-region visible-row counts; a `useTerminalSize` hook supplies that size. `App.tsx` renders a `flexDirection="column"` stack of `PrList`, the checks `Detail`, and (only while analyzing) a new `AnalysisPane`. Input routing for the pop-up stays centralized in `App`'s top-level `useInput` handler via an early-return guard — exactly how the existing Help/Confirm "overlays" work.

**Tech Stack:** TypeScript (ESM + NodeNext), React 19, Ink, ink-spinner, ink-testing-library, vitest.

## Global Constraints

- **Node ≥ 22.**
- **ESM + NodeNext:** every relative import MUST carry an explicit `.js` extension (even from `.ts`/`.tsx`).
- **No hard-coded colors:** all hues come from the `Theme` tokens in `src/theme.ts`. Never write a hex/ANSI color in a component.
- **Tests are colocated** (`src/**/*.test.ts[x]`), run with `pnpm vitest run <file>`.
- **Ink has no scroll container and no z-index/overlay:** all scrolling is manual windowing; "modals/pop-ups" are focus-trapped views driven by early-returns in `App`'s handler, not layered components and not per-component `useInput`.
- Commands: `pnpm vitest run <file>` (single), `pnpm test` (full), `pnpm typecheck`.

---

### Task 1: `windowRows` reports overflow counts

**Files:**
- Modify: `src/format.ts:33-37`
- Test: `src/format.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `windowRows<T>(items: T[], cursor: number, height: number): { rows: T[]; offset: number; above: number; below: number }` — `above` = items hidden before the window, `below` = items hidden after. Existing callers destructure only `{ rows, offset }` and keep working.

- [ ] **Step 1: Add the failing test**

Add to `src/format.test.ts`:

```ts
test("windowRows reports hidden counts above and below", () => {
  const items = Array.from({ length: 20 }, (_, i) => i);
  const { rows, above, below } = windowRows(items, 15, 5);
  expect(rows).toHaveLength(5);
  expect(above).toBeGreaterThan(0);
  expect(below).toBeGreaterThanOrEqual(0);
  expect(above + rows.length + below).toBe(20);
});

test("windowRows reports zero overflow when everything fits", () => {
  const { above, below } = windowRows([1, 2, 3], 0, 5);
  expect(above).toBe(0);
  expect(below).toBe(0);
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm vitest run src/format.test.ts -t "hidden counts"`
Expected: FAIL — `above`/`below` are `undefined`.

- [ ] **Step 3: Implement**

Replace `src/format.ts:33-37` with:

```ts
export function windowRows<T>(items: T[], cursor: number, height: number): { rows: T[]; offset: number; above: number; below: number } {
  if (items.length <= height) return { rows: items, offset: 0, above: 0, below: 0 };
  const offset = Math.min(Math.max(0, cursor - Math.floor(height / 2)), items.length - height);
  return { rows: items.slice(offset, offset + height), offset, above: offset, below: items.length - (offset + height) };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm vitest run src/format.test.ts`
Expected: PASS (all, including the pre-existing `windowRows keeps cursor visible`).

- [ ] **Step 5: Commit**

```bash
git add src/format.ts src/format.test.ts
git commit -m "feat(format): windowRows reports hidden-row counts"
```

---

### Task 2: `computeLayout` pure layout function

**Files:**
- Create: `src/ui/layout.ts`
- Test: `src/ui/layout.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `computeLayout(input: LayoutInput): LayoutResult`
  - `interface LayoutInput { totalRows: number; prCount: number; analysisOpen: boolean; analysisBodyRows: number }`
  - `interface LayoutResult { prVisible: number; checksVisible: number; analysisVisible: number }`
  - Exported constants: `STATUS_ROWS=1`, `PR_CHROME=3`, `CHECKS_CHROME=5`, `ANALYSIS_CHROME=4`, `PR_CAP=8`, `ANALYSIS_MIN_BODY=6`, `ANALYSIS_MAX_BODY=14`, `CHECKS_MIN_BODY=3`.
  - `prVisible`/`checksVisible`/`analysisVisible` are **item/body row counts** (windowing heights), NOT box heights. `analysisVisible` is `0` when `analysisOpen` is false. Each region's on-screen height is `chrome + visible`; chrome is: PR list `PR_CHROME` (border 2 + "PRs" header 1), checks `CHECKS_CHROME` (border 2 + title + branch + divider), analysis `ANALYSIS_CHROME` (border 2 + title line 1 + hint footer 1).

- [ ] **Step 1: Write the failing test**

Create `src/ui/layout.test.ts`:

```ts
import { expect, test } from "vitest";
import { computeLayout, PR_CAP, ANALYSIS_MIN_BODY } from "./layout.js";

test("fills height: regions sum within the terminal", () => {
  const r = computeLayout({ totalRows: 40, prCount: 3, analysisOpen: false, analysisBodyRows: 1 });
  // status(1) + prChrome(3)+prVisible + checksChrome(5)+checksVisible
  const used = 1 + 3 + r.prVisible + 5 + r.checksVisible;
  expect(used).toBeLessThanOrEqual(40);
  expect(r.prVisible).toBe(3);
  expect(r.analysisVisible).toBe(0);
  expect(r.checksVisible).toBeGreaterThan(10); // checks gets the lion's share
});

test("PR list is capped and auto-sized", () => {
  expect(computeLayout({ totalRows: 50, prCount: 1, analysisOpen: false, analysisBodyRows: 1 }).prVisible).toBe(1);
  expect(computeLayout({ totalRows: 50, prCount: 99, analysisOpen: false, analysisBodyRows: 1 }).prVisible).toBe(PR_CAP);
  expect(computeLayout({ totalRows: 50, prCount: 0, analysisOpen: false, analysisBodyRows: 1 }).prVisible).toBe(1);
});

test("opening analysis shrinks checks, not the PR list", () => {
  const closed = computeLayout({ totalRows: 40, prCount: 3, analysisOpen: false, analysisBodyRows: 8 });
  const open = computeLayout({ totalRows: 40, prCount: 3, analysisOpen: true, analysisBodyRows: 8 });
  expect(open.analysisVisible).toBe(8);
  expect(open.prVisible).toBe(closed.prVisible);
  expect(open.checksVisible).toBeLessThan(closed.checksVisible);
});

test("analysis body is clamped to its min and max", () => {
  expect(computeLayout({ totalRows: 60, prCount: 2, analysisOpen: true, analysisBodyRows: 1 }).analysisVisible).toBe(ANALYSIS_MIN_BODY);
  expect(computeLayout({ totalRows: 60, prCount: 2, analysisOpen: true, analysisBodyRows: 100 }).analysisVisible).toBe(14);
});

test("short terminal shrinks the PR list below its cap before clipping checks", () => {
  const r = computeLayout({ totalRows: 18, prCount: 8, analysisOpen: true, analysisBodyRows: 8 });
  expect(r.prVisible).toBeLessThan(PR_CAP);   // PR list yielded space
  expect(r.checksVisible).toBeGreaterThanOrEqual(1);
});

test("tiny terminal degrades gracefully: checks last, analysis never empty, all >= 1", () => {
  // At 16 rows with the pop-up open the minimal feasible sum (17) exceeds the height,
  // so checks cannot reach its floor of 3 — it lands at >= 1 after everything else yields.
  const r = computeLayout({ totalRows: 16, prCount: 5, analysisOpen: true, analysisBodyRows: 10 });
  expect(r.checksVisible).toBeGreaterThanOrEqual(1);
  expect(r.prVisible).toBe(1);                 // PR list borrowed down to 1
  expect(r.analysisVisible).toBeGreaterThanOrEqual(1); // pop-up never empty
  expect(r.analysisVisible).toBeLessThan(ANALYSIS_MIN_BODY); // squeezed below its body-min
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm vitest run src/ui/layout.test.ts`
Expected: FAIL — cannot find module `./layout.js`.

- [ ] **Step 3: Implement**

Create `src/ui/layout.ts`:

```ts
export const STATUS_ROWS = 1;
export const PR_CHROME = 3;        // border(2) + "PRs" header(1)
export const CHECKS_CHROME = 5;    // border(2) + title + branch + divider
export const ANALYSIS_CHROME = 4;  // border(2) + title line(1) + hint footer(1)
export const PR_CAP = 8;
export const ANALYSIS_MIN_BODY = 6;
export const ANALYSIS_MAX_BODY = 14;
export const CHECKS_MIN_BODY = 3;
const ANALYSIS_FLOOR = 1;          // never render the pop-up with an empty body
const MIN_TOTAL = 8;

export interface LayoutInput { totalRows: number; prCount: number; analysisOpen: boolean; analysisBodyRows: number; }
export interface LayoutResult { prVisible: number; checksVisible: number; analysisVisible: number; }

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function computeLayout(input: LayoutInput): LayoutResult {
  const { totalRows, prCount, analysisOpen, analysisBodyRows } = input;
  const avail = Math.max(MIN_TOTAL, totalRows) - STATUS_ROWS;

  let prVisible = Math.max(1, Math.min(prCount === 0 ? 1 : prCount, PR_CAP));
  let analysisVisible = analysisOpen ? clamp(analysisBodyRows, ANALYSIS_MIN_BODY, ANALYSIS_MAX_BODY) : 0;

  const checks = () => avail - (PR_CHROME + prVisible) - (analysisOpen ? ANALYSIS_CHROME + analysisVisible : 0) - CHECKS_CHROME;

  // Checks keeps priority: it is reduced last (only by the final max(1, …) clamp).
  // Borrow from everything else first, in order — analysis to its body-min, then the
  // PR list to 1, then analysis to its hard floor of 1 (never empty). Below ~20 rows
  // with the pop-up open the minimal feasible sum exceeds the height, so not all
  // minimums can hold; checks then lands at >=1 rather than its preferred floor.
  while (checks() < CHECKS_MIN_BODY && analysisVisible > ANALYSIS_MIN_BODY) analysisVisible--;
  while (checks() < CHECKS_MIN_BODY && prVisible > 1) prVisible--;
  while (checks() < CHECKS_MIN_BODY && analysisVisible > ANALYSIS_FLOOR) analysisVisible--;

  return { prVisible, checksVisible: Math.max(1, checks()), analysisVisible };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm vitest run src/ui/layout.test.ts`
Expected: PASS (all five).

- [ ] **Step 5: Commit**

```bash
git add src/ui/layout.ts src/ui/layout.test.ts
git commit -m "feat(ui): add computeLayout height-budget function"
```

---

### Task 3: `useTerminalSize` hook

**Files:**
- Create: `src/ui/useTerminalSize.ts`
- Test: `src/ui/useTerminalSize.test.tsx`

**Interfaces:**
- Consumes: Ink's `useStdout()`.
- Produces: `useTerminalSize(): { rows: number; columns: number }` — seeds from `stdout` in a layout effect (so the first painted frame is correct, no fallback flash) and updates on the stdout `resize` event. Falls back to `{ rows: 24, columns: 80 }` when the TTY reports `undefined`.

- [ ] **Step 1: Write the failing test**

Create `src/ui/useTerminalSize.test.tsx`. Note: `useStdout` reads from React context, so the hook is exercised through `ink-testing-library`'s `render`; its returned `stdout` is an `EventEmitter` that emits `"resize"`. IMPORTANT: in `ink-testing-library@4`, `stdout.columns` is a **getter on the prototype** (fixed at 100) and there is no `rows` property — so you CANNOT assign `stdout.columns = …` (it throws `TypeError: Cannot set property columns ... which has only a getter`). Shadow both with per-instance own properties via `Object.defineProperty`, then emit `"resize"`. A microtask tick lets Ink flush the re-render before asserting.

```tsx
import { render } from "ink-testing-library";
import { expect, test } from "vitest";
import React from "react";
import { Text } from "ink";
import { useTerminalSize } from "./useTerminalSize.js";

function Probe() {
  const { rows, columns } = useTerminalSize();
  return <Text>{`${columns}x${rows}`}</Text>;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test("reports fallback rows then updates on resize", async () => {
  const { lastFrame, stdout } = render(<Probe />);
  // ink-testing-library's fake stdout has columns=100 (getter) and no `rows`,
  // so the hook falls back to rows: 24.
  expect(lastFrame()).toMatch(/x24$/);
  // columns is a getter-only prototype prop and rows is absent; shadow both with
  // own data properties so the hook reads the new size on the next resize.
  Object.defineProperty(stdout, "columns", { value: 120, configurable: true });
  Object.defineProperty(stdout, "rows", { value: 40, configurable: true });
  stdout.emit("resize");
  await tick();
  expect(lastFrame()).toBe("120x40");
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm vitest run src/ui/useTerminalSize.test.tsx`
Expected: FAIL — cannot find module `./useTerminalSize.js`.

- [ ] **Step 3: Implement**

Create `src/ui/useTerminalSize.ts`:

```ts
import { useLayoutEffect, useState } from "react";
import { useStdout } from "ink";

export interface TerminalSize { rows: number; columns: number; }

export function useTerminalSize(): TerminalSize {
  const { stdout } = useStdout();
  const read = (): TerminalSize => ({ rows: stdout?.rows ?? 24, columns: stdout?.columns ?? 80 });
  const [size, setSize] = useState<TerminalSize>(read);

  // Seed from the real stdout after first render (avoids a one-frame fallback flash),
  // then track resizes. useStdout exposes the raw TTY size; treat it as the ceiling.
  useLayoutEffect(() => {
    setSize(read());
    if (!stdout) return;
    const onResize = () => setSize(read());
    stdout.on("resize", onResize);
    return () => { stdout.off("resize", onResize); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stdout]);

  return size;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm vitest run src/ui/useTerminalSize.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/useTerminalSize.ts src/ui/useTerminalSize.test.tsx
git commit -m "feat(ui): add useTerminalSize hook"
```

---

### Task 4: `PrList` — full width, auto-size, overflow footer

**Files:**
- Modify: `src/ui/PrList.tsx` (whole file)
- Test: `src/ui/PrList.test.tsx`

**Interfaces:**
- Consumes: `windowRows` (Task 1).
- Produces: `PrList` prop shape changes from `{ ..., height: number }` to `{ prs, checks, selected, focused, theme, width: number, visibleRows: number, target }`. `width` is the terminal column count; `visibleRows` is the number of PR rows to show (from `computeLayout().prVisible`). Titles truncate to the measured width instead of a fixed 16.

- [ ] **Step 1: Update the tests**

Replace `src/ui/PrList.test.tsx` body of both `render(...)` calls to pass `width={80} visibleRows={6}` instead of `height={10}`, and add an overflow test:

```ts
import { render } from "ink-testing-library";
import { expect, test } from "vitest";
import React from "react";
import { PrList } from "./PrList.js";
import { getTheme } from "../theme.js";
import type { PullRequest, Check, RepoTarget } from "../types.js";

const target: RepoTarget = { owner: "acme", repo: "widget", viewerLogin: "me", viewerCanWrite: true };
const mkPr = (n: number, title: string): PullRequest => ({ number: n, title, url: "", isCrossRepository: false, headRefName: "a", baseRefName: "main", headSha: "s" });
const prs: PullRequest[] = [mkPr(142, "Fix auth flow")];
const checks: Record<number, Check[]> = { 142: [{ name: "test", status: "completed", conclusion: "failure", detailsUrl: null, startedAt: null, completedAt: null, checkRunId: null, checkSuiteId: null, workflowRunId: null, isStatusContext: false }] };

test("renders PR number, full title and a fail glyph", () => {
  const { lastFrame } = render(<PrList prs={prs} checks={checks} selected={142} focused theme={getTheme("mocha")} width={80} visibleRows={6} target={target} />);
  expect(lastFrame()).toContain("#142");
  expect(lastFrame()).toContain("Fix auth flow"); // full title, not truncated to 16
  expect(lastFrame()).toContain("✗");
});

test("shows a 'more' footer when PRs overflow the visible rows", () => {
  const many = Array.from({ length: 12 }, (_, i) => mkPr(100 + i, `PR ${i}`));
  const { lastFrame } = render(<PrList prs={many} checks={{}} selected={100} focused theme={getTheme("mocha")} width={80} visibleRows={4} target={target} />);
  expect(lastFrame()).toMatch(/more/);
});

test("empty state names the viewer and repo", () => {
  const { lastFrame } = render(<PrList prs={[]} checks={{}} selected={null} focused theme={getTheme("mocha")} width={80} visibleRows={1} target={target} />);
  expect(lastFrame()).toMatch(/No open PRs by @me in[\s\S]*acme\/widget/i);
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `pnpm vitest run src/ui/PrList.test.tsx`
Expected: FAIL — type error / `more` not found (still using `height`/fixed width).

- [ ] **Step 3: Implement**

Replace `src/ui/PrList.tsx` with:

```ts
import React from "react";
import { Box, Text } from "ink";
import type { PullRequest, Check, RepoTarget } from "../types.js";
import type { Theme } from "../theme.js";
import { checkCounts, glyph, glyphColor, truncate, windowRows } from "../format.js";

interface Props { prs: PullRequest[]; checks: Record<number, Check[]>; selected: number | null; focused: boolean; theme: Theme; width: number; visibleRows: number; target: RepoTarget; }

export function PrList({ prs, checks, selected, focused, theme, width, visibleRows, target }: Props) {
  const borderColor = focused ? theme.selection : theme.border;
  if (prs.length === 0) {
    return (
      <Box flexDirection="column" width={width} borderStyle="round" borderColor={borderColor} paddingX={1}>
        <Text color={theme.title}>PRs</Text>
        <Text color={theme.meta}>No open PRs by @{target.viewerLogin} in {target.owner}/{target.repo}.</Text>
      </Box>
    );
  }
  const cursor = Math.max(0, prs.findIndex((p) => p.number === selected));
  const overflow = prs.length > visibleRows;
  const win = windowRows(prs, cursor, overflow ? Math.max(1, visibleRows - 1) : visibleRows);
  // Title budget = full width minus fixed segments: prefix (4), "#1234 " (~7),
  // counts "✓0 ✗0 •0" (~10), border+padding (4) = 25. ASSUMPTION: PR numbers <= 9999
  // and modest check counts. The codebase has no width-measurement infra, so this is a
  // deliberate estimate; with very large numbers/counts a title could wrap. We accept
  // that edge case rather than measure rendered segment widths.
  const titleWidth = Math.max(8, width - 25);
  return (
    <Box flexDirection="column" width={width} borderStyle="round" borderColor={borderColor} paddingX={1}>
      <Text color={theme.title}>PRs</Text>
      {win.rows.map((pr) => {
        const isSel = pr.number === selected;
        const cs = checks[pr.number] ?? [];
        const top = cs.find((c) => glyph(c) === "✗") ?? cs.find((c) => glyph(c) === "•") ?? cs[0];
        const { pass, fail, pending } = checkCounts(cs);
        return (
          <Box key={pr.number}>
            <Text color={isSel ? theme.selection : undefined}>{isSel ? "❯ " : "  "}</Text>
            {top ? <Text color={glyphColor(top, theme)}>{glyph(top)} </Text> : <Text>  </Text>}
            <Text color={isSel ? theme.selection : undefined}>#{pr.number} </Text>
            <Text>{truncate(pr.title, titleWidth)} </Text>
            <Text color={theme.meta}>{`✓${pass} ✗${fail} •${pending}`}</Text>
          </Box>
        );
      })}
      {overflow ? <Text color={theme.meta}>{`${win.above > 0 ? `↑${win.above} ` : ""}↓${win.below} more`}</Text> : null}
    </Box>
  );
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm vitest run src/ui/PrList.test.tsx`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
git add src/ui/PrList.tsx src/ui/PrList.test.tsx
git commit -m "feat(ui): PrList fills width, auto-sizes, shows overflow"
```

---

### Task 5: `Detail` (checks pane) — full width, dynamic rows, overflow footer, width-aware divider

**Files:**
- Modify: `src/ui/Detail.tsx` (whole file)
- Test: `src/ui/Detail.test.tsx`

**Interfaces:**
- Consumes: `windowRows` (Task 1).
- Produces: `Detail` prop shape changes from `{ ..., height: number }` to `{ pr, checks, checkCursor, focused, theme, width: number, visibleRows: number }`. `visibleRows` = `computeLayout().checksVisible`. Divider and title both size to `width`.

- [ ] **Step 1: Update the tests**

Replace `src/ui/Detail.test.tsx` with:

```ts
import { render } from "ink-testing-library";
import { expect, test } from "vitest";
import React from "react";
import { Detail } from "./Detail.js";
import { getTheme } from "../theme.js";
import type { PullRequest, Check } from "../types.js";

const pr: PullRequest = { number: 142, title: "Fix auth flow", url: "", isCrossRepository: false, headRefName: "feat/auth", baseRefName: "main", headSha: "s" };
const mkCheck = (name: string, conclusion: Check["conclusion"]): Check => ({ name, status: "completed", conclusion, detailsUrl: null, startedAt: "2026-06-29T10:00:00Z", completedAt: "2026-06-29T10:01:12Z", checkRunId: 1, checkSuiteId: 1, workflowRunId: 1, isStatusContext: false });
const checks: Check[] = [mkCheck("build", "success"), mkCheck("test (unit)", "failure")];

test("renders header and checks with durations", () => {
  const { lastFrame } = render(<Detail pr={pr} checks={checks} checkCursor={1} focused theme={getTheme("mocha")} width={80} visibleRows={10} />);
  expect(lastFrame()).toContain("Fix auth flow");
  expect(lastFrame()).toContain("feat/auth");
  expect(lastFrame()).toContain("main");
  expect(lastFrame()).toContain("build");
  expect(lastFrame()).toContain("1m12s");
});

test("shows a 'more' footer when checks overflow", () => {
  const many = Array.from({ length: 30 }, (_, i) => mkCheck(`job-${i}`, "success"));
  const { lastFrame } = render(<Detail pr={pr} checks={many} checkCursor={0} focused theme={getTheme("mocha")} width={80} visibleRows={5} />);
  expect(lastFrame()).toMatch(/more/);
});

test("shows placeholder when no PR selected", () => {
  const { lastFrame } = render(<Detail pr={null} checks={[]} checkCursor={0} focused theme={getTheme("mocha")} width={80} visibleRows={10} />);
  expect(lastFrame()).toMatch(/Select a PR/i);
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `pnpm vitest run src/ui/Detail.test.tsx`
Expected: FAIL — type error on `width`/`visibleRows`, and no `more` footer.

- [ ] **Step 3: Implement**

Replace `src/ui/Detail.tsx` with:

```ts
import React from "react";
import { Box, Text } from "ink";
import type { PullRequest, Check } from "../types.js";
import type { Theme } from "../theme.js";
import { formatDuration, glyph, glyphColor, truncate, windowRows } from "../format.js";

interface Props { pr: PullRequest | null; checks: Check[]; checkCursor: number; focused: boolean; theme: Theme; width: number; visibleRows: number; }

export function Detail({ pr, checks, checkCursor, focused, theme, width, visibleRows }: Props) {
  const borderColor = focused ? theme.selection : theme.border;
  if (!pr) {
    return (
      <Box flexGrow={1} width={width} borderStyle="round" borderColor={borderColor} paddingX={1}>
        <Text color={theme.meta}>Select a PR to see its checks.</Text>
      </Box>
    );
  }
  const inner = Math.max(4, width - 4); // minus border(2) + paddingX(2)
  const overflow = checks.length > visibleRows;
  const win = windowRows(checks, checkCursor, overflow ? Math.max(1, visibleRows - 1) : visibleRows);
  return (
    <Box flexDirection="column" width={width} borderStyle="round" borderColor={borderColor} paddingX={1}>
      <Text color={theme.title}>#{pr.number} {truncate(pr.title, Math.max(8, inner - 8))}</Text>
      <Text color={theme.meta}>{pr.headRefName} → {pr.baseRefName}{pr.isCrossRepository ? " (fork)" : ""}</Text>
      <Text color={theme.border}>{"─".repeat(inner)}</Text>
      {win.rows.map((c, i) => {
        const isSel = checks.indexOf(c) === checkCursor;
        return (
          <Box key={c.name + i}>
            <Text color={glyphColor(c, theme)}>{glyph(c)} </Text>
            <Text color={isSel ? theme.selection : theme.checkName}>{truncate(c.name, 22).padEnd(22)} </Text>
            <Text color={theme.meta}>{formatDuration(c.startedAt, c.completedAt)}</Text>
          </Box>
        );
      })}
      {overflow ? <Text color={theme.meta}>{`${win.above > 0 ? `↑${win.above} ` : ""}↓${win.below} more`}</Text> : null}
    </Box>
  );
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm vitest run src/ui/Detail.test.tsx`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
git add src/ui/Detail.tsx src/ui/Detail.test.tsx
git commit -m "feat(ui): checks pane fills width, dynamic rows, overflow footer"
```

---

### Task 6: `AnalysisPane` pop-up component (replaces `Analysis.tsx`)

**Files:**
- Create: `src/ui/AnalysisPane.tsx`
- Create: `src/ui/AnalysisPane.test.tsx`
- Delete: `src/ui/Analysis.tsx`, `src/ui/Analysis.test.tsx`
- Test: `src/ui/AnalysisPane.test.tsx`

**Interfaces:**
- Consumes: `glyph`/`glyphColor` (`src/format.js`), `HeuristicResult`/`Check` types. (Does its own top-anchored slicing — does NOT use `windowRows`.)
- Produces: presentational `AnalysisPane` — **no `useInput`**. Prop shape:
  `{ check: Check; heuristic: HeuristicResult; llmText: string | null; llmLoading: boolean; llmError: string | null; theme: Theme; width: number; visibleRows: number; scroll: number }`. Renders a bordered box titled `⚑ analysis · <glyph> <check.name>`, a windowed body (verdict line, optional step, error lines, LLM spinner/text/error) scrolled by `scroll`, an overflow indicator when the body exceeds `visibleRows`, and a fixed hint footer `[a] ask LLM · [o] open · [esc] close`.

- [ ] **Step 1: Write the failing test**

Create `src/ui/AnalysisPane.test.tsx`:

```ts
import { render } from "ink-testing-library";
import { expect, test } from "vitest";
import React from "react";
import { AnalysisPane } from "./AnalysisPane.js";
import { getTheme } from "../theme.js";
import type { Check, HeuristicResult } from "../types.js";

const check: Check = { name: "test (e2e)", status: "completed", conclusion: "failure", detailsUrl: "u", startedAt: null, completedAt: null, checkRunId: 1, checkSuiteId: 1, workflowRunId: 1, isStatusContext: false };
const heuristic: HeuristicResult = { verdict: "likely_flaky", confidence: 0.72, failingStep: "Run e2e suite", errorLines: ["Error: ETIMEDOUT connect 30000ms"], signals: ["timeout"] };

test("renders verdict, error line, title and footer hints", () => {
  const { lastFrame } = render(<AnalysisPane check={check} heuristic={heuristic} llmText={null} llmLoading={false} llmError={null} theme={getTheme("mocha")} width={80} visibleRows={10} scroll={0} />);
  expect(lastFrame()).toMatch(/likely flaky/);
  expect(lastFrame()).toContain("test (e2e)");
  expect(lastFrame()).toContain("ETIMEDOUT");
  expect(lastFrame()).toMatch(/esc.*close/);
});

test("shows a 'more' indicator when the body overflows", () => {
  const big: HeuristicResult = { ...heuristic, errorLines: Array.from({ length: 20 }, (_, i) => `line ${i}`) };
  const { lastFrame } = render(<AnalysisPane check={check} heuristic={big} llmText={null} llmLoading={false} llmError={null} theme={getTheme("mocha")} width={80} visibleRows={4} scroll={0} />);
  expect(lastFrame()).toMatch(/more/);
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm vitest run src/ui/AnalysisPane.test.tsx`
Expected: FAIL — cannot find module `./AnalysisPane.js`.

- [ ] **Step 3: Implement and delete the old component**

Create `src/ui/AnalysisPane.tsx`:

```ts
import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import type { Check, HeuristicResult } from "../types.js";
import type { Theme } from "../theme.js";
import { glyph, glyphColor } from "../format.js";

interface Props { check: Check; heuristic: HeuristicResult; llmText: string | null; llmLoading: boolean; llmError: string | null; theme: Theme; width: number; visibleRows: number; scroll: number; }

const label = (v: HeuristicResult["verdict"]) => v === "likely_real" ? "likely real" : v === "likely_flaky" ? "likely flaky" : "unclear";

export function AnalysisPane({ check, heuristic, llmText, llmLoading, llmError, theme, width, visibleRows, scroll }: Props) {
  // INVARIANT: every entry pushed here renders as exactly ONE terminal row. The
  // overflow math and the height budget (ANALYSIS_CHROME + visibleRows) both rely
  // on lines.length === rendered rows. If you ever add a multi-line entry (e.g. a
  // wrapped LLM line), switch this to a measured row count instead of .length.
  const lines: React.ReactNode[] = [];
  lines.push(
    <Text key="v" wrap="truncate">
      <Text color={theme.flag}>⚑ {label(heuristic.verdict)}</Text>
      <Text color={theme.meta}> ({Math.round(heuristic.confidence * 100)}% · {heuristic.signals.join(", ") || "no signals"})</Text>
    </Text>,
  );
  if (heuristic.failingStep) lines.push(<Text key="s" color={theme.meta} wrap="truncate">step: {heuristic.failingStep}</Text>);
  heuristic.errorLines.forEach((l, i) => lines.push(<Text key={`e${i}`} color={theme.fail} wrap="truncate">{l}</Text>));
  if (llmLoading) lines.push(<Text key="ll" color={theme.checkName}><Spinner type="dots" /> analyzing…</Text>);
  if (llmText) llmText.split("\n").forEach((l, i) => lines.push(<Text key={`lt${i}`} color={theme.checkName} wrap="truncate">{l}</Text>));
  if (llmError) lines.push(<Text key="le" color={theme.error} wrap="truncate">{llmError}</Text>);

  // Top-anchored scroll (NOT windowRows, which centers a cursor — that would make the
  // first few down-presses move nothing until scroll passes half the height). `scroll`
  // is a row offset; App clamps it to [0, lines - visible].
  const overflow = lines.length > visibleRows;
  const shown = overflow ? Math.max(1, visibleRows - 1) : visibleRows;
  const start = Math.min(Math.max(0, scroll), Math.max(0, lines.length - shown));
  const body = lines.slice(start, start + shown);
  const above = start;
  const below = lines.length - (start + body.length);
  return (
    <Box flexDirection="column" width={width} borderStyle="round" borderColor={theme.flag} paddingX={1}>
      <Text color={theme.title} wrap="truncate">⚑ analysis · <Text color={glyphColor(check, theme)}>{glyph(check)}</Text> {check.name}</Text>
      {body}
      {overflow ? <Text color={theme.meta}>{`${above > 0 ? `↑${above} ` : ""}↓${below} more`}</Text> : null}
      <Text color={theme.meta}>[a] ask LLM · [o] open · [esc] close</Text>
    </Box>
  );
}
```

Then delete the superseded component and its test:

```bash
git rm src/ui/Analysis.tsx src/ui/Analysis.test.tsx
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm vitest run src/ui/AnalysisPane.test.tsx`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add src/ui/AnalysisPane.tsx src/ui/AnalysisPane.test.tsx
git commit -m "feat(ui): add AnalysisPane pop-up, remove inline Analysis"
```

---

### Task 7: Wire the vertical stack + pop-up into `App` and `cli`

**Files:**
- Modify: `src/ui/App.tsx` (whole file)
- Modify: `src/ui/StatusBar.tsx` (truncate so the status row can never wrap and break the budget)
- Modify: `src/cli.tsx:105-108` (add `llmEnabled` prop)
- Test: `src/ui/App.test.tsx`

**Interfaces:**
- Consumes: `useTerminalSize` (Task 3), `computeLayout` (Task 2), `PrList`/`Detail` new props (Tasks 4-5), `AnalysisPane` (Task 6).
- Produces: `App` gains a required prop `llmEnabled: boolean`. Layout is a `flexDirection="column"` stack. New state: `analysisOpen: boolean`, `analyzedCheckIndex: number | null`, `analysisScroll: number`. Input for the pop-up is handled inside a single top-level `useInput` guard (`if (analysisOpen) { … return; }`); the old standalone `a` handler (`App.tsx:105-111`) is removed.

- [ ] **Step 1: Update the App test**

Replace `src/ui/App.test.tsx` with (adds `llmEnabled`, and a test that `↵` opens the pop-up and `esc` closes it):

```ts
import { render } from "ink-testing-library";
import { expect, test, vi } from "vitest";
import React from "react";
import { App } from "./App.js";
import { createStore } from "../store.js";
import { getTheme } from "../theme.js";
import type { Check, PullRequest, RepoTarget } from "../types.js";

const target: RepoTarget = { owner: "acme", repo: "widget", viewerLogin: "me", viewerCanWrite: true };
const prs: PullRequest[] = [{ number: 142, title: "Fix auth flow", url: "u", isCrossRepository: false, headRefName: "a", baseRefName: "main", headSha: "s" }];
const checks: Check[] = [{ name: "test", status: "completed", conclusion: "failure", detailsUrl: null, startedAt: null, completedAt: null, checkRunId: 1, checkSuiteId: 1, workflowRunId: 1, isStatusContext: false }];
const noTimer = { setInterval: () => 0, clearInterval: () => {} };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mkStore() {
  return createStore({ loadPrs: vi.fn().mockResolvedValue(prs), loadChecks: vi.fn().mockResolvedValue(checks), timer: noTimer, listMs: 1, checksMs: 1 });
}
const heuristic = { verdict: "likely_flaky" as const, confidence: 0.7, failingStep: null, errorLines: ["boom"], signals: ["timeout"] };

test("renders both panes after data loads", async () => {
  const store = mkStore();
  await store.refreshNow(); store.selectPr(142); await store.refreshNow();
  const { lastFrame } = render(<App store={store} theme={getTheme("mocha")} target={target} onRerun={vi.fn()} onAnalyze={vi.fn()} openUrl={vi.fn()} llmEnabled={false} />);
  expect(lastFrame()).toContain("#142");
  expect(lastFrame()).toContain("test");
});

test("? toggles help overlay", async () => {
  const store = mkStore();
  await store.refreshNow(); store.selectPr(142); await store.refreshNow();
  const { lastFrame, stdin } = render(<App store={store} theme={getTheme("mocha")} target={target} onRerun={vi.fn()} onAnalyze={vi.fn()} openUrl={vi.fn()} llmEnabled={false} />);
  stdin.setRawMode(); stdin.resume(); await sleep(0);
  stdin.write("?"); await sleep(5);
  expect(lastFrame()).toMatch(/Keybindings/i);
});

test("↵ opens the analysis pop-up and esc closes it", async () => {
  const store = mkStore();
  await store.refreshNow(); store.selectPr(142); await store.refreshNow();
  const onAnalyze = vi.fn().mockResolvedValue({ heuristic, llm: () => Promise.resolve("llm says hi") });
  const { lastFrame, stdin } = render(<App store={store} theme={getTheme("mocha")} target={target} onRerun={vi.fn()} onAnalyze={onAnalyze} openUrl={vi.fn()} llmEnabled={false} />);
  stdin.setRawMode(); stdin.resume(); await sleep(0);
  stdin.write("\t"); await sleep(5);            // focus → detail
  stdin.write("\r"); await sleep(20);           // ↵ analyze
  expect(onAnalyze).toHaveBeenCalled();
  expect(lastFrame()).toMatch(/analysis/);
  expect(lastFrame()).toContain("boom");
  stdin.write("\u001B"); await sleep(5);        // esc closes
  expect(lastFrame()).not.toMatch(/\[esc\] close/);
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm vitest run src/ui/App.test.tsx`
Expected: FAIL — `llmEnabled` missing / pop-up not rendered.

- [ ] **Step 3: Implement the new App**

Replace `src/ui/App.tsx` with:

```ts
import React, { useEffect, useState, useSyncExternalStore } from "react";
import { Box, useApp, useInput } from "ink";
import type { Store } from "../store.js";
import type { Check, HeuristicResult, PullRequest, RepoTarget } from "../types.js";
import type { Theme } from "../theme.js";
import { errorMessage } from "../errors.js";
import { canRerun, failedRunIds } from "../github/rerun.js";
import { computeLayout } from "./layout.js";
import { useTerminalSize } from "./useTerminalSize.js";
import { PrList } from "./PrList.js";
import { Detail } from "./Detail.js";
import { AnalysisPane } from "./AnalysisPane.js";
import { ConfirmOverlay, HelpOverlay } from "./Overlay.js";
import { StatusBar } from "./StatusBar.js";

const HINTS = "↑↓ move · ⇥ pane · ↵ analyze · R rerun · r refresh · o open · ? help · q quit";

interface Props {
  store: Store; theme: Theme; target: RepoTarget; llmEnabled: boolean;
  onRerun: (prNumber: number, checks: Check[]) => Promise<{ rerun: number[] }>;
  onAnalyze: (check: Check) => Promise<{ heuristic: HeuristicResult; llm: () => Promise<string> }>;
  openUrl: (url: string) => Promise<void>;
}

export function App({ store, theme, target, llmEnabled, onRerun, onAnalyze, openUrl }: Props) {
  const { exit } = useApp();
  const size = useTerminalSize();
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const [focus, setFocus] = useState<"list" | "detail">("list");
  const [checkCursor, setCheckCursor] = useState(0);
  const [overlay, setOverlay] = useState<null | "help" | "confirm">(null);
  const [message, setMessage] = useState<string | null>(null);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [analyzedCheckIndex, setAnalyzedCheckIndex] = useState<number | null>(null);
  const [analysisScroll, setAnalysisScroll] = useState(0);
  const [heuristic, setHeuristic] = useState<HeuristicResult | null>(null);
  const [llmText, setLlmText] = useState<string | null>(null);
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [runLlm, setRunLlm] = useState<null | (() => Promise<string>)>(null);

  const prs: PullRequest[] = state.prs;
  const selectedPr = prs.find((p) => p.number === state.selectedPr) ?? null;
  const checks: Check[] = state.selectedPr != null ? state.checks[state.selectedPr] ?? [] : [];
  const analyzedCheck = analyzedCheckIndex != null ? checks[analyzedCheckIndex] ?? null : null;

  useEffect(() => { if (state.selectedPr == null && prs[0]) store.selectPr(prs[0].number); }, [prs.length]);
  useEffect(() => { setMessage(state.error); }, [state.error]);

  const analysisBodyRows = heuristic
    ? 1 + (heuristic.failingStep ? 1 : 0) + heuristic.errorLines.length
      + (llmLoading ? 1 : 0) + (llmText ? llmText.split("\n").length : 0) + (llmError ? 1 : 0)
    : 1;
  const layout = computeLayout({ totalRows: size.rows, prCount: prs.length, analysisOpen, analysisBodyRows });

  function closeAnalysis() {
    setAnalysisOpen(false); setAnalyzedCheckIndex(null); setAnalysisScroll(0);
    setHeuristic(null); setLlmText(null); setLlmError(null); setRunLlm(null);
  }

  useInput((input, key) => {
    if (overlay === "confirm") {
      if (input === "y") { setOverlay(null); void doRerun(); }
      else if (input === "n" || key.escape) setOverlay(null);
      return;
    }
    if (overlay === "help") { if (input === "?" || key.escape) setOverlay(null); return; }

    // Pop-up focus trap: while analysis is open, it owns the keys. Centralized here
    // (Ink useInput is global; there is no per-component trap), mirroring help/confirm.
    if (analysisOpen) {
      if (key.escape) { closeAnalysis(); return; }
      if (input === "o") {
        const url = analyzedCheck?.detailsUrl ?? selectedPr?.url;
        if (url) void openUrl(url).catch((e) => setMessage(errorMessage(e)));
        return;
      }
      if (input === "a") {
        if (!llmEnabled) { setLlmError("LLM not configured"); return; }
        if (!runLlm) { setLlmError("nothing to analyze"); return; }
        setLlmLoading(true); setLlmError(null);
        runLlm().then((t) => setLlmText(t)).catch((e) => setLlmError(errorMessage(e))).finally(() => setLlmLoading(false));
        return;
      }
      if (key.upArrow || input === "k") { setAnalysisScroll((s) => Math.max(0, s - 1)); return; }
      if (key.downArrow || input === "j") { setAnalysisScroll((s) => Math.max(0, Math.min(analysisBodyRows - layout.analysisVisible, s + 1))); return; }
      return;
    }

    if (input === "q") { exit(); return; }
    if (input === "?") { setOverlay("help"); return; }
    if (key.tab || input === "h" || input === "l") { setFocus((f) => (f === "list" ? "detail" : "list")); return; }
    if (input === "r") { void store.refreshNow(); return; }
    if (input === "o") {
      const url = focus === "detail" ? checks[checkCursor]?.detailsUrl ?? selectedPr?.url : selectedPr?.url;
      if (url) void openUrl(url).catch((e) => setMessage(errorMessage(e)));
      return;
    }
    if (input === "R") {
      if (!target.viewerCanWrite) { setMessage(`no write access to ${target.owner}/${target.repo}`); return; }
      const gate = canRerun(checks);
      if (!gate.ok) { setMessage(gate.reason ?? "cannot rerun"); return; }
      setOverlay("confirm"); return;
    }

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
  });

  async function analyze() {
    const check = checks[checkCursor];
    if (!check) return;
    setLlmText(null); setLlmError(null); setAnalysisScroll(0);
    setAnalyzedCheckIndex(checkCursor); setAnalysisOpen(true);
    try {
      const { heuristic: h, llm } = await onAnalyze(check);
      setHeuristic(h); setRunLlm(() => llm);
    } catch (e) { setMessage(errorMessage(e)); closeAnalysis(); }
  }

  async function doRerun() {
    const prNumber = state.selectedPr;
    if (prNumber == null) return;
    try {
      setMessage("rerunning failed jobs…");
      const res = await onRerun(prNumber, checks);
      store.markRequeued(prNumber, res.rerun);
      setMessage(null);
    } catch (e) { setMessage(errorMessage(e)); }
  }

  if (overlay === "help") return <HelpOverlay theme={theme} />;
  if (overlay === "confirm") {
    const n = failedRunIds(checks).length;
    return <ConfirmOverlay message={`Rerun ${n} failed job(s)?`} theme={theme} />;
  }

  return (
    <Box flexDirection="column">
      <PrList prs={prs} checks={state.checks} selected={state.selectedPr} focused={focus === "list"} theme={theme} width={size.columns} visibleRows={layout.prVisible} target={target} />
      <Detail pr={selectedPr} checks={checks} checkCursor={checkCursor} focused={focus === "detail"} theme={theme} width={size.columns} visibleRows={layout.checksVisible} />
      {analysisOpen && analyzedCheck && heuristic ? (
        <AnalysisPane check={analyzedCheck} heuristic={heuristic} llmText={llmText} llmLoading={llmLoading} llmError={llmError} theme={theme} width={size.columns} visibleRows={layout.analysisVisible} scroll={analysisScroll} />
      ) : null}
      <StatusBar hints={HINTS} message={message} theme={theme} />
    </Box>
  );
}
```

- [ ] **Step 4: Thread `llmEnabled` from cli.tsx**

In `src/cli.tsx`, change the `render(<App ... />)` call (currently `cli.tsx:105-108`) to pass the new prop:

```tsx
    const { waitUntilExit } = render(
      <App store={store} theme={theme} target={target} llmEnabled={Boolean(config.llm.apiKey)} onRerun={onRerun} onAnalyze={onAnalyze} openUrl={openUrl} />,
      { alternateScreen: true, exitOnCtrlC: true },
    );
```

- [ ] **Step 5: Truncate the status bar so it stays one row**

The status bar is the last child, outside the `computeLayout` budget. A long error
`message` would wrap to two lines and push the layout past the terminal height. Ink's
`wrap="truncate"` clips to one line with no width math. Replace `src/ui/StatusBar.tsx` with:

```ts
import React from "react";
import { Box, Text } from "ink";
import type { Theme } from "../theme.js";

export function StatusBar({ hints, message, theme }: { hints: string; message: string | null; theme: Theme }) {
  return (
    <Box>
      {message
        ? <Text color={theme.error} wrap="truncate">{message}</Text>
        : <Text color={theme.meta} wrap="truncate">{hints}</Text>}
    </Box>
  );
}
```

- [ ] **Step 6: Run the affected tests, verify pass**

Run: `pnpm vitest run src/ui/App.test.tsx`
Expected: PASS (all three, including the pop-up open/close test).

- [ ] **Step 7: Full verification**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck clean; full vitest suite green. (If `cli.test.ts` references `App` props, it does not — it only tests `parseArgs`/`versionString`/`isMainModule`/`helpText` — so no change needed there.)

- [ ] **Step 8: Commit**

```bash
git add src/ui/App.tsx src/ui/StatusBar.tsx src/ui/App.test.tsx src/cli.tsx
git commit -m "feat(ui): vertical-stack layout with full-height panes and analysis pop-up"
```

---

## Self-Review notes (resolved)

- **Spec coverage:** full-height sizing → Tasks 2-3, 7; readable titles/full width → Tasks 4-5; overflow indicators → Tasks 1, 4, 5, 6; pop-up analysis pane → Task 6; centralized input + pinned `analyzedCheckIndex` + gated `a`/`o` → Task 7; `llmEnabled` from cli → Task 7; delete `Analysis.tsx` → Task 6; width-aware divider → Task 5; `useLayoutEffect` seed → Task 3; status bar fixed 1 row, truncated → `StatusBar.tsx` `wrap="truncate"` (Task 7), budget uses `STATUS_ROWS=1` (Task 2).
- **Magic numbers:** `PR_CAP=8`, `ANALYSIS_MIN_BODY=6`, `ANALYSIS_MAX_BODY=14`, `CHECKS_MIN_BODY=3` live in `layout.ts`; tune by eye after first run.
- **Chrome accounting (review fix):** `ANALYSIS_CHROME=4` = border(2) + title line(1) + hint footer(1). The title line is rendered *inside* the border and must be counted, or the analysis box overruns the budget by one row.
- **Short-terminal degradation (review fix):** checks is reduced strictly last; on a terminal below ~20 rows with the pop-up open, the minimal feasible sum exceeds the height, so not every minimum can hold. Order of yielding: analysis→body-min, PR list→1, analysis→hard-floor 1 (never empty); checks then lands at ≥1. The spec's "B keeps priority" is best-effort in this sense, not an absolute floor guarantee.
- **Analysis scroll (review fix):** `AnalysisPane` scrolls top-anchored via `slice(start, start+shown)`, NOT `windowRows` (which centers a cursor and would swallow the first few key-presses). App clamps `analysisScroll` to `[0, analysisBodyRows - analysisVisible]`.
- **Type consistency:** `windowRows` returns `{ rows, offset, above, below }` everywhere; `PrList`/`Detail` take `{ width, visibleRows }`; `AnalysisPane` takes `{ check, heuristic, …, scroll }` and does its own top-anchored slicing; `App` adds `llmEnabled: boolean`.
- **Open item to watch during build:** the column-budget assumes paddingX adds no vertical lines (correct in Ink) and that border = 2 vertical lines per box; if a region visually overflows by one row on a real terminal, adjust the relevant `*_CHROME` constant, not the components.
```
