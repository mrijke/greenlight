import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import type { Octokit } from "octokit";
import { listMyOpenPrs } from "./prs.js";
import type { RepoTarget } from "../types.js";

const fixture = JSON.parse(readFileSync(new URL("../../test/fixtures/prs-search.json", import.meta.url), "utf8"));
const target: RepoTarget = { owner: "acme", repo: "widget", viewerLogin: "me", viewerCanWrite: true };

test("maps search results to { prs, checks }, mergeable, and builds the query", async () => {
  const graphql = vi.fn().mockResolvedValue(fixture);
  const { prs, checks } = await listMyOpenPrs({ graphql } as unknown as Pick<Octokit, "graphql">, target);
  expect(graphql).toHaveBeenCalledWith(expect.any(String), { q: "repo:acme/widget is:pr is:open author:@me sort:updated-desc" });
  expect(prs[0]).toEqual({ number: 142, title: "Fix auth flow", url: "https://github.com/acme/widget/pull/142", isCrossRepository: false, mergeable: "CONFLICTING", reviewDecision: "APPROVED", headRefName: "feat/auth", baseRefName: "main", headSha: "abc123" });
  expect(prs).toHaveLength(2);
  expect(checks[142]).toHaveLength(2);
  expect(checks[142].find((c) => c.name === "test")?.conclusion).toBe("failure");
  expect(checks[142].find((c) => c.name === "test")?.workflowRunId).toBe(501); // full fields → rerun works on fresh select (S4/S3)
  expect(checks[138]).toEqual([]);       // null rollup → no checks
  expect(prs[1].mergeable).toBe("MERGEABLE");
  expect(prs[1].reviewDecision).toBe(null);
});
