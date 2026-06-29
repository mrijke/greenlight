import { expect, test } from "vitest";
import { loadConfig } from "./config.js";

test("defaults when nothing provided", () => {
  const c = loadConfig({ fileText: null, env: {} });
  expect(c.theme).toBe("mocha");
  expect(c.pollChecksMs).toBe(10000);
  expect(c.pollListMs).toBe(30000);
  expect(c.llm.baseURL).toBe("https://models.github.ai/inference");
});

test("file < env < flags precedence", () => {
  const c = loadConfig({
    fileText: JSON.stringify({ theme: "mocha", repo: "f/file", llm: { model: "from-file" } }),
    env: { GREENLIGHT_REPO: "e/env", LLM_MODEL: "from-env" },
    flags: { repo: "x/flag" },
  });
  expect(c.repo).toBe("x/flag");      // flag wins
  expect(c.llm.model).toBe("from-env"); // env wins over file
});

test("invalid JSON file falls back to defaults", () => {
  const c = loadConfig({ fileText: "{ not json", env: {} });
  expect(c.theme).toBe("mocha");
});

test("env poll-interval overrides beat file and defaults", () => {
  const c = loadConfig({
    fileText: JSON.stringify({ pollListMs: 20000, pollChecksMs: 5000 }),
    env: { GREENLIGHT_POLL_LIST_MS: "15000", GREENLIGHT_POLL_CHECKS_MS: "7000" },
  });
  expect(c.pollListMs).toBe(15000);
  expect(c.pollChecksMs).toBe(7000);
});

test("non-numeric or non-positive env poll values are ignored", () => {
  const c = loadConfig({ fileText: JSON.stringify({ pollListMs: 20000 }), env: { GREENLIGHT_POLL_LIST_MS: "oops", GREENLIGHT_POLL_CHECKS_MS: "0" } });
  expect(c.pollListMs).toBe(20000);
  expect(c.pollChecksMs).toBe(10000);
});
