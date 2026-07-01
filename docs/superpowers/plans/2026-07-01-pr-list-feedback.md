# PR-list Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show check counts for every PR on launch, mark the selected check in the Detail pane, and flag PRs that have merge conflicts.

**Architecture:** Extend the PR-list GraphQL query to carry each PR's check rollup and `mergeable` state, extract the rollup→`Check[]` mapper into a shared module so the list and detail paths map identically, and have the store merge list-derived checks for all PRs while protecting the selected PR and recently-requeued PRs from being clobbered. Two small presentational changes (Detail cursor arrow, conflict marker) round it out.

**Tech Stack:** TypeScript (ESM + NodeNext), React 19 + Ink, Octokit GraphQL, Vitest, ink-testing-library.

## Global Constraints

- **ESM + NodeNext:** every relative import carries an explicit `.js` extension (even from `.ts`/`.tsx`).
- **No hard-coded colors:** all hues come from `src/theme.ts` tokens via `getTheme(name)`.
- **Tests are colocated** (`src/**/*.test.ts[x]`); fixtures live in `test/fixtures/`.
- **Node ≥ 22.** Run tests with `pnpm vitest run <file>`; typecheck with `pnpm typecheck`.
- Spec: `docs/superpowers/specs/2026-07-01-pr-list-feedback-design.md`.

---

### Task 1: Detail check-cursor indicator (item 2)

Add a `❯ ` / `  ` prefix to each Detail check row, mirroring `PrList`, so the selected check is visually obvious. Presentational only.

