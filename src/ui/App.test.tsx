import { render } from "ink-testing-library";
import { expect, test, vi } from "vitest";
import React from "react";
import { App } from "./App.js";
import { createStore } from "../store.js";
import { getTheme } from "../theme.js";
import type { Check, PullRequest, RepoTarget } from "../types.js";

const target: RepoTarget = { owner: "acme", repo: "widget", viewerLogin: "me", viewerCanWrite: true };
const prs: PullRequest[] = [{ number: 142, title: "Fix auth flow", url: "u", isCrossRepository: false, mergeable: "MERGEABLE", headRefName: "a", baseRefName: "main", headSha: "s" }];
const checks: Check[] = [{ name: "test", status: "completed", conclusion: "failure", detailsUrl: null, startedAt: null, completedAt: null, checkRunId: 1, checkSuiteId: 1, workflowRunId: 1, isStatusContext: false }];
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
  stdin.write("\t"); await sleep(5);            // focus → detail
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
  stdin.write("\t"); await sleep(5);            // focus → detail
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
  stdin.write("\t"); await sleep(5);            // focus → detail
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
  stdin.write("\t"); await sleep(5);            // focus → detail
  stdin.write("\r"); await sleep(20);           // ↵ analyze (pane open, runLlm ready)
  stdin.write("a"); await sleep(5);             // start a slow LLM request
  expect(lastFrame()).toMatch(/analyzing/);     // spinner is up
  stdin.write(""); await sleep(30);       // esc closes — invalidates the request
  stdin.write("\r"); await sleep(20);           // reopen analysis on the same check
  resolveLlm("STALE ANSWER"); await sleep(10);  // the closed request resolves late
  expect(lastFrame()).not.toContain("STALE ANSWER"); // stale result is dropped, not shown
  expect(lastFrame()).not.toMatch(/analyzing/);      // and no spinner stuck on
});
