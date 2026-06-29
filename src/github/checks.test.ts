import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import type { Octokit } from "octokit";
import { fetchChecks } from "./checks.js";
import type { RepoTarget } from "../types.js";

const fixture = JSON.parse(readFileSync(new URL("../../test/fixtures/rollup.json", import.meta.url), "utf8"));
const target: RepoTarget = { owner: "acme", repo: "widget", viewerLogin: "me", viewerCanWrite: true };

test("normalizes check runs and legacy status contexts", async () => {
  const graphql = vi.fn().mockResolvedValue(fixture);
  const checks = await fetchChecks({ graphql } as unknown as Pick<Octokit, "graphql">, target, 142);
  expect(checks).toHaveLength(3);
  const fail = checks.find((c) => c.name === "test (unit)")!;
  expect(fail.conclusion).toBe("failure");
  expect(fail.workflowRunId).toBe(501);
  expect(fail.checkRunId).toBe(12);
  expect(fail.isStatusContext).toBe(false);
  const legacy = checks.find((c) => c.name === "ci/legacy")!;
  expect(legacy.isStatusContext).toBe(true);
  expect(legacy.conclusion).toBe("success");
  expect(legacy.status).toBe("completed");
});

test("empty rollup yields no checks", async () => {
  const graphql = vi.fn().mockResolvedValue({ repository: { pullRequest: { commits: { nodes: [{ commit: { statusCheckRollup: null } }] } } } });
  expect(await fetchChecks({ graphql } as unknown as Pick<Octokit, "graphql">, target, 1)).toEqual([]);
});
