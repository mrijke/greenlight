import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { listMyOpenPrs } from "./prs.js";
import type { RepoTarget } from "../types.js";

const fixture = JSON.parse(readFileSync(new URL("../../test/fixtures/prs-search.json", import.meta.url), "utf8"));
const target: RepoTarget = { owner: "acme", repo: "widget", viewerLogin: "me", viewerCanWrite: true };

test("maps GraphQL search results to PullRequest[] and builds the query", async () => {
  const graphql = vi.fn().mockResolvedValue(fixture);
  const prs = await listMyOpenPrs({ graphql } as any, target);
  expect(graphql).toHaveBeenCalledWith(expect.any(String), { q: "repo:acme/widget is:pr is:open author:@me sort:updated-desc" });
  expect(prs[0]).toEqual({ number: 142, title: "Fix auth flow", url: "https://github.com/acme/widget/pull/142", isCrossRepository: false, headRefName: "feat/auth", baseRefName: "main", headSha: "abc123" });
  expect(prs).toHaveLength(2);
});