**Files:**
- Modify: `src/ui/Detail.tsx` (the `win.rows.map(...)` block, ~lines 26-34)
- Test: `src/ui/Detail.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Add to `src/ui/Detail.test.tsx`:

```tsx
test("marks the selected check row with a cursor arrow", () => {
  const { lastFrame } = render(<Detail pr={pr} checks={checks} checkCursor={1} focused theme={getTheme("mocha")} width={80} visibleRows={10} />);
  expect(lastFrame()).toMatch(/❯ .*test \(unit\)/);      // arrow on the selected row
  expect((lastFrame()!.match(/❯/g) ?? []).length).toBe(1); // only the selected row
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/Detail.test.tsx -t "cursor arrow"`
Expected: FAIL (no `❯` in output).

- [ ] **Step 3: Add the arrow prefix**

In `src/ui/Detail.tsx`, inside the `win.rows.map((c, i) => { ... })` return, add a prefix `<Text>` as the first child of the `<Box>`, before the glyph `<Text>`:

```tsx
        return (
          <Box key={c.name + i}>
            <Text color={isSel ? theme.selection : undefined}>{isSel ? "❯ " : "  "}</Text>
            <Text color={glyphColor(c, theme)}>{glyph(c)} </Text>
            <Text color={isSel ? theme.selection : theme.checkName}>{truncate(c.name, 22).padEnd(22)} </Text>
            <Text color={theme.meta}>{formatDuration(c.startedAt, c.completedAt)}</Text>
          </Box>
        );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/ui/Detail.test.tsx`
Expected: PASS (all Detail tests, including the existing "renders header and checks with durations").

- [ ] **Step 5: Commit**

```bash
git add src/ui/Detail.tsx src/ui/Detail.test.tsx
git commit -m "feat(ui): mark selected check row with cursor arrow"
```

---

### Task 2: Extract shared rollup mapper (`rollup.ts`)

Pull the `statusCheckRollup` context → `Check[]` mapping out of `checks.ts` into a shared module so the PR-list query (Task 3) reuses the exact same mapping. Pure refactor — no behavior change.

**Files:**
- Create: `src/github/rollup.ts`
- Modify: `src/github/checks.ts` (remove the inline mapping, import from `rollup.ts`)
- Test: `src/github/rollup.test.ts` (new); `src/github/checks.test.ts` (unchanged, must still pass)

**Interfaces:**
- Produces:
  - `export type RollupContext = RollupCheckRun | RollupStatusContext` (the two `__typename` shapes).
  - `export interface RollupCheckRun { __typename: "CheckRun"; name: string; status: string; conclusion: string | null; detailsUrl: string | null; startedAt: string | null; completedAt: string | null; databaseId: number | null; checkSuite: { databaseId: number | null; workflowRun: { databaseId: number | null } | null } | null }`
  - `export interface RollupStatusContext { __typename: "StatusContext"; context: string; state: string; targetUrl: string | null; createdAt: string | null }`
  - `export function mapRollupContexts(nodes: RollupContext[]): Check[]`

- [ ] **Step 1: Write the failing test**

Create `src/github/rollup.test.ts`:

```ts
import { expect, test } from "vitest";
import { mapRollupContexts, type RollupContext } from "./rollup.js";

const nodes: RollupContext[] = [
  { __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "https://x/1", startedAt: "2026-06-29T10:00:00Z", completedAt: "2026-06-29T10:01:12Z", databaseId: 11, checkSuite: { databaseId: 91, workflowRun: { databaseId: 501 } } },
  { __typename: "CheckRun", name: "test (unit)", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: null, startedAt: null, completedAt: null, databaseId: 12, checkSuite: { databaseId: 91, workflowRun: { databaseId: 501 } } },
  { __typename: "StatusContext", context: "ci/legacy", state: "SUCCESS", targetUrl: "https://x/3", createdAt: "2026-06-29T10:00:00Z" },
];

test("maps check runs and legacy status contexts to Check[]", () => {
  const checks = mapRollupContexts(nodes);
  expect(checks).toHaveLength(3);
  const fail = checks.find((c) => c.name === "test (unit)")!;
  expect(fail.conclusion).toBe("failure");
  expect(fail.workflowRunId).toBe(501);
  expect(fail.checkRunId).toBe(12);
  expect(fail.isStatusContext).toBe(false);
  const legacy = checks.find((c) => c.name === "ci/legacy")!;
  expect(legacy.isStatusContext).toBe(true);
  expect(legacy.conclusion).toBe("success");
  expect(legacy.status).toBe("completed");
});

test("empty nodes yields no checks", () => {
  expect(mapRollupContexts([])).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/github/rollup.test.ts`
Expected: FAIL with "Cannot find module './rollup.js'".

- [ ] **Step 3: Create `src/github/rollup.ts`**

Move the mapping helpers and node types verbatim out of `checks.ts`:

```ts
import type { Check, CheckConclusion, CheckStatus } from "../types.js";

const mapStatus = (s: string): CheckStatus =>
  s === "COMPLETED" ? "completed" : s === "IN_PROGRESS" ? "in_progress" : "queued";
const mapConclusion = (c: string | null): CheckConclusion =>
  (c ? (c.toLowerCase() as CheckConclusion) : null);
// Legacy StatusContext.state: SUCCESS | FAILURE | ERROR | PENDING | EXPECTED
const mapStateStatus = (state: string): CheckStatus => (state === "PENDING" || state === "EXPECTED" ? "in_progress" : "completed");
const mapStateConclusion = (state: string): CheckConclusion =>
  state === "SUCCESS" ? "success" : state === "PENDING" || state === "EXPECTED" ? null : "failure";

export interface RollupCheckRun {
  __typename: "CheckRun";
  name: string;
  status: string;
  conclusion: string | null;
  detailsUrl: string | null;
  startedAt: string | null;
  completedAt: string | null;
  databaseId: number | null;
  checkSuite: { databaseId: number | null; workflowRun: { databaseId: number | null } | null } | null;
}
export interface RollupStatusContext {
  __typename: "StatusContext";
  context: string;
  state: string;
  targetUrl: string | null;
  createdAt: string | null;
}
export type RollupContext = RollupCheckRun | RollupStatusContext;

export function mapRollupContexts(nodes: RollupContext[]): Check[] {
  return nodes.map((n): Check => {
    if (n.__typename === "CheckRun") {
      return {
        name: n.name, status: mapStatus(n.status), conclusion: mapConclusion(n.conclusion),
        detailsUrl: n.detailsUrl ?? null, startedAt: n.startedAt ?? null, completedAt: n.completedAt ?? null,
        checkRunId: n.databaseId ?? null, checkSuiteId: n.checkSuite?.databaseId ?? null,
        workflowRunId: n.checkSuite?.workflowRun?.databaseId ?? null, isStatusContext: false,
      };
    }
    return {
      name: n.context, status: mapStateStatus(n.state), conclusion: mapStateConclusion(n.state),
      detailsUrl: n.targetUrl ?? null, startedAt: n.createdAt ?? null, completedAt: null,
      checkRunId: null, checkSuiteId: null, workflowRunId: null, isStatusContext: true,
    };
  });
}
```

- [ ] **Step 4: Rewrite `src/github/checks.ts` to reuse the mapper**

Replace the mapping helpers, node interfaces, and the `.map(...)` body. The file becomes just the query + response type + the fetch that delegates to `mapRollupContexts`:

```ts
import type { Octokit } from "octokit";
import type { Check, RepoTarget } from "../types.js";
import { mapRollupContexts, type RollupContext } from "./rollup.js";

const QUERY = `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
        __typename
        ... on CheckRun {
          name status conclusion detailsUrl startedAt completedAt databaseId
          checkSuite { databaseId workflowRun { databaseId } }
        }
        ... on StatusContext { context state targetUrl createdAt }
      } } } } } }
    }
  }
}`;

interface ChecksResponse {
  repository: {
    pullRequest: {
      commits: { nodes: { commit: { statusCheckRollup: { contexts: { nodes: RollupContext[] } } | null } }[] };
    } | null;
  } | null;
}

export async function fetchChecks(octokit: Pick<Octokit, "graphql">, target: RepoTarget, prNumber: number): Promise<Check[]> {
  const res = await octokit.graphql<ChecksResponse>(QUERY, { owner: target.owner, repo: target.repo, number: prNumber });
  const rollup = res.repository?.pullRequest?.commits?.nodes?.[0]?.commit?.statusCheckRollup;
  return mapRollupContexts(rollup?.contexts?.nodes ?? []);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/github/rollup.test.ts src/github/checks.test.ts && pnpm typecheck`
Expected: PASS (both suites) and clean typecheck.

- [ ] **Step 6: Commit**

```bash
git add src/github/rollup.ts src/github/rollup.test.ts src/github/checks.ts
git commit -m "refactor(github): extract shared rollup->Check[] mapper"
```

---

### Task 3: Check counts + `mergeable` in the list query (item 1 data, item 3 data)

Extend `listMyOpenPrs` to return each PR's checks and `mergeable` state, add the `mergeable` field to `PullRequest`, and have the store merge list-derived checks for all PRs — protecting the selected PR and dropping closed PRs (N3), reading `state.selectedPr` at apply-time (S2).

**Files:**
- Modify: `src/types.ts` (add `mergeable` to `PullRequest`)
- Modify: `src/github/prs.ts` (query + return shape)
- Modify: `src/store.ts` (`Deps.loadPrs` type + `loadPrs` merge body)
- Modify: `src/cli.tsx` (no logic change; verify wiring still typechecks)
- Modify fixtures: `test/fixtures/prs-search.json`
- Update constructors (forced by the new required field): `src/github/prs.test.ts`, `src/store.test.ts`, `src/ui/App.test.tsx`, `src/ui/PrList.test.tsx`, `src/ui/Detail.test.tsx`
- Test: `src/github/prs.test.ts`, `src/store.test.ts`

**Interfaces:**
- Consumes: `mapRollupContexts`, `RollupContext` from Task 2.
- Produces:
  - `PullRequest.mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN"`.
  - `listMyOpenPrs(...): Promise<{ prs: PullRequest[]; checks: Record<number, Check[]> }>`.
  - `Deps.loadPrs: () => Promise<{ prs: PullRequest[]; checks: Record<number, Check[]> }>`.

- [ ] **Step 1: Add the `mergeable` field to the type**

In `src/types.ts`, add to `PullRequest`:

```ts
export interface PullRequest {
  number: number;
  title: string;
  headRefName: string;
  baseRefName: string;
  headSha: string;
  url: string;
  isCrossRepository: boolean;    // fork PR
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
}
```

- [ ] **Step 2: Update the fixture**

Replace `test/fixtures/prs-search.json` with:

```json
{ "search": { "nodes": [
  { "number": 142, "title": "Fix auth flow", "url": "https://github.com/acme/widget/pull/142", "isCrossRepository": false, "mergeable": "CONFLICTING", "headRefName": "feat/auth", "baseRefName": "main", "headRefOid": "abc123",
    "commits": { "nodes": [ { "commit": { "statusCheckRollup": { "contexts": { "nodes": [
      { "__typename": "CheckRun", "name": "build", "status": "COMPLETED", "conclusion": "SUCCESS", "detailsUrl": null, "startedAt": null, "completedAt": null, "databaseId": 11, "checkSuite": { "databaseId": 91, "workflowRun": { "databaseId": 501 } } },
      { "__typename": "CheckRun", "name": "test", "status": "COMPLETED", "conclusion": "FAILURE", "detailsUrl": null, "startedAt": null, "completedAt": null, "databaseId": 12, "checkSuite": { "databaseId": 91, "workflowRun": { "databaseId": 501 } } }
    ] } } } } ] } },
  { "number": 138, "title": "Bump deps", "url": "https://github.com/acme/widget/pull/138", "isCrossRepository": false, "mergeable": "MERGEABLE", "headRefName": "deps", "baseRefName": "main", "headRefOid": "def456",
    "commits": { "nodes": [ { "commit": { "statusCheckRollup": null } } ] } }
] } }
```

- [ ] **Step 3: Write the failing `prs.test.ts`**

Replace the assertion body in `src/github/prs.test.ts` (keep the imports/fixture/target lines):

```ts
test("maps search results to { prs, checks }, mergeable, and builds the query", async () => {
  const graphql = vi.fn().mockResolvedValue(fixture);
  const { prs, checks } = await listMyOpenPrs({ graphql } as unknown as Pick<Octokit, "graphql">, target);
  expect(graphql).toHaveBeenCalledWith(expect.any(String), { q: "repo:acme/widget is:pr is:open author:@me sort:updated-desc" });
  expect(prs[0]).toEqual({ number: 142, title: "Fix auth flow", url: "https://github.com/acme/widget/pull/142", isCrossRepository: false, mergeable: "CONFLICTING", headRefName: "feat/auth", baseRefName: "main", headSha: "abc123" });
  expect(prs).toHaveLength(2);
  expect(checks[142]).toHaveLength(2);
  expect(checks[142].find((c) => c.name === "test")?.conclusion).toBe("failure");
  expect(checks[142].find((c) => c.name === "test")?.workflowRunId).toBe(501); // full fields → rerun works on fresh select (S4/S3)
  expect(checks[138]).toEqual([]);       // null rollup → no checks
  expect(prs[1].mergeable).toBe("MERGEABLE");
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm vitest run src/github/prs.test.ts`
Expected: FAIL (`listMyOpenPrs` still returns an array; `checks`/`mergeable` undefined).

- [ ] **Step 5: Rewrite `src/github/prs.ts`**

```ts
import type { Octokit } from "octokit";
import type { Check, PullRequest, RepoTarget } from "../types.js";
import { mapRollupContexts, type RollupContext } from "./rollup.js";

const QUERY = `
query($q: String!) {
  search(query: $q, type: ISSUE, first: 50) {
    nodes {
      ... on PullRequest {
        number title url isCrossRepository mergeable
        headRefName baseRefName headRefOid
        commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 50) { nodes {
          __typename
          ... on CheckRun {
            name status conclusion detailsUrl startedAt completedAt databaseId
            checkSuite { databaseId workflowRun { databaseId } }
          }
          ... on StatusContext { context state targetUrl createdAt }
        } } } } } }
      }
    }
  }
}`;

interface SearchNode {
  number: number; title: string; url: string; isCrossRepository: boolean;
  mergeable: PullRequest["mergeable"];
  headRefName: string; baseRefName: string; headRefOid: string;
  commits: { nodes: { commit: { statusCheckRollup: { contexts: { nodes: RollupContext[] } } | null } }[] } | null;
}

const rollupNodes = (n: SearchNode): RollupContext[] =>
  n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? [];

export async function listMyOpenPrs(
  octokit: Pick<Octokit, "graphql">, target: RepoTarget,
): Promise<{ prs: PullRequest[]; checks: Record<number, Check[]> }> {
  const q = `repo:${target.owner}/${target.repo} is:pr is:open author:@me sort:updated-desc`;
  const res = await octokit.graphql<{ search: { nodes: SearchNode[] } }>(QUERY, { q });
  const prs: PullRequest[] = [];
  const checks: Record<number, Check[]> = {};
  for (const n of res.search.nodes) {
    if (typeof n.number !== "number") continue;
    prs.push({
      number: n.number, title: n.title, url: n.url, isCrossRepository: n.isCrossRepository,
      mergeable: n.mergeable, headRefName: n.headRefName, baseRefName: n.baseRefName, headSha: n.headRefOid,
    });
    checks[n.number] = mapRollupContexts(rollupNodes(n));
  }
  return { prs, checks };
}
```

