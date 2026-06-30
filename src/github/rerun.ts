import type { Octokit } from "octokit";
import type { Check, RepoTarget } from "../types.js";

const FAILED: ReadonlySet<string> = new Set(["failure", "timed_out", "startup_failure", "cancelled"]);

export const isFailedConclusion = (c: Check["conclusion"]): boolean => c != null && FAILED.has(c);

export function failedRunIds(checks: Check[]): number[] {
  const ids = new Set<number>();
  for (const c of checks) {
    if (c.workflowRunId != null && isFailedConclusion(c.conclusion)) ids.add(c.workflowRunId);
  }
  return [...ids];
}

// Spec §3/§6: rerun requires the run to be completed and the latest attempt.
// The GraphQL rollup already surfaces only the latest attempt's checks per name,
// so a workflowRunId seen here is already the latest attempt. What can still
// disqualify a rerun is a run whose jobs have not all reached a terminal state
// (rerunning while pending → 403/409). We surface that as a named reason
// rather than letting the API fail with an opaque 403.
export function canRerun(checks: Check[]): { ok: boolean; reason?: string } {
  const failed = failedRunIds(checks);
  if (failed.length === 0) return { ok: false, reason: "no failed checks to rerun" };
  const pendingRuns = new Set<number>();
  for (const c of checks) {
    if (c.workflowRunId != null && c.status !== "completed") pendingRuns.add(c.workflowRunId);
  }
  const blocked = failed.find((id) => pendingRuns.has(id));
  if (blocked != null) return { ok: false, reason: `run ${blocked} still in progress` };
  return { ok: true };
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
