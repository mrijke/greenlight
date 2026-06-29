import type { Octokit } from "octokit";
import type { Check, FailureContext, RepoTarget } from "../types.js";
import { httpStatus } from "../errors.js";

interface JobStep {
  name: string;
  conclusion: string | null;
}
interface WorkflowJob {
  id: number;
  name: string;
  conclusion: string | null;
  run_attempt?: number;
  steps?: JobStep[];
}

export function trimLog(raw: string, maxLines = 200): string {
  const lines = raw.split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - maxLines)).join("\n");
}

export async function fetchFailureContext(octokit: Pick<Octokit, "rest">, target: RepoTarget, check: Check): Promise<FailureContext> {
  if (check.workflowRunId == null) throw new Error("This check has no associated workflow run (no logs available).");
  const { owner, repo } = target;
  const { data } = await octokit.rest.actions.listJobsForWorkflowRun({ owner, repo, run_id: check.workflowRunId, per_page: 100 });
  const jobs: WorkflowJob[] = data.jobs ?? [];
  const failed = jobs.filter((j) => j.conclusion === "failure" || j.conclusion === "timed_out");
  const job = failed.find((j) => j.name === check.name) ?? failed[0] ?? jobs[0];
  if (!job) throw new Error("No jobs found for this run.");

  const failingStep = (job.steps ?? []).find((s) => s.conclusion === "failure" || s.conclusion === "timed_out")?.name ?? null;

  let logSlice = "";
  try {
    const res = await octokit.rest.actions.downloadJobLogsForWorkflowRun({ owner, repo, job_id: job.id });
    logSlice = trimLog(typeof res.data === "string" ? res.data : String(res.data ?? ""));
  } catch (err) {
    if (httpStatus(err) === 410) throw new Error("logs expired for this run");
    throw err;
  }

  let annotations: FailureContext["annotations"] = [];
  if (check.checkRunId != null) {
    const { data: ann } = await octokit.rest.checks.listAnnotations({ owner, repo, check_run_id: check.checkRunId, per_page: 50 });
    annotations = ann.map((a) => ({ path: a.path, message: a.message ?? "", level: a.annotation_level ?? "notice" }));
  }

  return { jobName: job.name, failingStep, logSlice, annotations, runAttempt: job.run_attempt ?? 1 };
}
