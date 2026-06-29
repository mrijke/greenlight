import { expect, test } from "vitest";
import { getTheme } from "./theme.js";

test("mocha palette has the documented hues", () => {
  const t = getTheme("mocha");
  expect(t.pass).toBe("#a6e3a1");
  expect(t.fail).toBe("#f38ba8");
  expect(t.title).toBe("#cba6f7");
});

test("unknown theme falls back to mocha", () => {
  expect(getTheme("does-not-exist").name).toBe("mocha");
});
