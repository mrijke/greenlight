import type { Octokit } from "octokit";
import type { Check, RepoTarget } from "../types.js";
import { mapRollupContexts, type RollupContext } from "./rollup.js";

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
  return mapRollupContexts(rollup?.contexts?.nodes ?? []);
}
