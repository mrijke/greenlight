import { expect, test } from "vitest";
import { mapRollupContexts, type RollupContext } from "./rollup.js";

const nodes: RollupContext[] = [
  { __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "https://x/1", startedAt: "2026-06-29T10:00:00Z", completedAt: "2026-06-29T10:01:12Z", databaseId: 11, checkSuite: { databaseId: 91, workflowRun: { databaseId: 501 } } },
  { __typename: "CheckRun", name: "test (unit)", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: null, startedAt: null, completedAt: null, databaseId: 12, checkSuite: { databaseId: 91, workflowRun: { databaseId: 501 } } },
  { __typename: "StatusContext", context: "ci/legacy", state: "SUCCESS", targetUrl: "https://x/3", createdAt: "2026-06-29T10:00:00Z" },
];

test("maps check runs and legacy status contexts to Check[]", () => {
  const checks = mapRollupContexts(nodes);
  expect(checks).toHaveLength(3);
  const fail = checks.find((c) => c.name === "test (unit)")!;
  expect(fail.conclusion).toBe("failure");
  expect(fail.workflowRunId).toBe(501);
  expect(fail.checkRunId).toBe(12);
  expect(fail.isStatusContext).toBe(false);
  const legacy = checks.find((c) => c.name === "ci/legacy")!;
  expect(legacy.isStatusContext).toBe(true);
  expect(legacy.conclusion).toBe("success");
  expect(legacy.status).toBe("completed");
});

test("empty nodes yields no checks", () => {
  expect(mapRollupContexts([])).toEqual([]);
});

test("maps workflow name from CheckRun and null for status contexts", () => {
  const checks = mapRollupContexts([
    { __typename: "CheckRun", name: "ci-cd", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: null, startedAt: null, completedAt: null, databaseId: 21, checkSuite: { databaseId: 91, workflowRun: { databaseId: 700, workflow: { name: "Project A" } } } },
    { __typename: "StatusContext", context: "ci/legacy", state: "SUCCESS", targetUrl: null, createdAt: null },
  ]);
  expect(checks[0].workflowName).toBe("Project A");
  expect(checks[0].workflowRunId).toBe(700);
  expect(checks[1].workflowName).toBeNull();
});
