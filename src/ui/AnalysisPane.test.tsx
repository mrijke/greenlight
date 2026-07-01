import { render } from "ink-testing-library";
import { expect, test } from "vitest";
import React from "react";
import { AnalysisPane } from "./AnalysisPane.js";
import { getTheme } from "../theme.js";
import type { Check, HeuristicResult } from "../types.js";

const check: Check = { name: "test (e2e)", status: "completed", conclusion: "failure", detailsUrl: "u", startedAt: null, completedAt: null, checkRunId: 1, checkSuiteId: 1, workflowRunId: 1, workflowName: null, isStatusContext: false };
const heuristic: HeuristicResult = { verdict: "likely_flaky", confidence: 0.72, failingStep: "Run e2e suite", errorLines: ["Error: ETIMEDOUT connect 30000ms"], signals: ["timeout"] };

test("renders verdict, error line, title and footer hints", () => {
  const { lastFrame } = render(<AnalysisPane check={check} heuristic={heuristic} llmText={null} llmLoading={false} llmError={null} theme={getTheme("mocha")} width={80} visibleRows={10} scroll={0} />);
  expect(lastFrame()).toMatch(/likely flaky/);
  expect(lastFrame()).toContain("test (e2e)");
  expect(lastFrame()).toContain("ETIMEDOUT");
  expect(lastFrame()).toMatch(/esc.*close/);
});

test("shows a 'more' indicator when the body overflows", () => {
  const big: HeuristicResult = { ...heuristic, errorLines: Array.from({ length: 20 }, (_, i) => `line ${i}`) };
  const { lastFrame } = render(<AnalysisPane check={check} heuristic={big} llmText={null} llmLoading={false} llmError={null} theme={getTheme("mocha")} width={80} visibleRows={4} scroll={0} />);
  expect(lastFrame()).toMatch(/more/);
});
