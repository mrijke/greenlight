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
  stdin.write("\u001B"); await sleep(30);       // esc closes (Ink buffers escape for 20ms)
  expect(lastFrame()).not.toMatch(/\[esc\] close/);
});
