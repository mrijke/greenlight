import { expect, test } from "vitest";
import { classify } from "./heuristic.js";
import type { Check, FailureContext } from "../types.js";

const baseCheck: Check = { name: "test", status: "completed", conclusion: "failure", detailsUrl: null, startedAt: null, completedAt: null, checkRunId: 1, checkSuiteId: 1, workflowRunId: 1, isStatusContext: false };
const ctx = (over: Partial<FailureContext>): FailureContext => ({ jobName: "test", failingStep: "Run tests", logSlice: "", annotations: [], runAttempt: 1, ...over });

test("network timeout reads as likely flaky", () => {
  const r = classify(ctx({ logSlice: "Error: connect ETIMEDOUT 10.0.0.1:443\nnpm ERR! network" }), baseCheck);
  expect(r.verdict).toBe("likely_flaky");
  expect(r.signals).toContain("network");
});

test("OOM / exit 137 reads as likely flaky (infra)", () => {
  const r = classify(ctx({ logSlice: "Container killed\nProcess completed with exit code 137." }), baseCheck);
  expect(r.verdict).toBe("likely_flaky");
  expect(r.signals).toContain("oom");
});

test("assertion failure reads as likely real", () => {
  const r = classify(ctx({ logSlice: "AssertionError: expected 1 to equal 2\n  at test.spec.ts:10" }), baseCheck);
  expect(r.verdict).toBe("likely_real");
  expect(r.signals).toContain("assertion");
});

test("compile/type error reads as likely real", () => {
  const r = classify(ctx({ logSlice: "src/x.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'." }), baseCheck);
  expect(r.verdict).toBe("likely_real");
});

test("retry attempt with no strong signal nudges toward flaky", () => {
  const r = classify(ctx({ logSlice: "some unrecognized failure output", runAttempt: 3 }), baseCheck);
  expect(r.signals).toContain("retried");
});

test("no recognizable signal is unclear", () => {
  const r = classify(ctx({ logSlice: "totally opaque failure" }), baseCheck);
  expect(r.verdict).toBe("unclear");
  expect(r.errorLines.length).toBeGreaterThan(0);
});