- [ ] **Step 6: Run `prs.test.ts` to verify it passes**

Run: `pnpm vitest run src/github/prs.test.ts`
Expected: PASS.

- [ ] **Step 7: Write the failing store test (merge + N3 + selected protection)**

In `src/store.test.ts`: (a) update the `pr()` helper to include `mergeable`, and (b) add the merge test. First update the helper:

```ts
const pr = (number: number): PullRequest => ({ number, title: `pr${number}`, url: "", isCrossRepository: false, mergeable: "MERGEABLE", headRefName: "h", baseRefName: "main", headSha: "s" });
```

Then update **every** `loadPrs` mock in this file from `.mockResolvedValue([pr(1), ...])` to the new shape `.mockResolvedValue({ prs: [pr(1), ...], checks: {} })`. Add this new test:

```ts
test("loadPrs populates checks for all PRs, protects the selected PR, and drops closed PRs", async () => {
  const { timer } = fakeTimer();
  const listChecks = { 1: [check({ name: "l1" })], 2: [check({ name: "l2" })] };
  const loadPrs = vi.fn().mockResolvedValue({ prs: [pr(1), pr(2)], checks: listChecks });
  const loadChecks = vi.fn().mockResolvedValue([check({ name: "detail" })]);
  const store = createStore({ loadPrs, loadChecks, timer, listMs: 1, checksMs: 1 });
  store.selectPr(1);
  await store.refreshNow();
  // selected PR #1 owned by loadChecks; non-selected #2 gets list-derived checks
  expect(store.getState().checks[1]?.[0].name).toBe("detail");
  expect(store.getState().checks[2]?.[0].name).toBe("l2");
  // next poll: PR #2 has closed → it must drop out of the map
  loadPrs.mockResolvedValue({ prs: [pr(1)], checks: { 1: [check({ name: "l1" })] } });
  await store.refreshNow();
  expect(store.getState().checks[2]).toBeUndefined();
});
```

