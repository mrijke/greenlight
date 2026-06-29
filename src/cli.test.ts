import { expect, test } from "vitest";
import { parseArgs } from "./cli.js";

test("parses --repo and flags", () => {
  expect(parseArgs(["--repo", "a/b"]).repo).toBe("a/b");
  expect(parseArgs(["--help"]).help).toBe(true);
  expect(parseArgs(["--version"]).version).toBe(true);
  expect(parseArgs([]).repo).toBeUndefined();
});
