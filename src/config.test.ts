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
