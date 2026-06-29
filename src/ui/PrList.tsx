import React from "react";
import { Box, Text } from "ink";
import type { PullRequest, Check, RepoTarget } from "../types.js";
import type { Theme } from "../theme.js";
import { checkCounts, glyph, glyphColor, truncate, windowRows } from "../format.js";

interface Props { prs: PullRequest[]; checks: Record<number, Check[]>; selected: number | null; focused: boolean; theme: Theme; height: number; target: RepoTarget; }

export function PrList({ prs, checks, selected, focused, theme, height, target }: Props) {
  const borderColor = focused ? theme.selection : theme.border;
  if (prs.length === 0) {
    return (
      <Box flexDirection="column" width={36} borderStyle="round" borderColor={borderColor} paddingX={1}>
        <Text color={theme.title}>PRs</Text>
        <Text color={theme.meta}>No open PRs by @{target.viewerLogin} in {target.owner}/{target.repo}.</Text>
      </Box>
    );
  }
  const cursor = Math.max(0, prs.findIndex((p) => p.number === selected));
  const { rows } = windowRows(prs, cursor, height);
  return (
    <Box flexDirection="column" width={36} borderStyle="round" borderColor={borderColor} paddingX={1}>
      <Text color={theme.title}>PRs</Text>
      {rows.map((pr) => {
        const isSel = pr.number === selected;
        const cs = checks[pr.number] ?? [];
        const top = cs.find((c) => glyph(c) === "✗") ?? cs.find((c) => glyph(c) === "•") ?? cs[0];
        const { pass, fail, pending } = checkCounts(cs);
        return (
          <Box key={pr.number}>
            <Text color={isSel ? theme.selection : undefined}>{isSel ? "❯ " : "  "}</Text>
            {top ? <Text color={glyphColor(top, theme)}>{glyph(top)} </Text> : <Text>  </Text>}
            <Text color={isSel ? theme.selection : undefined}>#{pr.number} </Text>
            <Text>{truncate(pr.title, 16)} </Text>
            <Text color={theme.meta}>{`✓${pass} ✗${fail} •${pending}`}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
