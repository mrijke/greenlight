import { z } from "zod";
import type { LlmConfig } from "./analysis/llm.js";

export interface Config { theme: string; repo?: string; pollListMs: number; pollChecksMs: number; llm: LlmConfig; }

const FileSchema = z.object({
  theme: z.string().optional(),
  repo: z.string().optional(),
  pollListMs: z.number().optional(),
  pollChecksMs: z.number().optional(),
  llm: z.object({ baseURL: z.string().optional(), apiKey: z.string().optional(), model: z.string().optional() }).optional(),
}).partial();

const DEFAULT_BASE_URL = "https://models.github.ai/inference";

export function loadConfig(
  deps: { fileText?: string | null; env?: NodeJS.ProcessEnv; flags?: Partial<{ repo: string; theme: string }> } = {},
): Config {
  const env = deps.env ?? process.env;
  let file: z.infer<typeof FileSchema> = {};
  if (deps.fileText) {
    try { file = FileSchema.parse(JSON.parse(deps.fileText)); } catch { file = {}; }
  }
  const pick = <T>(...vals: (T | undefined | "")[]) => vals.find((v) => v !== undefined && v !== "") as T | undefined;

  return {
    theme: pick(deps.flags?.theme, env.GREENLIGHT_THEME, file.theme, "mocha")!,
    repo: pick(deps.flags?.repo, env.GREENLIGHT_REPO, file.repo),
    pollListMs: pick(file.pollListMs, 30000)!,
    pollChecksMs: pick(file.pollChecksMs, 10000)!,
    llm: {
      baseURL: pick(env.LLM_BASE_URL, file.llm?.baseURL, DEFAULT_BASE_URL)!,
      apiKey: pick(env.LLM_API_KEY, file.llm?.apiKey),
      model: pick(env.LLM_MODEL, file.llm?.model, "openai/gpt-4o-mini")!,
    },
  };
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.XDG_CONFIG_HOME ?? `${env.HOME}/.config`;
  return `${home}/greenlight/config.json`;
}
