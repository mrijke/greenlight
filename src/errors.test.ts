import { expect, test } from "vitest";
import { errorMessage, httpStatus } from "./errors.js";

test("errorMessage extracts message or stringifies", () => {
  expect(errorMessage(new Error("boom"))).toBe("boom");
  expect(errorMessage("plain")).toBe("plain");
  expect(errorMessage(42)).toBe("42");
});

test("httpStatus reads numeric status when present", () => {
  expect(httpStatus(Object.assign(new Error("x"), { status: 410 }))).toBe(410);
  expect(httpStatus({ status: "nope" })).toBeUndefined();
  expect(httpStatus(new Error("x"))).toBeUndefined();
  expect(httpStatus(null)).toBeUndefined();
});
