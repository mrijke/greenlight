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

export async function fetchChecks(octokit: Pick<Octokit, "graphql">, target: RepoTarget, prNumber: number): Promise<Check[]> {
  const res = await octokit.graphql<any>(QUERY, { owner: target.owner, repo: target.repo, number: prNumber });
  const rollup = res?.repository?.pullRequest?.commits?.nodes?.[0]?.commit?.statusCheckRollup;
  const nodes: any[] = rollup?.contexts?.nodes ?? [];
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