- [ ] **Step 8: Run store test to verify it fails**

Run: `pnpm vitest run src/store.test.ts -t "populates checks for all PRs"`
Expected: FAIL (compile error: `loadPrs` returns `{prs,checks}` but store still treats it as an array).

- [ ] **Step 9: Update the store's `Deps` type and `loadPrs` body**

In `src/store.ts`, change the `Deps.loadPrs` signature:

```ts
interface Deps {
  loadPrs: () => Promise<{ prs: PullRequest[]; checks: Record<number, Check[]> }>;
  loadChecks: (prNumber: number) => Promise<Check[]>;
  timer: Timer;
  listMs: number;
  checksMs: number;
}
```

Add `Check` to the type import if not present (`import type { Check, PullRequest } from "./types.js";`). Replace the `loadPrs` function body:

```ts
  async function loadPrs() {
    if (prsInFlight) return;
    prsInFlight = true; set({ loadingPrs: true });
    try {
      const { prs, checks } = await deps.loadPrs();
      // Rebuild the checks map from list data (closed PRs drop out), but keep the
      // existing entry for the currently-selected PR — it's owned by loadChecks
      // (fast poll + stale guard). Read selectedPr *now*, after the await (S2).
      const sel = state.selectedPr;
      const merged: Record<number, Check[]> = {};
      for (const p of prs) {
        merged[p.number] = p.number === sel && state.checks[p.number] ? state.checks[p.number] : (checks[p.number] ?? []);
      }
      set({ prs, checks: merged, error: null });
    }
    catch (e) { set({ error: errorMessage(e) }); }
    finally { prsInFlight = false; set({ loadingPrs: false }); }
  }
```

