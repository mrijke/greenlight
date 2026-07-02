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

test("mocha has a conflict token distinct from flag", () => {
  const t = getTheme("mocha");
  expect(t.conflict).toBeTruthy();
  expect(t.conflict).not.toBe(t.flag);
});

test("mocha has an approved token distinct from pass and conflict", () => {
  const t = getTheme("mocha");
  expect(t.approved).toBeTruthy();
  expect(t.approved).not.toBe(t.pass);
  expect(t.approved).not.toBe(t.conflict);
});
