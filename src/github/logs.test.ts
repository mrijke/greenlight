import { expect, test, vi } from "vitest";
import { fetchFailureContext, trimLog } from "./logs.js";
import type { Check, RepoTarget } from "../types.js";

const target: RepoTarget = { owner: "acme", repo: "widget", viewerLogin: "me", viewerCanWrite: true };
const check: Check = { name: "test (unit)", status: "completed", conclusion: "failure", detailsUrl: null, startedAt: null, completedAt: null, checkRunId: 12, checkSuiteId: 91, workflowRunId: 501, isStatusContext: false };

test("trimLog keeps the tail within maxLines", () => {
  const raw = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");
  const out = trimLog(raw, 10).split("\n");
  expect(out).toHaveLength(10);
  expect(out.at(-1)).toBe("line 499");
});

test("fetchFailureContext picks the matching failed job, trims, and reads annotations", async () => {
  const octokit: any = { rest: { actions: {
    listJobsForWorkflowRun: vi.fn().mockResolvedValue({ data: { jobs: [
      { name: "build", conclusion: "success", steps: [], run_attempt: 1 },
      { id: 999, name: "test (unit)", conclusion: "failure", run_attempt: 1, steps: [ { name: "Run tests", conclusion: "failure" } ] },
    ] } }),
    downloadJobLogsForWorkflowRun: vi.fn().mockResolvedValue({ data: "AssertionError: expected 1 to equal 2\nstack..." }),
  }, checks: {
    listAnnotations: vi.fn().mockResolvedValue({ data: [ { path: "a.ts", message: "boom", annotation_level: "failure" } ] }),
  } } };
  const ctx = await fetchFailureContext(octokit, target, check);
  expect(ctx.jobName).toBe("test (unit)");
  expect(ctx.failingStep).toBe("Run tests");
  expect(ctx.logSlice).toContain("AssertionError");
  expect(ctx.annotations[0]).toEqual({ path: "a.ts", message: "boom", level: "failure" });
  expect(ctx.runAttempt).toBe(1);
});

test("fetchFailureContext surfaces expired logs (410)", async () => {
  const octokit: any = { rest: { actions: {
    listJobsForWorkflowRun: vi.fn().mockResolvedValue({ data: { jobs: [ { id: 999, name: "test (unit)", conclusion: "failure", run_attempt: 2, steps: [] } ] } }),
    downloadJobLogsForWorkflowRun: vi.fn().mockRejectedValue(Object.assign(new Error("Gone"), { status: 410 })),
  }, checks: { listAnnotations: vi.fn().mockResolvedValue({ data: [] }) } } };
  await expect(fetchFailureContext(octokit, target, check)).rejects.toThrow(/logs expired/);
});
