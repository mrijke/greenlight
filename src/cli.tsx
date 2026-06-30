import React from "react";
import { render } from "ink";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

// package.json sits one level up from the bundled entry (dist/cli.js) and from
// the source entry (src/cli.tsx), so the same relative URL works either way.
function readPackageJson(): string | null {
  try { return readFileSync(new URL("../package.json", import.meta.url), "utf8"); } catch { return null; }
}

export function versionString(pkgText: string | null): string {
  if (pkgText) {
    try {
      const v: unknown = JSON.parse(pkgText).version;
      if (typeof v === "string") return `greenlight ${v}`;
    } catch { /* fall through to unknown */ }
  }
  return "greenlight (unknown version)";
}

export function helpText(): string {
  return [
    "greenlight — your open PRs and their CI checks",
    "",
    "Usage: greenlight [options]   (alias: gl)",
    "",
    "Options:",
    "  --repo owner/name   Target a specific repo instead of the current one",
    "  -v, --version       Print the version and exit",
    "  -h, --help          Show this help and exit",
    "",
    "Run inside a GitHub repo to see your open PRs and their checks.",
    "Keys: ↑↓ move · ⇥ pane · ↵ analyze · R rerun · a LLM · o open · q quit",
  ].join("\n");
}

export async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(helpText()); return; }
  if (args.version) { console.log(versionString(readPackageJson())); return; }

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
      <App store={store} theme={theme} target={target} llmEnabled={Boolean(config.llm.apiKey)} onRerun={onRerun} onAnalyze={onAnalyze} openUrl={openUrl} />,
      { alternateScreen: true, exitOnCtrlC: true },
    );
    await waitUntilExit();
    store.stop();
  } catch (e) {
    console.error(`greenlight: ${errorMessage(e)}`);
    process.exitCode = 1;
  }
}

// True when this module is the program entry point. Compares the *resolved*
// real path of argv[1] against the module's own path, because an installed bin
// (`gl`/`greenlight`) is a symlink/shim: argv[1] is the link, while
// import.meta.url is the real file. A raw string compare misses that and the
// CLI exits silently. See cli.test.ts.
export function isMainModule(
  argv1: string | undefined,
  moduleUrl: string,
  realpath: (p: string) => string = realpathSync,
): boolean {
  if (!argv1) return false;
  try {
    return realpath(argv1) === fileURLToPath(moduleUrl);
  } catch {
    return false;
  }
}

if (isMainModule(process.argv[1], import.meta.url)) {
  void main();
}
