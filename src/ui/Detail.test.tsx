import { render } from "ink-testing-library";
import { expect, test } from "vitest";
import React from "react";
import { Detail } from "./Detail.js";
import { getTheme } from "../theme.js";
import { groupChecks, flattenRows } from "./checkGroups.js";
import type { PullRequest, Check } from "../types.js";

const pr: PullRequest = { number: 142, title: "Fix auth flow", url: "", isCrossRepository: false, mergeable: "MERGEABLE", headRefName: "feat/auth", baseRefName: "main", headSha: "s" };
const mk = (o: Partial<Check>): Check => ({ name: "c", status: "completed", conclusion: "success", detailsUrl: null, startedAt: "2026-06-29T10:00:00Z", completedAt: "2026-06-29T10:01:12Z", checkRunId: 1, checkSuiteId: 1, workflowRunId: 1, isStatusContext: false, workflowName: null, ...o });

const checks: Check[] = [
  mk({ name: "build", workflowRunId: 1, workflowName: "Project A", conclusion: "success", checkRunId: 11 }),
  mk({ name: "ci-cd", workflowRunId: 1, workflowName: "Project A", conclusion: "failure", checkRunId: 12 }),
  mk({ name: "deploy", workflowRunId: 2, workflowName: "Project B", conclusion: "success", checkRunId: 21 }),
];
const rowsFor = (expanded: Set<string>) => flattenRows(groupChecks(checks), expanded);

test("renders a group header with workflow name and aggregate counts", () => {
  const { lastFrame } = render(<Detail pr={pr} rows={rowsFor(new Set())} cursor={0} focused theme={getTheme("mocha")} width={80} visibleRows={10} />);
  expect(lastFrame()).toContain("Project A");
  expect(lastFrame()).toContain("✓1 ✗1 •0");
  expect(lastFrame()).toContain("▸");
});

test("a collapsed group hides its children", () => {
  const { lastFrame } = render(<Detail pr={pr} rows={rowsFor(new Set())} cursor={0} focused theme={getTheme("mocha")} width={80} visibleRows={10} />);
  expect(lastFrame()).not.toContain("ci-cd");
  expect(lastFrame()).not.toContain("build");
});

test("an expanded group shows its children under the header", () => {
  const { lastFrame } = render(<Detail pr={pr} rows={rowsFor(new Set(["1"]))} cursor={0} focused theme={getTheme("mocha")} width={80} visibleRows={10} />);
  expect(lastFrame()).toContain("ci-cd");
  expect(lastFrame()).toContain("build");
  expect(lastFrame()).toContain("▾");
});

test("the caret marks whichever row the cursor points at", () => {
  // rows: [header A, build, ci-cd, header B] — cursor 2 is "ci-cd"
  const { lastFrame } = render(<Detail pr={pr} rows={rowsFor(new Set(["1"]))} cursor={2} focused theme={getTheme("mocha")} width={80} visibleRows={10} />);
  expect(lastFrame()).toMatch(/❯ .*ci-cd/);
  expect((lastFrame()!.match(/❯/g) ?? []).length).toBe(1);
});

test("shows a 'more' footer when rows overflow", () => {
  const many = Array.from({ length: 30 }, (_, i) => mk({ name: `job-${i}`, workflowRunId: i, workflowName: `W${i}` }));
  const rows = flattenRows(groupChecks(many), new Set());
  const { lastFrame } = render(<Detail pr={pr} rows={rows} cursor={0} focused theme={getTheme("mocha")} width={80} visibleRows={5} />);
  expect(lastFrame()).toMatch(/more/);
});

test("shows placeholder when no PR selected", () => {
  const { lastFrame } = render(<Detail pr={null} rows={[]} cursor={0} focused theme={getTheme("mocha")} width={80} visibleRows={10} />);
  expect(lastFrame()).toMatch(/Select a PR/i);
});

test("shows a merge-conflict line when the PR is CONFLICTING", () => {
  const conflicted: PullRequest = { ...pr, mergeable: "CONFLICTING" };
  const { lastFrame } = render(<Detail pr={conflicted} rows={rowsFor(new Set())} cursor={0} focused theme={getTheme("mocha")} width={80} visibleRows={10} />);
  expect(lastFrame()).toMatch(/⚠ merge conflict/);
});
