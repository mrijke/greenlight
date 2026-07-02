import React from "react";
import { Box, Text } from "ink";
import type { PullRequest, Check, RepoTarget } from "../types.js";
import type { Theme } from "../theme.js";
import { checkCounts, glyph, glyphColor, truncate, windowRows } from "../format.js";

interface Props { prs: PullRequest[]; checks: Record<number, Check[]>; selected: number | null; focused: boolean; theme: Theme; width: number; visibleRows: number; target: RepoTarget; }

export function PrList({ prs, checks, selected, focused, theme, width, visibleRows, target }: Props) {
  const borderColor = focused ? theme.selection : theme.border;
  if (prs.length === 0) {
    return (
      <Box flexDirection="column" width={width} borderStyle="round" borderColor={borderColor} paddingX={1}>
        <Text color={theme.title}>PRs</Text>
        <Text color={theme.meta}>No open PRs by @{target.viewerLogin} in {target.owner}/{target.repo}.</Text>
      </Box>
    );
  }
  const cursor = Math.max(0, prs.findIndex((p) => p.number === selected));
  const overflow = prs.length > visibleRows;
  const win = windowRows(prs, cursor, overflow ? Math.max(1, visibleRows - 1) : visibleRows);
  // Title budget = full width minus fixed segments: prefix (4), "#1234 " (~7),
  // counts "✓0 ✗0 •0" (~10), border+padding (4) = 25. ASSUMPTION: PR numbers <= 9999
  // and modest check counts. The codebase has no width-measurement infra, so this is a
  // deliberate estimate; with very large numbers/counts a title could wrap. We accept
  // that edge case rather than measure rendered segment widths.
  const titleWidth = Math.max(8, width - 25);
  return (
    <Box flexDirection="column" width={width} borderStyle="round" borderColor={borderColor} paddingX={1}>
      <Text color={theme.title}>PRs</Text>
      {win.rows.map((pr) => {
        const isSel = pr.number === selected;
        const cs = checks[pr.number] ?? [];
        const top = cs.find((c) => glyph(c) === "✗") ?? cs.find((c) => glyph(c) === "•") ?? cs[0];
        const { pass, fail, pending } = checkCounts(cs);
        return (
          <Box key={pr.number}>
            <Text color={isSel ? theme.selection : undefined}>{isSel ? "❯ " : "  "}</Text>
            {top ? <Text color={glyphColor(top, theme)}>{glyph(top)} </Text> : <Text>  </Text>}
            <Text color={isSel ? theme.selection : undefined}>#{pr.number} </Text>
            <Text>{truncate(pr.title, titleWidth)} </Text>
            {pr.reviewDecision === "APPROVED" ? <Text color={theme.approved}>✦ </Text> : null}
            <Text color={theme.meta}>{`✓${pass} ✗${fail} •${pending}`}</Text>
            {pr.mergeable === "CONFLICTING" ? <Text color={theme.conflict}> ⚠</Text> : null}
          </Box>
        );
      })}
      {overflow ? <Text color={theme.meta}>{`${win.above > 0 ? `↑${win.above} ` : ""}${win.below > 0 ? `↓${win.below} ` : ""}more`}</Text> : null}
    </Box>
  );
}
