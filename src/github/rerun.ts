import type { Octokit } from "octokit";
import type { Check, RepoTarget } from "../types.js";

const FAILED: ReadonlySet<string> = new Set(["failure", "timed_out", "startup_failure", "cancelled"]);

export function failedRunIds(checks: Check[]): number[] {
  const ids = new Set<number>();
  for (const c of checks) {
    if (c.workflowRunId != null && c.conclusion && FAILED.has(c.conclusion)) ids.add(c.workflowRunId);
  }
  return [...ids];
}

export async function rerunFailed(
  octokit: Pick<Octokit, "rest">, target: RepoTarget, checks: Check[],
): Promise<{ rerun: number[] }> {
  const ids = failedRunIds(checks);
  for (const run_id of ids) {
    await octokit.rest.actions.reRunWorkflowFailedJobs({ owner: target.owner, repo: target.repo, run_id });
  }
  return { rerun: ids };
}
