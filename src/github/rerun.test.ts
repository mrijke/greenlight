import { expect, test, vi } from "vitest";
import type { Octokit } from "octokit";
import { failedRunIds, rerunFailed } from "./rerun.js";
import type { Check, RepoTarget } from "../types.js";

const target: RepoTarget = { owner: "acme", repo: "widget", viewerLogin: "me", viewerCanWrite: true };
const mk = (over: Partial<Check>): Check => ({ name: "c", status: "completed", conclusion: "success", detailsUrl: null, startedAt: null, completedAt: null, checkRunId: null, checkSuiteId: null, workflowRunId: null, isStatusContext: false, ...over });

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
