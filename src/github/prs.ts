import type { Octokit } from "octokit";
import type { Check, PullRequest, RepoTarget } from "../types.js";
import { mapRollupContexts, type RollupContext } from "./rollup.js";

const QUERY = `
query($q: String!) {
  search(query: $q, type: ISSUE, first: 50) {
    nodes {
      ... on PullRequest {
        number title url isCrossRepository mergeable
        headRefName baseRefName headRefOid
        commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 50) { nodes {
          __typename
          ... on CheckRun {
            name status conclusion detailsUrl startedAt completedAt databaseId
            checkSuite { databaseId workflowRun { databaseId } }
          }
          ... on StatusContext { context state targetUrl createdAt }
        } } } } } }
      }
    }
  }
}`;

interface SearchNode {
  number: number; title: string; url: string; isCrossRepository: boolean;
  mergeable: PullRequest["mergeable"];
  headRefName: string; baseRefName: string; headRefOid: string;
  commits: { nodes: { commit: { statusCheckRollup: { contexts: { nodes: RollupContext[] } } | null } }[] } | null;
}

const rollupNodes = (n: SearchNode): RollupContext[] =>
  n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? [];

export async function listMyOpenPrs(
  octokit: Pick<Octokit, "graphql">, target: RepoTarget,
): Promise<{ prs: PullRequest[]; checks: Record<number, Check[]> }> {
  const q = `repo:${target.owner}/${target.repo} is:pr is:open author:@me sort:updated-desc`;
  const res = await octokit.graphql<{ search: { nodes: SearchNode[] } }>(QUERY, { q });
  const prs: PullRequest[] = [];
  const checks: Record<number, Check[]> = {};
  for (const n of res.search.nodes) {
    if (typeof n.number !== "number") continue;
    prs.push({
      number: n.number, title: n.title, url: n.url, isCrossRepository: n.isCrossRepository,
      mergeable: n.mergeable, headRefName: n.headRefName, baseRefName: n.baseRefName, headSha: n.headRefOid,
    });
    checks[n.number] = mapRollupContexts(rollupNodes(n));
  }
  return { prs, checks };
}
