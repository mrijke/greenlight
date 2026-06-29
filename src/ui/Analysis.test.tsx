import { render } from "ink-testing-library";
import { expect, test } from "vitest";
import React from "react";
import { Analysis } from "./Analysis.js";
import { getTheme } from "../theme.js";
import type { HeuristicResult } from "../types.js";

const h: HeuristicResult = { verdict: "likely_real", confidence: 0.7, failingStep: "Run tests", errorLines: ["AssertionError: nope"], signals: ["assertion"] };

test("renders heuristic verdict and error lines", () => {
  const { lastFrame } = render(<Analysis heuristic={h} llmText={null} llmLoading={false} llmError={null} theme={getTheme("mocha")} />);
  expect(lastFrame()).toMatch(/likely real/i);
  expect(lastFrame()).toContain("Run tests");
  expect(lastFrame()).toContain("AssertionError");
});

test("shows LLM hint when there is an llmError", () => {
  const { lastFrame } = render(<Analysis heuristic={h} llmText={null} llmLoading={false} llmError={"LLM unconfigured"} theme={getTheme("mocha")} />);
  expect(lastFrame()).toMatch(/LLM unconfigured/i);
});
