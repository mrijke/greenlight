import OpenAI from "openai";
import type { FailureContext, HeuristicResult } from "../types.js";
import { httpStatus } from "../errors.js";

export interface LlmConfig { baseURL: string; apiKey?: string; model: string; }

export function buildPrompt(ctx: FailureContext, h: HeuristicResult): string {
  return [
    "You are a CI triage assistant. Decide whether this failure is a real code/test failure or a flaky/infra failure.",
    `Heuristic verdict: ${h.verdict} (confidence ${h.confidence}); signals: ${h.signals.join(", ") || "none"}.`,
    `Failing step: ${ctx.failingStep ?? "unknown"} in job "${ctx.jobName}".`,
    "Answer in <=4 sentences: what broke, flaky vs real + why, and the single best next action.",
    "--- LOG (trimmed) ---",
    ctx.logSlice,
  ].join("\n");
}

export async function analyzeWithLlm(
  cfg: LlmConfig, ctx: FailureContext, h: HeuristicResult,
  deps: { createClient?: (cfg: LlmConfig) => OpenAI } = {},
): Promise<string> {
  if (!cfg.apiKey) throw new Error("LLM unconfigured: set an endpoint/apiKey to enable analysis.");
  const createClient = deps.createClient ?? ((c) => new OpenAI({ baseURL: c.baseURL, apiKey: c.apiKey }));
  const client = createClient(cfg);
  try {
    const res = await client.chat.completions.create({
      model: cfg.model,
      messages: [{ role: "user", content: buildPrompt(ctx, h) }],
      temperature: 0.2,
    });
    return res.choices[0]?.message?.content?.trim() ?? "(no response)";
  } catch (err) {
    const status = httpStatus(err);
    if (status === 403) throw new Error("models scope missing: run `gh auth refresh -s models` or use a PAT with models:read.");
    if (status === 429) throw new Error("LLM rate-limited; try again shortly.");
    throw err;
  }
}
