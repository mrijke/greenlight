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
  // look up by title so this bucketing test doesn't depend on sort order (covered separately)
  const a = groups.find((g) => g.title === "Project A")!;
  const b = groups.find((g) => g.title === "Project B")!;
  expect(groups).toHaveLength(2);
  expect(a.checks.map((c) => c.name)).toEqual(["build", "lint"]); // push order preserved
  expect(a.counts).toEqual({ pass: 2, fail: 0, pending: 0 });
  expect(b.status).toBe("fail");
});

test("two workflows sharing a name stay separate groups (keyed by run id)", () => {
  const groups = groupChecks([
    mk({ name: "ci-cd", workflowRunId: 10, workflowName: "CI" }),
    mk({ name: "ci-cd", workflowRunId: 11, workflowName: "CI" }),
  ]);
  expect(groups).toHaveLength(2);
});

test("groups of equal status (incl. 'Other') sort alphabetically by title", () => {
  const groups = groupChecks([
    mk({ name: "vercel", workflowRunId: null, workflowName: null }),
    mk({ name: "build", workflowRunId: 5, workflowName: "Zeta" }),
    mk({ name: "build", workflowRunId: 3, workflowName: "Alpha" }),
  ]);
  // all passing → same status rank → title order; "Other" is no longer pinned last
  expect(groups.map((g) => g.title)).toEqual(["Alpha", "Other", "Zeta"]);
});

test("groups sort by status first (fail, then pending, then pass, then skip), title breaking ties", () => {
  const groups = groupChecks([
    mk({ name: "z", workflowRunId: 1, workflowName: "Zeta-pass", conclusion: "success" }),
    mk({ name: "a", workflowRunId: 2, workflowName: "Alpha-pass", conclusion: "success" }),
    mk({ name: "w", workflowRunId: 3, workflowName: "Whiskey-fail", conclusion: "failure" }),
    mk({ name: "p", workflowRunId: 4, workflowName: "Papa-run", status: "in_progress", conclusion: null }),
    mk({ name: "s", workflowRunId: 5, workflowName: "Sierra-skip", conclusion: "skipped" }),
  ]);
  expect(groups.map((g) => g.title)).toEqual([
    "Whiskey-fail",  // fail
    "Papa-run",      // pending
    "Alpha-pass",    // pass (alphabetical before Zeta-pass)
    "Zeta-pass",     // pass
    "Sierra-skip",   // skip, last
  ]);
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
