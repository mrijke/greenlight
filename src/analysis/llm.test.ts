import { expect, test, vi } from "vitest";
import type OpenAI from "openai";
import { analyzeWithLlm, buildPrompt } from "./llm.js";
import type { FailureContext, HeuristicResult } from "../types.js";

const ctx: FailureContext = { jobName: "test", failingStep: "Run tests", logSlice: "AssertionError: nope", annotations: [], runAttempt: 1 };
const h: HeuristicResult = { verdict: "likely_real", confidence: 0.7, failingStep: "Run tests", errorLines: ["AssertionError: nope"], signals: ["assertion"] };

test("buildPrompt includes verdict, step and log", () => {
  const p = buildPrompt(ctx, h);
  expect(p).toContain("Run tests");
  expect(p).toContain("AssertionError: nope");
  expect(p).toContain("likely_real");
});

test("analyzeWithLlm throws when unconfigured (no apiKey)", async () => {
  await expect(analyzeWithLlm({ baseURL: "x", model: "m" }, ctx, h)).rejects.toThrow(/LLM unconfigured/);
});

test("analyzeWithLlm returns assistant text", async () => {
  const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: "It is a real assertion failure." } }] });
  const createClient = () => ({ chat: { completions: { create } } }) as unknown as OpenAI;
  const out = await analyzeWithLlm({ baseURL: "x", apiKey: "k", model: "gpt-4o-mini" }, ctx, h, { createClient });
  expect(out).toContain("real assertion failure");
  expect(create).toHaveBeenCalled();
});

test("analyzeWithLlm maps 403 to models scope missing", async () => {
  const create = vi.fn().mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
  const createClient = () => ({ chat: { completions: { create } } }) as unknown as OpenAI;
  await expect(analyzeWithLlm({ baseURL: "x", apiKey: "k", model: "m" }, ctx, h, { createClient })).rejects.toThrow(/models scope missing/);
});
