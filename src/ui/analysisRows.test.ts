import { expect, test } from "vitest";
import { analysisWindow, countAnalysisRows } from "./analysisRows.js";
import type { HeuristicResult } from "../types.js";

const base: HeuristicResult = { verdict: "likely_flaky", confidence: 0.7, failingStep: null, errorLines: [], signals: [] };

test("countAnalysisRows: verdict line alone is one row", () => {
  expect(countAnalysisRows({ heuristic: base, llmText: null, llmLoading: false, llmError: null })).toBe(1);
});

test("countAnalysisRows: sums step, error lines, spinner, multi-line llm text and error", () => {
  const heuristic = { ...base, failingStep: "Run tests", errorLines: ["a", "b"] };
  const n = countAnalysisRows({ heuristic, llmText: "x\ny\nz", llmLoading: true, llmError: "boom" });
  // verdict(1) + step(1) + errors(2) + spinner(1) + llm lines(3) + llm error(1)
  expect(n).toBe(9);
});

test("analysisWindow: no overflow shows every row and never scrolls", () => {
  expect(analysisWindow(3, 10)).toEqual({ overflow: false, shown: 10, maxScroll: 0 });
});

test("analysisWindow: overflow reserves the footer row and exposes the last line", () => {
  // 20 rows into a 7-row window: 6 body rows show, last line reachable at offset 14.
  expect(analysisWindow(20, 7)).toEqual({ overflow: true, shown: 6, maxScroll: 14 });
});

test("analysisWindow: degenerate height still shows at least one row", () => {
  expect(analysisWindow(5, 1)).toEqual({ overflow: true, shown: 1, maxScroll: 4 });
});
