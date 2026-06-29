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

function mkStore() {
  const store = createStore({ loadPrs: vi.fn().mockResolvedValue(prs), loadChecks: vi.fn().mockResolvedValue(checks), timer: noTimer, listMs: 1, checksMs: 1 });
  return store;
}

test("renders both panes after data loads", async () => {
  const store = mkStore();
  await store.refreshNow();
  store.selectPr(142); await store.refreshNow();
  const { lastFrame } = render(<App store={store} theme={getTheme("mocha")} target={target} onRerun={vi.fn()} onAnalyze={vi.fn()} openUrl={vi.fn()} />);
  expect(lastFrame()).toContain("#142");
  expect(lastFrame()).toContain("test");
});

test("? toggles help overlay", async () => {
  const store = mkStore();
  await store.refreshNow(); store.selectPr(142); await store.refreshNow();
  const { lastFrame, stdin } = render(<App store={store} theme={getTheme("mocha")} target={target} onRerun={vi.fn()} onAnalyze={vi.fn()} openUrl={vi.fn()} />);
  stdin.setRawMode();
  stdin.resume();
  await new Promise((resolve) => setTimeout(resolve, 0));
  stdin.write("?");
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(lastFrame()).toMatch(/Keybindings/i);
});
