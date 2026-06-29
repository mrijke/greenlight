import { expect, test, vi } from "vitest";
import { createStore } from "./store.js";
import type { Check, PullRequest } from "./types.js";

const pr = (number: number): PullRequest => ({ number, title: `pr${number}`, url: "", isCrossRepository: false, headRefName: "h", baseRefName: "main", headSha: "s" });
const check = (o: Partial<Check>): Check => ({ name: "c", status: "completed", conclusion: "success", detailsUrl: null, startedAt: null, completedAt: null, checkRunId: null, checkSuiteId: null, workflowRunId: null, isStatusContext: false, ...o });
const fakeTimer = () => { const handles: (() => void)[] = []; return { timer: { setInterval: (fn: () => void) => { handles.push(fn); return handles.length - 1; }, clearInterval: () => {} }, tick: async () => { for (const h of [...handles]) h(); await Promise.resolve(); } }; };

test("loads PRs and checks for selected PR", async () => {
  const { timer } = fakeTimer();
  const loadPrs = vi.fn().mockResolvedValue([pr(1), pr(2)]);
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
  let resolve!: (v: PullRequest[]) => void;
  const loadPrs = vi.fn().mockImplementation(() => new Promise<PullRequest[]>((r) => { resolve = r; }));
  const store = createStore({ loadPrs, loadChecks: vi.fn().mockResolvedValue([]), timer, listMs: 1, checksMs: 1 });
  store.start();
  await tick(); await tick(); // two ticks while first call is in flight
  expect(loadPrs).toHaveBeenCalledTimes(1);
  resolve([]);
});

test("stale checks response for a non-selected PR is discarded", async () => {
  const { timer } = fakeTimer();
  const store = createStore({ loadPrs: vi.fn().mockResolvedValue([pr(1), pr(2)]), loadChecks: vi.fn().mockResolvedValue([check({ name: "stale" })]), timer, listMs: 1, checksMs: 1 });
  store.selectPr(1);
  const p = store.refreshNow();          // begins loading checks for PR 1
  store.selectPr(2);                      // user moves before it resolves
  await p;
  expect(store.getState().checks[1]).toBeUndefined();
});
