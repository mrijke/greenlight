import type { Check, FailureContext, FlakyVerdict, HeuristicResult } from "../types.js";

const FLAKY_PATTERNS: { signal: string; re: RegExp }[] = [
  { signal: "network", re: /(ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|network\s*error|getaddrinfo|503 Service|502 Bad Gateway|429 Too Many)/i },
  { signal: "oom", re: /(exit code 137|out of memory|OOMKilled|Container killed|Cannot allocate memory|signal 9)/i },
  { signal: "timeout", re: /(timed out|timeout exceeded|deadline exceeded|cancel(l)?ed after)/i },
  { signal: "infra", re: /(The runner has received a shutdown signal|Lost communication with the server|rate limit exceeded)/i },
];

const REAL_PATTERNS: { signal: string; re: RegExp }[] = [
  { signal: "assertion", re: /(AssertionError|expected .+ (to|but)\b|✕|FAIL\b|Expected:|Received:)/ },
  { signal: "compile", re: /(error TS\d+|SyntaxError|cannot find module|is not assignable to|undefined reference|compilation failed)/i },
  { signal: "lint", re: /(eslint|lint error|\d+ problems?\s*\(\d+ errors?)/i },
];

export function classify(ctx: FailureContext, check: Check): HeuristicResult {
  const haystack = `${ctx.logSlice}\n${ctx.annotations.map((a) => a.message).join("\n")}`;
  const signals: string[] = [];

  let flakyScore = 0;
  let realScore = 0;
  for (const { signal, re } of FLAKY_PATTERNS) if (re.test(haystack)) { signals.push(signal); flakyScore += 1; }
  for (const { signal, re } of REAL_PATTERNS) if (re.test(haystack)) { signals.push(signal); realScore += 1; }

  if (check.conclusion === "timed_out") { signals.push("timeout"); flakyScore += 1; }
  if (ctx.runAttempt > 1) { signals.push("retried"); flakyScore += 0.5; }

  const errorLines = ctx.logSlice.split("\n").filter((l) => /(error|fail|✕|exception|assert)/i.test(l)).slice(-12);

  let verdict: FlakyVerdict = "unclear";
  let confidence = 0.4;
  if (realScore > flakyScore) { verdict = "likely_real"; confidence = Math.min(0.9, 0.5 + 0.2 * realScore); }
  else if (flakyScore > realScore) { verdict = "likely_flaky"; confidence = Math.min(0.9, 0.5 + 0.2 * flakyScore); }

  return { verdict, confidence, failingStep: ctx.failingStep, errorLines, signals: [...new Set(signals)] };
}
