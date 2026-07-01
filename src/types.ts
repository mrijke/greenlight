export type CheckStatus = "queued" | "in_progress" | "completed";
export type CheckConclusion =
  | "success" | "failure" | "cancelled" | "skipped"
  | "timed_out" | "action_required" | "neutral" | "stale" | "startup_failure" | null;

export interface Check {
  name: string;
  status: CheckStatus;
  conclusion: CheckConclusion;
  detailsUrl: string | null;
  startedAt: string | null;
  completedAt: string | null;
  checkRunId: number | null;     // CheckRun.databaseId — for annotations
  checkSuiteId: number | null;   // CheckSuite.databaseId
  workflowRunId: number | null;  // CheckSuite.workflowRun.databaseId — for rerun/logs
  workflowName: string | null;   // CheckRun workflow display name; null for status contexts
  isStatusContext: boolean;      // legacy commit status vs Actions check run
}

export interface PullRequest {
  number: number;
  title: string;
  headRefName: string;
  baseRefName: string;
  headSha: string;
  url: string;
  isCrossRepository: boolean;    // fork PR
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
}

export interface RepoTarget {
  owner: string;
  repo: string;
  viewerLogin: string;
  viewerCanWrite: boolean;
}

export type FlakyVerdict = "likely_flaky" | "likely_real" | "unclear";

export interface HeuristicResult {
  verdict: FlakyVerdict;
  confidence: number;            // 0..1
  failingStep: string | null;
  errorLines: string[];
  signals: string[];
}

export interface FailureContext {
  jobName: string;
  failingStep: string | null;
  logSlice: string;
  annotations: { path: string; message: string; level: string }[];
  runAttempt: number;
}
