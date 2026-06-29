import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import type { HeuristicResult } from "../types.js";
import type { Theme } from "../theme.js";

interface Props { heuristic: HeuristicResult | null; llmText: string | null; llmLoading: boolean; llmError: string | null; theme: Theme; }

const label = (v: HeuristicResult["verdict"]) => v === "likely_real" ? "likely real" : v === "likely_flaky" ? "likely flaky" : "unclear";

export function Analysis({ heuristic, llmText, llmLoading, llmError, theme }: Props) {
  if (!heuristic) return <Box><Text color={theme.meta}>Press ↵ on a failed check to analyze.</Text></Box>;
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text>
        <Text color={theme.flag}>⚑ {label(heuristic.verdict)}</Text>
        <Text color={theme.meta}> ({Math.round(heuristic.confidence * 100)}% · {heuristic.signals.join(", ") || "no signals"})</Text>
      </Text>
      {heuristic.failingStep ? <Text color={theme.meta}>step: {heuristic.failingStep}</Text> : null}
      {heuristic.errorLines.map((l, i) => <Text key={i} color={theme.fail}>{l}</Text>)}
      {llmLoading ? <Text color={theme.checkName}><Spinner type="dots" /> analyzing…</Text> : null}
      {llmText ? <Text color={theme.checkName}>{llmText}</Text> : null}
      {llmError ? <Text color={theme.error}>{llmError}</Text> : null}
    </Box>
  );
}
