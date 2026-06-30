import { expect, test } from "vitest";
import { pathToFileURL } from "node:url";
import { isMainModule, parseArgs } from "./cli.js";

test("parses --repo and flags", () => {
  expect(parseArgs(["--repo", "a/b"]).repo).toBe("a/b");
  expect(parseArgs(["--help"]).help).toBe(true);
  expect(parseArgs(["--version"]).version).toBe(true);
  expect(parseArgs([]).repo).toBeUndefined();
});

const MODULE = "/opt/app/dist/cli.js";
const MODULE_URL = pathToFileURL(MODULE).href;

test("isMainModule: true when a bin symlink resolves to the module file", () => {
  // argv[1] is the installed `gl`/`greenlight` symlink; realpath resolves it
  // to the real module file. This is the npm/Volta install scenario.
  const realpath = (p: string) => (p === "/usr/local/bin/gl" ? MODULE : p);
  expect(isMainModule("/usr/local/bin/gl", MODULE_URL, realpath)).toBe(true);
});

test("isMainModule: true for direct invocation (argv[1] is the module file)", () => {
  expect(isMainModule(MODULE, MODULE_URL, (p) => p)).toBe(true);
});

test("isMainModule: false when imported by an unrelated runner", () => {
  expect(isMainModule("/opt/app/node_modules/.bin/vitest", MODULE_URL, (p) => p)).toBe(false);
});

test("isMainModule: false when argv[1] is missing", () => {
  expect(isMainModule(undefined, MODULE_URL)).toBe(false);
});
