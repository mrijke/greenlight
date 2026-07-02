import { render } from "ink-testing-library";
import { expect, test } from "vitest";
import React from "react";
import { PrList } from "./PrList.js";
import { getTheme } from "../theme.js";
import type { PullRequest, Check, RepoTarget } from "../types.js";

const target: RepoTarget = { owner: "acme", repo: "widget", viewerLogin: "me", viewerCanWrite: true };
const mkPr = (n: number, title: string): PullRequest => ({ number: n, title, url: "", isCrossRepository: false, mergeable: "MERGEABLE", reviewDecision: null, headRefName: "a", baseRefName: "main", headSha: "s" });
const prs: PullRequest[] = [mkPr(142, "Fix auth flow")];
const checks: Record<number, Check[]> = { 142: [{ name: "test", status: "completed", conclusion: "failure", detailsUrl: null, startedAt: null, completedAt: null, checkRunId: null, checkSuiteId: null, workflowRunId: null, workflowName: null, isStatusContext: false }] };

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

test("shows a conflict marker only for CONFLICTING PRs", () => {
  const conflicting = [{ ...mkPr(142, "Fix auth flow"), mergeable: "CONFLICTING" as const }];
  const clean = [{ ...mkPr(142, "Fix auth flow"), mergeable: "UNKNOWN" as const }];
  expect(render(<PrList prs={conflicting} checks={{}} selected={142} focused theme={getTheme("mocha")} width={80} visibleRows={6} target={target} />).lastFrame()).toContain("⚠");
  expect(render(<PrList prs={clean} checks={{}} selected={142} focused theme={getTheme("mocha")} width={80} visibleRows={6} target={target} />).lastFrame()).not.toContain("⚠");
});

test("shows an approved badge only for PRs with reviewDecision APPROVED", () => {
  const approved = [{ ...mkPr(142, "Fix auth flow"), reviewDecision: "APPROVED" as const }];
  const unreviewed = [{ ...mkPr(142, "Fix auth flow"), reviewDecision: null }];
  const { lastFrame: approvedFrame } = render(<PrList prs={approved} checks={{}} selected={142} focused theme={getTheme("mocha")} width={80} visibleRows={6} target={target} />);
  const { lastFrame: unreviewedFrame } = render(<PrList prs={unreviewed} checks={{}} selected={142} focused theme={getTheme("mocha")} width={80} visibleRows={6} target={target} />);
  expect(approvedFrame()).toMatch(/Fix auth flow ✦ ✓0 ✗0 •0/);
  expect(unreviewedFrame()).not.toContain("✦");
});
