import { expect, test } from "vitest";
import { groupChecks, flattenRows, deriveExpanded, rowId, groupGlyph } from "./checkGroups.js";
import type { Check } from "../types.js";

const mk = (o: Partial<Check>): Check => ({ name: "c", status: "completed", conclusion: "success", detailsUrl: null, startedAt: null, completedAt: null, checkRunId: null, checkSuiteId: null, workflowRunId: null, isStatusContext: false, workflowName: null, ...o });

test("groups checks by workflowRunId and titles them by workflow name", () => {
  const groups = groupChecks([
    mk({ name: "build", workflowRunId: 1, workflowName: "Project A", conclusion: "success" }),
    mk({ name: "lint", workflowRunId: 1, workflowName: "Project A", conclusion: "success" }),
    mk({ name: "ci-cd", workflowRunId: 2, workflowName: "Project B", conclusion: "failure" }),
  ]);
  expect(groups.map((g) => g.title)).toEqual(["Project A", "Project B"]);
  expect(groups[0].checks.map((c) => c.name)).toEqual(["build", "lint"]); // push order preserved
  expect(groups[0].counts).toEqual({ pass: 2, fail: 0, pending: 0 });
  expect(groups[1].status).toBe("fail");
});

test("two workflows sharing a name stay separate groups (keyed by run id)", () => {
  const groups = groupChecks([
    mk({ name: "ci-cd", workflowRunId: 10, workflowName: "CI" }),
    mk({ name: "ci-cd", workflowRunId: 11, workflowName: "CI" }),
  ]);
  expect(groups).toHaveLength(2);
});

test("workflow-less checks collect into an 'Other' group sorted last, rest alphabetical", () => {
  const groups = groupChecks([
    mk({ name: "vercel", workflowRunId: null, workflowName: null }),
    mk({ name: "build", workflowRunId: 5, workflowName: "Zeta" }),
    mk({ name: "build", workflowRunId: 3, workflowName: "Alpha" }),
  ]);
  expect(groups.map((g) => g.title)).toEqual(["Alpha", "Zeta", "Other"]);
});

test("a group of only skipped checks reads as skip with a ⊘ glyph", () => {
  const groups = groupChecks([mk({ workflowRunId: 1, workflowName: "S", conclusion: "skipped" })]);
  expect(groups[0].status).toBe("skip");
  expect(groupGlyph(groups[0].status)).toBe("⊘");
});

test("flattenRows emits children only for expanded groups", () => {
  const groups = groupChecks([
    mk({ name: "a", workflowRunId: 1, workflowName: "One" }),
    mk({ name: "b", workflowRunId: 2, workflowName: "Two" }),
  ]);
  expect(flattenRows(groups, new Set()).map((r) => r.kind)).toEqual(["header", "header"]);
  expect(flattenRows(groups, new Set(["1"])).map((r) => r.kind)).toEqual(["header", "check", "header"]);
});

test("deriveExpanded opens failing groups by default", () => {
  const groups = groupChecks([
    mk({ workflowRunId: 1, workflowName: "Fails", conclusion: "failure" }),
    mk({ workflowRunId: 2, workflowName: "Passes", conclusion: "success" }),
  ]);
  expect(deriveExpanded(groups, new Map())).toEqual(new Set(["1"]));
});

test("overrides win: collapsed keeps a failing group closed, expanded keeps a green group open", () => {
  const groups = groupChecks([
    mk({ workflowRunId: 1, workflowName: "Fails", conclusion: "failure" }),
    mk({ workflowRunId: 2, workflowName: "Passes", conclusion: "success" }),
  ]);
  const overrides = new Map<string, "expanded" | "collapsed">([["1", "collapsed"], ["2", "expanded"]]);
  expect(deriveExpanded(groups, overrides)).toEqual(new Set(["2"]));
});

test("a flake re-opens from status alone (no override) on each new failure", () => {
  const failing = groupChecks([mk({ workflowRunId: 1, workflowName: "Flaky", conclusion: "failure" })]);
  const passing = groupChecks([mk({ workflowRunId: 1, workflowName: "Flaky", conclusion: "success" })]);
  expect(deriveExpanded(failing, new Map())).toEqual(new Set(["1"]));
  expect(deriveExpanded(passing, new Map())).toEqual(new Set());
  expect(deriveExpanded(failing, new Map())).toEqual(new Set(["1"]));
});

test("rowId is stable per header key and per check", () => {
  const groups = groupChecks([mk({ name: "build", workflowRunId: 1, workflowName: "One", checkRunId: 99 })]);
  const rows = flattenRows(groups, new Set(["1"]));
  expect(rowId(rows[0])).toBe("h:1");
  expect(rowId(rows[1])).toBe("c:99");
});
