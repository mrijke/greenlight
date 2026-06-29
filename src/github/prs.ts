import type { Octokit } from "octokit";
import type { PullRequest, RepoTarget } from "../types.js";

const QUERY = `
query($q: String!) {
  search(query: $q, type: ISSUE, first: 50) {
    nodes {
      ... on PullRequest {
        number title url isCrossRepository
        headRefName baseRefName headRefOid
      }
    }
  }
}`;

interface SearchNode {
  number: number; title: string; url: string; isCrossRepository: boolean;
  headRefName: string; baseRefName: string; headRefOid: string;
}

export async function listMyOpenPrs(octokit: Pick<Octokit, "graphql">, target: RepoTarget): Promise<PullRequest[]> {
  const q = `repo:${target.owner}/${target.repo} is:pr is:open author:@me sort:updated-desc`;
  const res = await octokit.graphql<{ search: { nodes: SearchNode[] } }>(QUERY, { q });
  return res.search.nodes
    .filter((n) => typeof n.number === "number")
    .map((n) => ({
      number: n.number, title: n.title, url: n.url, isCrossRepository: n.isCrossRepository,
      headRefName: n.headRefName, baseRefName: n.baseRefName, headSha: n.headRefOid,
    }));
}
