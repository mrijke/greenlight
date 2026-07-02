import { expect, test, vi } from "vitest";
import { createStore } from "./store.js";
import type { Check, PullRequest } from "./types.js";

const pr = (number: number): PullRequest => ({ number, title: `pr${number}`, url: "", isCrossRepository: false, mergeable: "MERGEABLE", reviewDecision: null, headRefName: "h", baseRefName: "main", headSha: "s" });
const check = (o: Partial<Check>): Check => ({ name: "c", status: "completed", conclusion: "success", detailsUrl: null, startedAt: null, completedAt: null, checkRunId: null, checkSuiteId: null, workflowRunId: null, workflowName: null, isStatusContext: false, ...o });
const fakeTimer = () => { const handles: (() => void)[] = []; return { timer: { setInterval: (fn: () => void) => { handles.push(fn); return handles.length - 1; }, clearInterval: () => {} }, tick: async () => { for (const h of [...handles]) h(); await Promise.resolve(); } }; };

test("loads PRs and checks for selected PR", async () => {
  const { timer } = fakeTimer();
  const loadPrs = vi.fn().mockResolvedValue({ prs: [pr(1), pr(2)], checks: {} });
  const loadChecks = vi.fn().mockResolvedValue([check({})]);
  const store = createStore({ loadPrs, loadChecks, timer, listMs: 30000, checksMs: 10000 });
  await store.refreshNow();
  expect(store.getState().prs).toHaveLength(2);
  store.selectPr(1);
  await store.refreshNow();
  expect(store.getState().checks[1]).toHaveLength(1);
});

test("single-flight: a slow load is not started twice", async () => {
  const { timer, tick } = fakeTimer();
  let resolve!: (v: { prs: PullRequest[]; checks: Record<number, Check[]> }) => void;
  const loadPrs = vi.fn().mockImplementation(() => new Promise<{ prs: PullRequest[]; checks: Record<number, Check[]> }>((r) => { resolve = r; }));
  const store = createStore({ loadPrs, loadChecks: vi.fn().mockResolvedValue([]), timer, listMs: 1, checksMs: 1 });
  store.start();
  await tick(); await tick(); // two ticks while first call is in flight
  expect(loadPrs).toHaveBeenCalledTimes(1);
  resolve({ prs: [], checks: {} });
});

test("stale checks response for a non-selected PR is discarded", async () => {
  const { timer } = fakeTimer();
  const loadChecks = vi.fn().mockResolvedValue([check({ name: "stale" })]);
  const store = createStore({ loadPrs: vi.fn().mockResolvedValue({ prs: [pr(1), pr(2)], checks: { 1: [], 2: [] } }), loadChecks, timer, listMs: 1, checksMs: 1 });
  store.selectPr(1);
  const p = store.refreshNow();          // begins loading checks for PR 1
  store.selectPr(2);                      // user moves before it resolves
  await p;
  // loadChecks for PR 1 should be discarded because selectedPr is now 2
  expect(store.getState().checks[1]).toEqual([]); // from list query, stale response ignored
  expect(loadChecks).toHaveBeenCalledWith(1);     // was called for PR 1
});

test("markRequeued flips only failed checks of the reran runs and does not refetch", async () => {
  const loadChecks = vi.fn().mockResolvedValue([check({ name: "build", conclusion: "success", workflowRunId: 501 }), check({ name: "test", conclusion: "failure", workflowRunId: 501 }), check({ name: "lint", conclusion: "failure", workflowRunId: 777 })]);
  const { timer } = fakeTimer();
  const store = createStore({ loadPrs: vi.fn().mockResolvedValue({ prs: [pr(1)], checks: {} }), loadChecks, timer, listMs: 1, checksMs: 1 });
  store.selectPr(1);
  await store.refreshNow();
  loadChecks.mockClear();
  store.markRequeued(1, [501]);
  const after = store.getState().checks[1]!;
  expect(after.find((c) => c.name === "test")?.status).toBe("in_progress"); // failed → pending
  expect(after.find((c) => c.name === "test")?.conclusion).toBeNull();
  expect(after.find((c) => c.name === "build")?.conclusion).toBe("success"); // passing check untouched
  expect(after.find((c) => c.name === "lint")?.conclusion).toBe("failure"); // unaffected run stays
  expect(loadChecks).not.toHaveBeenCalled(); // no immediate clobbering refetch
});

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
