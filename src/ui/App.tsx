import React, { useEffect, useState, useSyncExternalStore } from "react";
import { Box, useApp, useInput } from "ink";
import type { Store } from "../store.js";
import type { Check, HeuristicResult, PullRequest, RepoTarget } from "../types.js";
import type { Theme } from "../theme.js";
import { errorMessage } from "../errors.js";
import { canRerun, failedRunIds } from "../github/rerun.js";
import { computeLayout } from "./layout.js";
import { useTerminalSize } from "./useTerminalSize.js";
import { PrList } from "./PrList.js";
import { Detail } from "./Detail.js";
import { AnalysisPane } from "./AnalysisPane.js";
import { ConfirmOverlay, HelpOverlay } from "./Overlay.js";
import { StatusBar } from "./StatusBar.js";

const HINTS = "↑↓ move · ⇥ pane · ↵ analyze · R rerun · r refresh · o open · ? help · q quit";

interface Props {
  store: Store; theme: Theme; target: RepoTarget; llmEnabled: boolean;
  onRerun: (prNumber: number, checks: Check[]) => Promise<{ rerun: number[] }>;
  onAnalyze: (check: Check) => Promise<{ heuristic: HeuristicResult; llm: () => Promise<string> }>;
  openUrl: (url: string) => Promise<void>;
}

export function App({ store, theme, target, llmEnabled, onRerun, onAnalyze, openUrl }: Props) {
  const { exit } = useApp();
  const size = useTerminalSize();
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const [focus, setFocus] = useState<"list" | "detail">("list");
  const [checkCursor, setCheckCursor] = useState(0);
  const [overlay, setOverlay] = useState<null | "help" | "confirm">(null);
  const [message, setMessage] = useState<string | null>(null);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [analyzedCheckIndex, setAnalyzedCheckIndex] = useState<number | null>(null);
  const [analysisScroll, setAnalysisScroll] = useState(0);
  const [heuristic, setHeuristic] = useState<HeuristicResult | null>(null);
  const [llmText, setLlmText] = useState<string | null>(null);
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [runLlm, setRunLlm] = useState<null | (() => Promise<string>)>(null);

  const prs: PullRequest[] = state.prs;
  const selectedPr = prs.find((p) => p.number === state.selectedPr) ?? null;
  const checks: Check[] = state.selectedPr != null ? state.checks[state.selectedPr] ?? [] : [];
  const analyzedCheck = analyzedCheckIndex != null ? checks[analyzedCheckIndex] ?? null : null;

  useEffect(() => { if (state.selectedPr == null && prs[0]) store.selectPr(prs[0].number); }, [prs.length]);
  useEffect(() => { setMessage(state.error); }, [state.error]);

  const analysisBodyRows = heuristic
    ? 1 + (heuristic.failingStep ? 1 : 0) + heuristic.errorLines.length
      + (llmLoading ? 1 : 0) + (llmText ? llmText.split("\n").length : 0) + (llmError ? 1 : 0)
    : 1;
  const layout = computeLayout({ totalRows: size.rows, prCount: prs.length, analysisOpen, analysisBodyRows });

  function closeAnalysis() {
    setAnalysisOpen(false); setAnalyzedCheckIndex(null); setAnalysisScroll(0);
    setHeuristic(null); setLlmText(null); setLlmError(null); setRunLlm(null);
  }

  useInput((input, key) => {
    if (overlay === "confirm") {
      if (input === "y") { setOverlay(null); void doRerun(); }
      else if (input === "n" || key.escape) setOverlay(null);
      return;
    }
    if (overlay === "help") { if (input === "?" || key.escape) setOverlay(null); return; }

    // Pop-up focus trap: while analysis is open, it owns the keys. Centralized here
    // (Ink useInput is global; there is no per-component trap), mirroring help/confirm.
    if (analysisOpen) {
      if (key.escape) { closeAnalysis(); return; }
      if (input === "o") {
        const url = analyzedCheck?.detailsUrl ?? selectedPr?.url;
        if (url) void openUrl(url).catch((e) => setMessage(errorMessage(e)));
        return;
      }
      if (input === "a") {
        if (!llmEnabled) { setLlmError("LLM not configured"); return; }
        if (!runLlm) { setLlmError("nothing to analyze"); return; }
        setLlmLoading(true); setLlmError(null);
        runLlm().then((t) => setLlmText(t)).catch((e) => setLlmError(errorMessage(e))).finally(() => setLlmLoading(false));
        return;
      }
      if (key.upArrow || input === "k") { setAnalysisScroll((s) => Math.max(0, s - 1)); return; }
      if (key.downArrow || input === "j") { setAnalysisScroll((s) => Math.max(0, Math.min(analysisBodyRows - layout.analysisVisible, s + 1))); return; }
      return;
    }

    if (input === "q") { exit(); return; }
    if (input === "?") { setOverlay("help"); return; }
    if (key.tab || input === "h" || input === "l") { setFocus((f) => (f === "list" ? "detail" : "list")); return; }
    if (input === "r") { void store.refreshNow(); return; }
    if (input === "o") {
      const url = focus === "detail" ? checks[checkCursor]?.detailsUrl ?? selectedPr?.url : selectedPr?.url;
      if (url) void openUrl(url).catch((e) => setMessage(errorMessage(e)));
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
      if (prs[next]) { store.selectPr(prs[next].number); setCheckCursor(0); }
    } else if (focus === "detail" && (up || down)) {
      setCheckCursor((c) => Math.min(checks.length - 1, Math.max(0, c + (down ? 1 : -1))));
    } else if (key.return && focus === "detail") {
      void analyze();
    }
  });

  async function analyze() {
    const check = checks[checkCursor];
    if (!check) return;
    setLlmText(null); setLlmError(null); setAnalysisScroll(0);
    setAnalyzedCheckIndex(checkCursor); setAnalysisOpen(true);
    try {
      const { heuristic: h, llm } = await onAnalyze(check);
      setHeuristic(h); setRunLlm(() => llm);
    } catch (e) { setMessage(errorMessage(e)); closeAnalysis(); }
  }

  async function doRerun() {
    const prNumber = state.selectedPr;
    if (prNumber == null) return;
    try {
      setMessage("rerunning failed jobs…");
      const res = await onRerun(prNumber, checks);
      store.markRequeued(prNumber, res.rerun);
      setMessage(null);
    } catch (e) { setMessage(errorMessage(e)); }
  }

  if (overlay === "help") return <HelpOverlay theme={theme} />;
  if (overlay === "confirm") {
    const n = failedRunIds(checks).length;
    return <ConfirmOverlay message={`Rerun ${n} failed job(s)?`} theme={theme} />;
  }

  return (
    <Box flexDirection="column">
      <PrList prs={prs} checks={state.checks} selected={state.selectedPr} focused={focus === "list"} theme={theme} width={size.columns} visibleRows={layout.prVisible} target={target} />
      <Detail pr={selectedPr} checks={checks} checkCursor={checkCursor} focused={focus === "detail"} theme={theme} width={size.columns} visibleRows={layout.checksVisible} />
      {analysisOpen && analyzedCheck && heuristic ? (
        <AnalysisPane check={analyzedCheck} heuristic={heuristic} llmText={llmText} llmLoading={llmLoading} llmError={llmError} theme={theme} width={size.columns} visibleRows={layout.analysisVisible} scroll={analysisScroll} />
      ) : null}
      <StatusBar hints={HINTS} message={message} theme={theme} />
    </Box>
  );
}