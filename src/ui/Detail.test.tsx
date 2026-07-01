import { render } from "ink-testing-library";
import { expect, test } from "vitest";
import React from "react";
import { Detail } from "./Detail.js";
import { getTheme } from "../theme.js";
import type { PullRequest, Check } from "../types.js";

const pr: PullRequest = { number: 142, title: "Fix auth flow", url: "", isCrossRepository: false, mergeable: "MERGEABLE", headRefName: "feat/auth", baseRefName: "main", headSha: "s" };
const mkCheck = (name: string, conclusion: Check["conclusion"]): Check => ({ name, status: "completed", conclusion, detailsUrl: null, startedAt: "2026-06-29T10:00:00Z", completedAt: "2026-06-29T10:01:12Z", checkRunId: 1, checkSuiteId: 1, workflowRunId: 1, isStatusContext: false });
const checks: Check[] = [mkCheck("build", "success"), mkCheck("test (unit)", "failure")];

test("renders header and checks with durations", () => {
  const { lastFrame } = render(<Detail pr={pr} checks={checks} checkCursor={1} focused theme={getTheme("mocha")} width={80} visibleRows={10} />);
  expect(lastFrame()).toContain("Fix auth flow");
  expect(lastFrame()).toContain("feat/auth");
  expect(lastFrame()).toContain("main");
  expect(lastFrame()).toContain("build");
  expect(lastFrame()).toContain("1m12s");
});

test("shows a 'more' footer when checks overflow", () => {
  const many = Array.from({ length: 30 }, (_, i) => mkCheck(`job-${i}`, "success"));
  const { lastFrame } = render(<Detail pr={pr} checks={many} checkCursor={0} focused theme={getTheme("mocha")} width={80} visibleRows={5} />);
  expect(lastFrame()).toMatch(/more/);
});

test("footer omits the down arrow when the cursor is at the end of the list", () => {
  const many = Array.from({ length: 30 }, (_, i) => mkCheck(`job-${i}`, "success"));
  const { lastFrame } = render(<Detail pr={pr} checks={many} checkCursor={29} focused theme={getTheme("mocha")} width={80} visibleRows={5} />);
  expect(lastFrame()).toMatch(/↑\d+ more/);   // rows hidden above
  expect(lastFrame()).not.toContain("↓0");    // no confusing "↓0 more"
});

test("marks the selected check row with a cursor arrow", () => {
  const { lastFrame } = render(<Detail pr={pr} checks={checks} checkCursor={1} focused theme={getTheme("mocha")} width={80} visibleRows={10} />);
  expect(lastFrame()).toMatch(/❯ .*test \(unit\)/);      // arrow on the selected row
  expect((lastFrame()!.match(/❯/g) ?? []).length).toBe(1); // only the selected row
});

test("shows placeholder when no PR selected", () => {
  const { lastFrame } = render(<Detail pr={null} checks={[]} checkCursor={0} focused theme={getTheme("mocha")} width={80} visibleRows={10} />);
  expect(lastFrame()).toMatch(/Select a PR/i);
});

test("shows a merge-conflict line when the PR is CONFLICTING", () => {
  const conflicted: PullRequest = { ...pr, mergeable: "CONFLICTING" };
  const { lastFrame } = render(<Detail pr={conflicted} checks={checks} checkCursor={0} focused theme={getTheme("mocha")} width={80} visibleRows={10} />);
  expect(lastFrame()).toMatch(/⚠ merge conflict/);
});
