import { expect, test } from "vitest";
import type { Check } from "./types.js";
test("types module imports", () => {
  const c: Check = { name: "x", status: "completed", conclusion: "success", detailsUrl: null, startedAt: null, completedAt: null, checkRunId: null, checkSuiteId: null, workflowRunId: null, isStatusContext: false };
  expect(c.name).toBe("x");
});