- [ ] **Step 10: Run the full store + prs suites and typecheck**

Run: `pnpm vitest run src/store.test.ts src/github/prs.test.ts && pnpm typecheck`
Expected: `store.test.ts` PASS, `prs.test.ts` PASS. Typecheck will now FAIL only in the UI/App tests that construct `PullRequest` without `mergeable` — fixed in the next step.

- [ ] **Step 11: Add `mergeable` to remaining PR constructors**

Add `mergeable: "MERGEABLE"` (or `"CONFLICTING"` where a test wants a conflict) to each literal:

- `src/ui/App.test.tsx:10` — the inline `prs` literal: `..., isCrossRepository: false, mergeable: "MERGEABLE", headRefName: "a", ...`
- `src/ui/PrList.test.tsx` — the `mkPr` helper: `({ number: n, title, url: "", isCrossRepository: false, mergeable: "MERGEABLE", headRefName: "a", baseRefName: "main", headSha: "s" })`
- `src/ui/Detail.test.tsx` — the `pr` literal: `..., isCrossRepository: false, mergeable: "MERGEABLE", headRefName: "feat/auth", ...`

- [ ] **Step 12: Run the whole suite + typecheck**

Run: `pnpm typecheck && pnpm test`
Expected: PASS (all suites), clean typecheck.

