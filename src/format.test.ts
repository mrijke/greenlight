import { expect, test } from "vitest";
import { checkCounts, formatDuration, glyph, truncate, windowRows } from "./format.js";
import type { Check } from "./types.js";

const mk = (o: Partial<Check>): Check => ({ name: "c", status: "completed", conclusion: "success", detailsUrl: null, startedAt: null, completedAt: null, checkRunId: null, checkSuiteId: null, workflowRunId: null, isStatusContext: false, ...o });

test("glyph reflects state", () => {
  expect(glyph(mk({ conclusion: "success" }))).toBe("✓");
  expect(glyph(mk({ conclusion: "failure" }))).toBe("✗");
  expect(glyph(mk({ status: "in_progress", conclusion: null }))).toBe("•");
  expect(glyph(mk({ conclusion: "skipped" }))).toBe("⊘");
});

test("formatDuration", () => {
  expect(formatDuration("2026-06-29T10:00:00Z", "2026-06-29T10:01:12Z")).toBe("1m12s");
  expect(formatDuration("2026-06-29T10:00:00Z", null)).toBe("running");
  expect(formatDuration(null, null)).toBe("—");
});

test("truncate adds ellipsis", () => {
  expect(truncate("hello world", 5)).toBe("hell…");
  expect(truncate("hi", 5)).toBe("hi");
});

test("windowRows keeps cursor visible", () => {
  const items = Array.from({ length: 20 }, (_, i) => i);
  const { rows, offset } = windowRows(items, 15, 5);
  expect(rows).toHaveLength(5);
  expect(rows.includes(15)).toBe(true);
  expect(offset).toBeLessThanOrEqual(15);
});

test("checkCounts tallies", () => {
  const c = checkCounts([mk({ conclusion: "success" }), mk({ conclusion: "failure" }), mk({ status: "in_progress", conclusion: null })]);
  expect(c).toEqual({ pass: 1, fail: 1, pending: 1 });
});
