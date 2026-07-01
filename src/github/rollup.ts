import type { Check, CheckConclusion, CheckStatus } from "../types.js";

const mapStatus = (s: string): CheckStatus =>
  s === "COMPLETED" ? "completed" : s === "IN_PROGRESS" ? "in_progress" : "queued";
const mapConclusion = (c: string | null): CheckConclusion =>
  (c ? (c.toLowerCase() as CheckConclusion) : null);
// Legacy StatusContext.state: SUCCESS | FAILURE | ERROR | PENDING | EXPECTED
const mapStateStatus = (state: string): CheckStatus => (state === "PENDING" || state === "EXPECTED" ? "in_progress" : "completed");
const mapStateConclusion = (state: string): CheckConclusion =>
  state === "SUCCESS" ? "success" : state === "PENDING" || state === "EXPECTED" ? null : "failure";

export interface RollupCheckRun {
  __typename: "CheckRun";
  name: string;
  status: string;
  conclusion: string | null;
  detailsUrl: string | null;
  startedAt: string | null;
  completedAt: string | null;
  databaseId: number | null;
  checkSuite: { databaseId: number | null; workflowRun: { databaseId: number | null; workflow?: { name: string | null } | null } | null } | null;
}
export interface RollupStatusContext {
  __typename: "StatusContext";
  context: string;
  state: string;
  targetUrl: string | null;
  createdAt: string | null;
}
export type RollupContext = RollupCheckRun | RollupStatusContext;

export function mapRollupContexts(nodes: RollupContext[]): Check[] {
  return nodes.map((n): Check => {
    if (n.__typename === "CheckRun") {
      return {
        name: n.name, status: mapStatus(n.status), conclusion: mapConclusion(n.conclusion),
        detailsUrl: n.detailsUrl ?? null, startedAt: n.startedAt ?? null, completedAt: n.completedAt ?? null,
        checkRunId: n.databaseId ?? null, checkSuiteId: n.checkSuite?.databaseId ?? null,
        workflowRunId: n.checkSuite?.workflowRun?.databaseId ?? null, workflowName: n.checkSuite?.workflowRun?.workflow?.name ?? null, isStatusContext: false,
      };
    }
    return {
      name: n.context, status: mapStateStatus(n.state), conclusion: mapStateConclusion(n.state),
      detailsUrl: n.targetUrl ?? null, startedAt: n.createdAt ?? null, completedAt: null,
      checkRunId: null, checkSuiteId: null, workflowRunId: null, workflowName: null, isStatusContext: true,
    };
  });
}
