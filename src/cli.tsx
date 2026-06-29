import React from "react";
import { render } from "ink";
import { readFileSync } from "node:fs";
import { execa } from "execa";
import { resolveToken } from "./auth.js";
import { createOctokit } from "./octokit.js";
import { resolveTarget } from "./repo.js";
import { loadConfig, configPath } from "./config.js";
import { getTheme } from "./theme.js";
import { listMyOpenPrs } from "./github/prs.js";
import { fetchChecks } from "./github/checks.js";
import { rerunFailed } from "./github/rerun.js";
import { fetchFailureContext } from "./github/logs.js";
import { classify } from "./analysis/heuristic.js";
import { analyzeWithLlm } from "./analysis/llm.js";
import { createStore } from "./store.js";
import { App } from "./ui/App.js";
import { errorMessage } from "./errors.js";
import type { Check, RepoTarget } from "./types.js";

export function parseArgs(argv: string[]): { repo?: string; help: boolean; version: boolean } {
  const out: { repo?: string; help: boolean; version: boolean } = { help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--repo") out.repo = argv[++i];
    else if (argv[i] === "--help" || argv[i] === "-h") out.help = true;
    else if (argv[i] === "--version" || argv[i] === "-v") out.version = true;
  }
  return out;
}

function readConfigFile(): string | null {
  try { return readFileSync(configPath(), "utf8"); } catch { return null; }
}

export async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log("greenlight — your open PRs + CI checks\n  --repo owner/name   override repo\n  keys: ↑↓ move, ⇥ pane, ↵ analyze, R rerun, a LLM, o open, q quit"); return; }
  if (args.version) { console.log("greenlight 0.1.0"); return; }

  const config = loadConfig({ fileText: readConfigFile(), flags: { repo: args.repo } });
  const theme = getTheme(config.theme);

  let token: string;
  let target: RepoTarget | undefined;
  try {
    token = await resolveToken();
    const octokit = createOctokit(token);
    target = await resolveTarget(octokit, { override: config.repo });

    const store = createStore({
      loadPrs: () => listMyOpenPrs(octokit, target!),
      loadChecks: (n) => fetchChecks(octokit, target!, n),
      timer: { setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (h) => clearInterval(h as NodeJS.Timeout) },
      listMs: config.pollListMs, checksMs: config.pollChecksMs,
    });

    const onRerun = (prNumber: number, checks: Check[]) => rerunFailed(octokit, target!, checks);
    const onAnalyze = async (check: Check) => {
      const ctx = await fetchFailureContext(octokit, target!, check);
      const heuristic = classify(ctx, check);
      const llm = () => analyzeWithLlm(config.llm, ctx, heuristic);
      return { heuristic, llm };
    };
    const openUrl = async (url: string): Promise<void> => {
      const platform = process.platform;
      if (platform === "darwin") await execa("open", [url]);
      else if (platform === "win32") await execa("cmd", ["/c", "start", "", url]);
      else await execa("xdg-open", [url]);
    };

    store.start();
    const { waitUntilExit } = render(
      <App store={store} theme={theme} target={target} onRerun={onRerun} onAnalyze={onAnalyze} openUrl={openUrl} />,
      { alternateScreen: true, exitOnCtrlC: true },
    );
    await waitUntilExit();
    store.stop();
  } catch (e) {
    console.error(`greenlight: ${errorMessage(e)}`);
    process.exitCode = 1;
  }
}

// Only run when executed directly (not when imported by tests)
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
