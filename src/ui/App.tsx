import React, { useEffect, useState, useSyncExternalStore } from "react";
import { Box, useApp, useInput } from "ink";
import type { Store } from "../store.js";
import type { Check, HeuristicResult, PullRequest, RepoTarget } from "../types.js";
import type { Theme } from "../theme.js";
import { errorMessage } from "../errors.js";
import { canRerun, failedRunIds } from "../github/rerun.js";
import { PrList } from "./PrList.js";
import { Detail } from "./Detail.js";
import { Analysis } from "./Analysis.js";
import { ConfirmOverlay, HelpOverlay } from "./Overlay.js";
import { StatusBar } from "./StatusBar.js";

const HINTS = "↑↓ move · ⇥ pane · ↵ analyze · R rerun · r refresh · o open · ? help · q quit";

interface Props {
  store: Store; theme: Theme; target: RepoTarget;
  onRerun: (prNumber: number, checks: Check[]) => Promise<{ rerun: number[] }>;
  onAnalyze: (check: Check) => Promise<{ heuristic: HeuristicResult; llm: () => Promise<string> }>;
  openUrl: (url: string) => Promise<void>;
}

export function App({ store, theme, target, onRerun, onAnalyze, openUrl }: Props) {
  const { exit } = useApp();
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const [focus, setFocus] = useState<"list" | "detail">("list");
  const [checkCursor, setCheckCursor] = useState(0);
  const [overlay, setOverlay] = useState<null | "help" | "confirm">(null);
  const [message, setMessage] = useState<string | null>(null);
  const [heuristic, setHeuristic] = useState<HeuristicResult | null>(null);
  const [llmText, setLlmText] = useState<string | null>(null);
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [runLlm, setRunLlm] = useState<null | (() => Promise<string>)>(null);

  const prs: PullRequest[] = state.prs;
  const selectedPr = prs.find((p) => p.number === state.selectedPr) ?? null;
  const checks: Check[] = state.selectedPr != null ? state.checks[state.selectedPr] ?? [] : [];

  useEffect(() => { if (state.selectedPr == null && prs[0]) store.selectPr(prs[0].number); }, [prs.length]);
  useEffect(() => { setMessage(state.error); }, [state.error]);

  useInput((input, key) => {
    if (overlay === "confirm") {
      if (input === "y") { setOverlay(null); void doRerun(); }
      else if (input === "n" || key.escape) setOverlay(null);
      return;
    }
    if (overlay === "help") { if (input === "?" || key.escape) setOverlay(null); return; }

    if (input === "q") { exit(); return; }
    if (input === "?") { setOverlay("help"); return; }
    if (key.tab || input === "h" || input === "l") { setFocus((f) => (f === "list" ? "detail" : "list")); return; }
    if (input === "r") { void store.refreshNow(); return; }
    if (input === "o") {
      const url = focus === "detail" ? checks[checkCursor]?.detailsUrl ?? selectedPr?.url : selectedPr?.url;
      if (url) { void openUrl(url).catch((e) => setMessage(errorMessage(e))); }
      return;
    }
    if (input === "R") {
      if (!target.viewerCanWrite) { setMessage(`no write access to ${target.owner}/${target.repo}`); return; }
      const gate = canRerun(checks);
      if (!gate.ok) { setMessage(gate.reason ?? "cannot rerun"); return; }
      setOverlay("confirm"); return;
    }

    const up = key.upArrow || input === "k";
    const down = key.downArrow || input === "j";
    if (focus === "list" && (up || down)) {
      const idx = prs.findIndex((p) => p.number === state.selectedPr);
      const next = Math.min(prs.length - 1, Math.max(0, idx + (down ? 1 : -1)));
      if (prs[next]) { store.selectPr(prs[next].number); setCheckCursor(0); setHeuristic(null); setLlmText(null); setLlmError(null); }
    } else if (focus === "detail" && (up || down)) {
      setCheckCursor((c) => Math.min(checks.length - 1, Math.max(0, c + (down ? 1 : -1))));
    } else if (key.return && focus === "detail") {
      void analyze();
    }
  });

  async function analyze() {
    const check = checks[checkCursor];
    if (!check) return;
    setLlmText(null); setLlmError(null);
    try {
      const { heuristic: h, llm } = await onAnalyze(check);
      setHeuristic(h); setRunLlm(() => llm);
    } catch (e) { setMessage(errorMessage(e)); }
  }

  async function doRerun() {
    const prNumber = state.selectedPr;
    if (prNumber == null) return;
    try {
      setMessage("rerunning failed jobs…");
      const res = await onRerun(prNumber, checks);
      // Optimistic flip only; the checks interval poll reconciles once GitHub
      // propagates the new attempt. Refetching now would clobber the flip with
      // the stale failed rollup.
      store.markRequeued(prNumber, res.rerun);
      setMessage(null);
    } catch (e) { setMessage(errorMessage(e)); }
  }

  // 'a' triggers the deferred LLM call
  useInput((input) => {
    if (input === "a" && !overlay) {
      if (!runLlm) { setLlmError("press ↵ on a failed check first"); return; }
      setLlmLoading(true); setLlmError(null);
      runLlm().then((t) => setLlmText(t)).catch((e) => setLlmError(errorMessage(e))).finally(() => setLlmLoading(false));
    }
  });

  if (overlay === "help") return <HelpOverlay theme={theme} />;
  if (overlay === "confirm") {
    const n = failedRunIds(checks).length;
    return <ConfirmOverlay message={`Rerun ${n} failed job(s)?`} theme={theme} />;
  }

  return (
    <Box flexDirection="column">
      <Box>
        <PrList prs={prs} checks={state.checks} selected={state.selectedPr} focused={focus === "list"} theme={theme} height={12} target={target} />
        <Box flexDirection="column" flexGrow={1}>
          <Detail pr={selectedPr} checks={checks} checkCursor={checkCursor} focused={focus === "detail"} theme={theme} height={12} />
          <Analysis heuristic={heuristic} llmText={llmText} llmLoading={llmLoading} llmError={llmError} theme={theme} />
        </Box>
      </Box>
      <StatusBar hints={HINTS} message={message} theme={theme} />
    </Box>
  );
}
