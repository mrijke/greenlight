import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import type { Check, HeuristicResult } from "../types.js";
import type { Theme } from "../theme.js";
import { glyph, glyphColor } from "../format.js";
import { analysisWindow, countAnalysisRows } from "./analysisRows.js";

interface Props { check: Check; heuristic: HeuristicResult; llmText: string | null; llmLoading: boolean; llmError: string | null; theme: Theme; width: number; visibleRows: number; scroll: number; }

const label = (v: HeuristicResult["verdict"]) => v === "likely_real" ? "likely real" : v === "likely_flaky" ? "likely flaky" : "unclear";

export function AnalysisPane({ check, heuristic, llmText, llmLoading, llmError, theme, width, visibleRows, scroll }: Props) {
  // INVARIANT: every entry pushed here renders as exactly ONE terminal row, so its
  // count matches countAnalysisRows below (the shared source App also budgets/scrolls
  // by). If you ever add a multi-line entry (e.g. a wrapped LLM line), update
  // countAnalysisRows to match instead of measuring .length here.
  const lines: React.ReactNode[] = [];
  lines.push(
    <Text key="v" wrap="truncate">
      <Text color={theme.flag}>⚑ {label(heuristic.verdict)}</Text>
      <Text color={theme.meta}> ({Math.round(heuristic.confidence * 100)}% · {heuristic.signals.join(", ") || "no signals"})</Text>
    </Text>,
  );
  if (heuristic.failingStep) lines.push(<Text key="s" color={theme.meta} wrap="truncate">step: {heuristic.failingStep}</Text>);
  heuristic.errorLines.forEach((l, i) => lines.push(<Text key={`e${i}`} color={theme.fail} wrap="truncate">{l}</Text>));
  if (llmLoading) lines.push(<Text key="ll" color={theme.checkName}><Spinner type="dots" /> analyzing…</Text>);
  if (llmText) llmText.split("\n").forEach((l, i) => lines.push(<Text key={`lt${i}`} color={theme.checkName} wrap="truncate">{l}</Text>));
  if (llmError) lines.push(<Text key="le" color={theme.error} wrap="truncate">{llmError}</Text>);

  // Top-anchored scroll (NOT windowRows, which centers a cursor — that would make the
  // first few down-presses move nothing until scroll passes half the height). `scroll`
  // is a row offset App clamps to analysisWindow().maxScroll, the same window used here.
  const total = countAnalysisRows({ heuristic, llmText, llmLoading, llmError });
  const { overflow, shown, maxScroll } = analysisWindow(total, visibleRows);
  const start = Math.min(Math.max(0, scroll), maxScroll);
  const body = lines.slice(start, start + shown);
  const above = start;
  const below = total - (start + body.length);
  return (
    <Box flexDirection="column" width={width} borderStyle="round" borderColor={theme.flag} paddingX={1}>
      <Text color={theme.title} wrap="truncate">⚑ analysis · <Text color={glyphColor(check, theme)}>{glyph(check)}</Text> {check.name}</Text>
      {body}
      {overflow ? <Text color={theme.meta}>{`${above > 0 ? `↑${above} ` : ""}${below > 0 ? `↓${below} ` : ""}more`}</Text> : null}
      <Text color={theme.meta}>[a] ask LLM · [o] open · [esc] close</Text>
    </Box>
  );
}
