import { render } from "ink-testing-library";
import { expect, test } from "vitest";
import React from "react";
import { PrList } from "./PrList.js";
import { getTheme } from "../theme.js";
import type { PullRequest, Check, RepoTarget } from "../types.js";

const target: RepoTarget = { owner: "acme", repo: "widget", viewerLogin: "me", viewerCanWrite: true };
const prs: PullRequest[] = [{ number: 142, title: "Fix auth flow", url: "", isCrossRepository: false, headRefName: "a", baseRefName: "main", headSha: "s" }];
const checks: Record<number, Check[]> = { 142: [{ name: "test", status: "completed", conclusion: "failure", detailsUrl: null, startedAt: null, completedAt: null, checkRunId: null, checkSuiteId: null, workflowRunId: null, isStatusContext: false }] };

test("renders PR number, title and a fail glyph", () => {
  const { lastFrame } = render(<PrList prs={prs} checks={checks} selected={142} focused theme={getTheme("mocha")} height={10} target={target} />);
  expect(lastFrame()).toContain("#142");
  expect(lastFrame()).toContain("Fix auth");
  expect(lastFrame()).toContain("✗");
});

test("empty state names the viewer and repo", () => {
  const { lastFrame } = render(<PrList prs={[]} checks={{}} selected={null} focused theme={getTheme("mocha")} height={10} target={target} />);
  expect(lastFrame()).toMatch(/No open PRs by @me in[\s\S]*acme\/widget/i);
});