- [ ] **Step 13: Commit**

```bash
git add src/types.ts src/github/prs.ts src/store.ts test/fixtures/prs-search.json src/github/prs.test.ts src/store.test.ts src/ui/App.test.tsx src/ui/PrList.test.tsx src/ui/Detail.test.tsx
git commit -m "feat: fetch check counts and mergeable state for all PRs in the list query"
```

---

### Task 4: Protect requeued PRs across navigation (B1)

`markRequeued` optimistically flips a PR's failed checks to pending and must not be clobbered by a later list poll once the user navigates away. Add a per-PR suppression window that the list merge respects.

**Files:**
- Modify: `src/store.ts` (`markRequeued` + `loadPrs` merge guard)
- Test: `src/store.test.ts`

**Interfaces:**
- Consumes: `loadPrs` merge from Task 3.
- Produces: no new public API (internal `requeuedUntil` guard).

- [ ] **Step 1: Write the failing test**

Add to `src/store.test.ts` (uses fake timers to drive the suppression window):

```ts
test("list poll does not clobber a requeued PR's flip until the suppression window lapses", async () => {
  vi.useFakeTimers();
  try {
    const { timer } = fakeTimer();
    const failed = () => [check({ name: "test", conclusion: "failure", workflowRunId: 501 })];
    const loadPrs = vi.fn().mockResolvedValue({ prs: [pr(1), pr(2)], checks: { 1: failed(), 2: [] } });
    const loadChecks = vi.fn().mockResolvedValue(failed());
    const store = createStore({ loadPrs, loadChecks, timer, listMs: 1, checksMs: 1 });
    store.selectPr(1);
    await store.refreshNow();
    store.markRequeued(1, [501]);                    // flip #1's failed check to pending
    store.selectPr(2);                               // navigate away from #1
    expect(store.getState().checks[1]?.[0].status).toBe("in_progress");
    await store.refreshNow();                        // stale list poll still shows failure
    expect(store.getState().checks[1]?.[0].status).toBe("in_progress"); // preserved
    vi.advanceTimersByTime(60_000);                  // window lapses (>45s)
    await store.refreshNow();
    expect(store.getState().checks[1]?.[0].status).toBe("completed");   // now reconciles
  } finally {
    vi.useRealTimers();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/store.test.ts -t "suppression window"`
