import { render } from "ink-testing-library";
import { expect, test, vi } from "vitest";
import React from "react";
import { App } from "./App.js";
import { createStore } from "../store.js";
import { getTheme } from "../theme.js";
import type { Check, PullRequest, RepoTarget } from "../types.js";

const target: RepoTarget = { owner: "acme", repo: "widget", viewerLogin: "me", viewerCanWrite: true };
const prs: PullRequest[] = [{ number: 142, title: "Fix auth flow", url: "u", isCrossRepository: false, mergeable: "MERGEABLE", reviewDecision: null, headRefName: "a", baseRefName: "main", headSha: "s" }];
const checks: Check[] = [{ name: "test", status: "completed", conclusion: "failure", detailsUrl: null, startedAt: null, completedAt: null, checkRunId: 1, checkSuiteId: 1, workflowRunId: 1, isStatusContext: false, workflowName: "CI" }];
const mkc = (o: Partial<Check>): Check => ({ name: "c", status: "completed", conclusion: "success", detailsUrl: null, startedAt: null, completedAt: null, checkRunId: null, checkSuiteId: null, workflowRunId: null, isStatusContext: false, workflowName: null, ...o });
const noTimer = { setInterval: () => 0, clearInterval: () => {} };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mkStore() {
  return createStore({ loadPrs: vi.fn().mockResolvedValue({ prs, checks: {} }), loadChecks: vi.fn().mockResolvedValue(checks), timer: noTimer, listMs: 1, checksMs: 1 });
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
  stdin.write("\t"); await sleep(5);            // focus → detail (cursor on the group header)
  stdin.write("j"); await sleep(5);             // move onto the check row
  stdin.write("\r"); await sleep(20);           // ↵ analyze
  expect(onAnalyze).toHaveBeenCalled();
  expect(lastFrame()).toMatch(/analysis/);
  expect(lastFrame()).toContain("boom");
  stdin.write("\u001B"); await sleep(30);       // esc closes (Ink buffers escape for 20ms)
  expect(lastFrame()).not.toMatch(/\[esc\] close/);
});

test("scrolling reaches the last line of an overflowing analysis body", async () => {
  const store = mkStore();
  await store.refreshNow(); store.selectPr(142); await store.refreshNow();
  const big = { ...heuristic, errorLines: Array.from({ length: 20 }, (_, i) => `line ${i}`) };
  const onAnalyze = vi.fn().mockResolvedValue({ heuristic: big, llm: () => Promise.resolve("x") });
  const { lastFrame, stdin } = render(<App store={store} theme={getTheme("mocha")} target={target} onRerun={vi.fn()} onAnalyze={onAnalyze} openUrl={vi.fn()} llmEnabled={false} />);
  stdin.setRawMode(); stdin.resume(); await sleep(0);
  stdin.write("\t"); await sleep(5);            // focus → detail (cursor on the group header)
  stdin.write("j"); await sleep(5);             // move onto the check row
  stdin.write("\r"); await sleep(20);           // ↵ analyze
  expect(lastFrame()).not.toContain("line 19"); // last line starts off-screen
  for (let i = 0; i < 25; i++) { stdin.write("j"); await sleep(1); } // scroll to the bottom
  expect(lastFrame()).toContain("line 19");     // the final line is now reachable (not clamped one short)
});

test("analysis pop-up survives a checks reload that drops the analyzed check", async () => {
  let current: Check[] = checks;
  const store = createStore({ loadPrs: vi.fn().mockResolvedValue({ prs, checks: {} }), loadChecks: vi.fn().mockImplementation(() => Promise.resolve(current)), timer: noTimer, listMs: 1, checksMs: 1 });
  await store.refreshNow(); store.selectPr(142); await store.refreshNow();
  const onAnalyze = vi.fn().mockResolvedValue({ heuristic, llm: () => Promise.resolve("x") });
  const { lastFrame, stdin } = render(<App store={store} theme={getTheme("mocha")} target={target} onRerun={vi.fn()} onAnalyze={onAnalyze} openUrl={vi.fn()} llmEnabled={false} />);
  stdin.setRawMode(); stdin.resume(); await sleep(0);
  stdin.write("\t"); await sleep(5);            // focus → detail (cursor on the group header)
  stdin.write("j"); await sleep(5);             // move onto the check row
  stdin.write("\r"); await sleep(20);           // ↵ analyze
  expect(lastFrame()).toMatch(/analysis/);
  expect(lastFrame()).toContain("boom");
  current = [];                                  // a background poll returns no checks
  await store.refreshNow(); await sleep(5);
  expect(lastFrame()).toMatch(/analysis/);       // still shown: snapshot, not a live index lookup
  expect(lastFrame()).toContain("boom");
});

test("an LLM resolve from a closed pane does not leak into the next analysis", async () => {
  const store = mkStore();
  await store.refreshNow(); store.selectPr(142); await store.refreshNow();
  let resolveLlm: (s: string) => void = () => {};
  const llm = () => new Promise<string>((r) => { resolveLlm = r; });
  const onAnalyze = vi.fn().mockResolvedValue({ heuristic, llm });
  const { lastFrame, stdin } = render(<App store={store} theme={getTheme("mocha")} target={target} onRerun={vi.fn()} onAnalyze={onAnalyze} openUrl={vi.fn()} llmEnabled={true} />);
  stdin.setRawMode(); stdin.resume(); await sleep(0);
  stdin.write("\t"); await sleep(5);            // focus → detail (cursor on the group header)
  stdin.write("j"); await sleep(5);             // move onto the check row
  stdin.write("\r"); await sleep(20);           // ↵ analyze (pane open, runLlm ready)
  stdin.write("a"); await sleep(5);             // start a slow LLM request
  expect(lastFrame()).toMatch(/analyzing/);     // spinner is up
  stdin.write(""); await sleep(30);       // esc closes — invalidates the request
  stdin.write("\r"); await sleep(20);           // reopen analysis on the same check
  resolveLlm("STALE ANSWER"); await sleep(10);  // the closed request resolves late
  expect(lastFrame()).not.toContain("STALE ANSWER"); // stale result is dropped, not shown
  expect(lastFrame()).not.toMatch(/analyzing/);      // and no spinner stuck on
});

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
    { number: 142, title: "First", url: "u", isCrossRepository: false, mergeable: "MERGEABLE", reviewDecision: null, headRefName: "a", baseRefName: "main", headSha: "s" },
    { number: 143, title: "Second", url: "u", isCrossRepository: false, mergeable: "MERGEABLE", reviewDecision: null, headRefName: "b", baseRefName: "main", headSha: "s" },
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
  const openUrl = vi.fn().mockResolvedValue(undefined);
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
