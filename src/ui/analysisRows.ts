import type { HeuristicResult } from "../types.js";

export interface AnalysisBody {
  heuristic: HeuristicResult;
  llmText: string | null;
  llmLoading: boolean;
  llmError: string | null;
}

// Single source of truth for how many one-row entries AnalysisPane renders in its
// body: verdict line, optional failing step, each error line, the LLM spinner, each
// LLM output line, and an LLM error. Both AnalysisPane (windowing) and App (height
// budget + scroll clamp) count rows through this so the two can never drift.
export function countAnalysisRows(b: AnalysisBody): number {
  return 1
    + (b.heuristic.failingStep ? 1 : 0)
    + b.heuristic.errorLines.length
    + (b.llmLoading ? 1 : 0)
    + (b.llmText ? b.llmText.split("\n").length : 0)
    + (b.llmError ? 1 : 0);
}

// Body window for a given visible height. When the content overflows, one row is
// reserved for the "more" footer, so only `visibleRows - 1` body rows show and the
// last line comes into view at offset `maxScroll`. App clamps scroll to `maxScroll`;
// AnalysisPane slices the body the same way. Sharing this is what keeps the scroll
// clamp and the render in lockstep (a divergence here was the original off-by-one).
export function analysisWindow(totalRows: number, visibleRows: number): { overflow: boolean; shown: number; maxScroll: number } {
  const overflow = totalRows > visibleRows;
  const shown = overflow ? Math.max(1, visibleRows - 1) : visibleRows;
  return { overflow, shown, maxScroll: Math.max(0, totalRows - shown) };
}
