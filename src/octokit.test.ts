import { expect, test } from "vitest";
import { createOctokit } from "./octokit.js";

test("creates an Octokit with graphql + rest available", () => {
  const o = createOctokit("ght_test");
  expect(typeof o.graphql).toBe("function");
  expect(typeof o.rest.actions.reRunWorkflowFailedJobs).toBe("function");
});
