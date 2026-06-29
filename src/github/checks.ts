import type { Octokit } from "octokit";
import type { Check, CheckConclusion, CheckStatus, RepoTarget } from "../types.js";

const QUERY = `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
        __typename
        ... on CheckRun {
          name status conclusion detailsUrl startedAt completedAt databaseId
          checkSuite { databaseId workflowRun { databaseId } }
        }
        ... on StatusContext { context state targetUrl createdAt }
      } } } } } }
    }
  }
}`;

const mapStatus = (s: string): CheckStatus =>
  s === "COMPLETED" ? "completed" : s === "IN_PROGRESS" ? "in_progress" : "queued";
const mapConclusion = (c: string | null): CheckConclusion =>
  (c ? (c.toLowerCase() as CheckConclusion) : null);
// Legacy StatusContext.state: SUCCESS | FAILURE | ERROR | PENDING | EXPECTED
const mapStateStatus = (state: string): CheckStatus => (state === "PENDING" || state === "EXPECTED" ? "in_progress" : "completed");
const mapStateConclusion = (state: string): CheckConclusion =>
  state === "SUCCESS" ? "success" : state === "PENDING" || state === "EXPECTED" ? null : "failure";

interface RollupCheckRun {
  __typename: "CheckRun";
  name: string;
  status: string;
  conclusion: string | null;
  detailsUrl: string | null;
  startedAt: string | null;
  completedAt: string | null;
  databaseId: number | null;
  checkSuite: { databaseId: number | null; workflowRun: { databaseId: number | null } | null } | null;
}
interface RollupStatusContext {
  __typename: "StatusContext";
  context: string;
  state: string;
  targetUrl: string | null;
  createdAt: string | null;
}
type RollupContext = RollupCheckRun | RollupStatusContext;
interface ChecksResponse {
  repository: {
    pullRequest: {
      commits: { nodes: { commit: { statusCheckRollup: { contexts: { nodes: RollupContext[] } } | null } }[] };
    } | null;
  } | null;
}

export async function fetchChecks(octokit: Pick<Octokit, "graphql">, target: RepoTarget, prNumber: number): Promise<Check[]> {
  const res = await octokit.graphql<ChecksResponse>(QUERY, { owner: target.owner, repo: target.repo, number: prNumber });
  const rollup = res.repository?.pullRequest?.commits?.nodes?.[0]?.commit?.statusCheckRollup;
  const nodes: RollupContext[] = rollup?.contexts?.nodes ?? [];
  return nodes.map((n): Check => {
    if (n.__typename === "CheckRun") {
      return {
        name: n.name, status: mapStatus(n.status), conclusion: mapConclusion(n.conclusion),
        detailsUrl: n.detailsUrl ?? null, startedAt: n.startedAt ?? null, completedAt: n.completedAt ?? null,
        checkRunId: n.databaseId ?? null, checkSuiteId: n.checkSuite?.databaseId ?? null,
        workflowRunId: n.checkSuite?.workflowRun?.databaseId ?? null, isStatusContext: false,
      };
    }
    return {
      name: n.context, status: mapStateStatus(n.state), conclusion: mapStateConclusion(n.state),
      detailsUrl: n.targetUrl ?? null, startedAt: n.createdAt ?? null, completedAt: null,
      checkRunId: null, checkSuiteId: null, workflowRunId: null, isStatusContext: true,
    };
  });
}
