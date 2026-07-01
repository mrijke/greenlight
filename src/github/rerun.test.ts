import { expect, test, vi } from "vitest";
import type { Octokit } from "octokit";
import { canRerun, failedRunIds, rerunFailed } from "./rerun.js";
import type { Check, RepoTarget } from "../types.js";

const target: RepoTarget = { owner: "acme", repo: "widget", viewerLogin: "me", viewerCanWrite: true };
const mk = (over: Partial<Check>): Check => ({ name: "c", status: "completed", conclusion: "success", detailsUrl: null, startedAt: null, completedAt: null, checkRunId: null, checkSuiteId: null, workflowRunId: null, workflowName: null, isStatusContext: false, ...over });

test("failedRunIds dedups runs and ignores passing/non-failure checks", () => {
  const checks = [
    mk({ conclusion: "failure", workflowRunId: 501 }),
    mk({ conclusion: "failure", workflowRunId: 501 }),
    mk({ conclusion: "timed_out", workflowRunId: 777 }),
    mk({ conclusion: "success", workflowRunId: 900 }),
  ];
  expect(failedRunIds(checks)).toEqual([501, 777]);
});

test("rerunFailed calls reRunWorkflowFailedJobs once per failed run", async () => {
  const reRunWorkflowFailedJobs = vi.fn().mockResolvedValue({});
  const octokit = { rest: { actions: { reRunWorkflowFailedJobs } } } as unknown as Pick<Octokit, "rest">;
  const res = await rerunFailed(octokit, target, [mk({ conclusion: "failure", workflowRunId: 501 }), mk({ conclusion: "failure", workflowRunId: 777 })]);
  expect(res.rerun).toEqual([501, 777]);
  expect(reRunWorkflowFailedJobs).toHaveBeenCalledTimes(2);
  expect(reRunWorkflowFailedJobs).toHaveBeenCalledWith({ owner: "acme", repo: "widget", run_id: 501 });
});

test("canRerun refuses when no failed checks", () => {
  expect(canRerun([mk({ conclusion: "success", workflowRunId: 501 })])).toEqual({ ok: false, reason: "no failed checks to rerun" });
});

test("canRerun refuses when a failed run still has pending jobs", () => {
  const checks = [
    mk({ name: "build", conclusion: "success", workflowRunId: 501 }),
    mk({ name: "test", conclusion: "failure", workflowRunId: 501 }),
    mk({ name: "lint", status: "in_progress", conclusion: null, workflowRunId: 501 }),
  ];
  const r = canRerun(checks);
  expect(r.ok).toBe(false);
  expect(r.reason).toMatch(/still in progress/);
});

test("canRerun ok when failed run is fully terminal", () => {
  const checks = [
    mk({ name: "build", conclusion: "success", workflowRunId: 501 }),
    mk({ name: "test", conclusion: "failure", workflowRunId: 501 }),
    mk({ name: "lint", conclusion: "skipped", workflowRunId: 501 }),
  ];
  expect(canRerun(checks)).toEqual({ ok: true });
});