Expected: FAIL (the second assertion — the stale poll reverts #1 to `completed`/failure).

- [ ] **Step 3: Add the suppression window**

In `src/store.ts`, declare the guard alongside the other closure state (near `prsInFlight`):

```ts
  const requeuedUntil = new Map<number, number>();
  const REQUEUE_SUPPRESS_MS = 45_000;
```

In `loadPrs`, extend the protection predicate to also cover suppressed PRs:

```ts
      const sel = state.selectedPr;
      const now = Date.now();
      const merged: Record<number, Check[]> = {};
      for (const p of prs) {
        const protectedPr = p.number === sel || (requeuedUntil.get(p.number) ?? 0) > now;
        merged[p.number] = protectedPr && state.checks[p.number] ? state.checks[p.number] : (checks[p.number] ?? []);
      }
```

In `markRequeued`, record the window when a flip actually happens (right after computing `updated`, before/after `set`):

```ts
      requeuedUntil.set(prNumber, Date.now() + REQUEUE_SUPPRESS_MS);
      set({ checks: { ...state.checks, [prNumber]: updated } });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/store.test.ts`
Expected: PASS (new test + existing `markRequeued` test).

- [ ] **Step 5: Commit**

```bash
git add src/store.ts src/store.test.ts
git commit -m "fix(store): protect requeued PRs from list-poll clobber across navigation"
```

---

### Task 5: Merge-conflict indicator (item 3 UI)

Add a `conflict` theme token and render a `⚠` marker in the PR list and a `⚠ merge conflict` line in the Detail header for `CONFLICTING` PRs. `UNKNOWN` shows nothing.

**Files:**
- Modify: `src/theme.ts` (add `conflict` to `Theme` and `mocha`)
- Modify: `src/ui/PrList.tsx` (row marker)
- Modify: `src/ui/Detail.tsx` (header line)
- Test: `src/theme.test.ts`, `src/ui/PrList.test.tsx`, `src/ui/Detail.test.tsx`

**Interfaces:**
- Consumes: `PullRequest.mergeable` (Task 3).
- Produces: `Theme.conflict: string`.

- [ ] **Step 1: Write the failing theme test**

Add to `src/theme.test.ts`:

```ts
test("mocha has a conflict token distinct from flag", () => {
  const t = getTheme("mocha");
  expect(t.conflict).toBeTruthy();
  expect(t.conflict).not.toBe(t.flag);
});
```

(Ensure `getTheme` is imported in the test file — it is used by the existing tests.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/theme.test.ts -t "conflict token"`
Expected: FAIL (`t.conflict` is undefined).

- [ ] **Step 3: Add the token**

In `src/theme.ts`, add `conflict` to the `Theme` interface and the `mocha` palette:

```ts
export interface Theme {
  name: string; base: string; border: string; title: string; checkName: string;
  selection: string; meta: string; pass: string; fail: string; pending: string;
  skip: string; flag: string; error: string; conflict: string;
}

const mocha: Theme = {
  name: "mocha", base: "#1e1e2e", border: "#313244", title: "#cba6f7", checkName: "#94e2d5",
  selection: "#89b4fa", meta: "#6c7086", pass: "#a6e3a1", fail: "#f38ba8", pending: "#fab387",
  skip: "#6c7086", flag: "#f9e2af", error: "#f38ba8", conflict: "#eba0ac",
};
```

- [ ] **Step 4: Write the failing UI tests**

Add to `src/ui/PrList.test.tsx`:

```ts
test("shows a conflict marker only for CONFLICTING PRs", () => {
  const conflicting = [{ ...mkPr(142, "Fix auth flow"), mergeable: "CONFLICTING" as const }];
  const clean = [{ ...mkPr(142, "Fix auth flow"), mergeable: "UNKNOWN" as const }];
  expect(render(<PrList prs={conflicting} checks={{}} selected={142} focused theme={getTheme("mocha")} width={80} visibleRows={6} target={target} />).lastFrame()).toContain("⚠");
  expect(render(<PrList prs={clean} checks={{}} selected={142} focused theme={getTheme("mocha")} width={80} visibleRows={6} target={target} />).lastFrame()).not.toContain("⚠");
});
```

Add to `src/ui/Detail.test.tsx`:

```ts
test("shows a merge-conflict line when the PR is CONFLICTING", () => {
  const conflicted: PullRequest = { ...pr, mergeable: "CONFLICTING" };
  const { lastFrame } = render(<Detail pr={conflicted} checks={checks} checkCursor={0} focused theme={getTheme("mocha")} width={80} visibleRows={10} />);
  expect(lastFrame()).toMatch(/⚠ merge conflict/);
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `pnpm vitest run src/ui/PrList.test.tsx src/ui/Detail.test.tsx -t "conflict"`
Expected: FAIL (no `⚠` rendered).

- [ ] **Step 6: Render the marker in `PrList.tsx`**

In the row `<Box>` of `src/ui/PrList.tsx`, append a conflict marker after the counts `<Text>`:

```tsx
            <Text color={theme.meta}>{`✓${pass} ✗${fail} •${pending}`}</Text>
            {pr.mergeable === "CONFLICTING" ? <Text color={theme.conflict}> ⚠</Text> : null}
```

- [ ] **Step 7: Render the header line in `Detail.tsx`**

In `src/ui/Detail.tsx`, add a conflict line right after the `headRefName → baseRefName` header `<Text>` (before the `─` divider):

```tsx
      <Text color={theme.meta}>{pr.headRefName} → {pr.baseRefName}{pr.isCrossRepository ? " (fork)" : ""}</Text>
      {pr.mergeable === "CONFLICTING" ? <Text color={theme.conflict}>⚠ merge conflict</Text> : null}
      <Text color={theme.border}>{"─".repeat(inner)}</Text>
```

- [ ] **Step 8: Run the full suite + typecheck**

Run: `pnpm typecheck && pnpm test`
Expected: PASS (all suites), clean typecheck.

- [ ] **Step 9: Commit**

```bash
git add src/theme.ts src/theme.test.ts src/ui/PrList.tsx src/ui/PrList.test.tsx src/ui/Detail.tsx src/ui/Detail.test.tsx
git commit -m "feat(ui): flag PRs with merge conflicts in the list and detail pane"
```

---

## Notes for the implementer

- After each task, the tree must be green (`pnpm typecheck && pnpm test`). Task boundaries are chosen so this holds.
- Do **not** widen `contexts(first: 50)` in `prs.ts` back to `100` — the `50` cap is a deliberate rate-limit bound (see spec "Cost" section). The single-PR `checks.ts` query keeps `100`.
- The Detail header already truncates the title against `inner`; the new conflict line is a separate row and does not affect that budget.
