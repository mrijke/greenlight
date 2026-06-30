import React from "react";
import { Box, Text } from "ink";
import type { PullRequest, Check } from "../types.js";
import type { Theme } from "../theme.js";
import { formatDuration, glyph, glyphColor, truncate, windowRows } from "../format.js";

interface Props { pr: PullRequest | null; checks: Check[]; checkCursor: number; focused: boolean; theme: Theme; width: number; visibleRows: number; }

export function Detail({ pr, checks, checkCursor, focused, theme, width, visibleRows }: Props) {
  const borderColor = focused ? theme.selection : theme.border;
  if (!pr) {
    return (
      <Box flexGrow={1} width={width} borderStyle="round" borderColor={borderColor} paddingX={1}>
        <Text color={theme.meta}>Select a PR to see its checks.</Text>
      </Box>
    );
  }
  const inner = Math.max(4, width - 4); // minus border(2) + paddingX(2)
  const overflow = checks.length > visibleRows;
  const win = windowRows(checks, checkCursor, overflow ? Math.max(1, visibleRows - 1) : visibleRows);
  return (
    <Box flexDirection="column" width={width} borderStyle="round" borderColor={borderColor} paddingX={1}>
      <Text color={theme.title}>#{pr.number} {truncate(pr.title, Math.max(8, inner - 8))}</Text>
      <Text color={theme.meta}>{pr.headRefName} → {pr.baseRefName}{pr.isCrossRepository ? " (fork)" : ""}</Text>
      <Text color={theme.border}>{"─".repeat(inner)}</Text>
      {win.rows.map((c, i) => {
        const isSel = checks.indexOf(c) === checkCursor;
        return (
          <Box key={c.name + i}>
            <Text color={glyphColor(c, theme)}>{glyph(c)} </Text>
            <Text color={isSel ? theme.selection : theme.checkName}>{truncate(c.name, 22).padEnd(22)} </Text>
            <Text color={theme.meta}>{formatDuration(c.startedAt, c.completedAt)}</Text>
          </Box>
        );
      })}
      {overflow ? <Text color={theme.meta}>{`${win.above > 0 ? `↑${win.above} ` : ""}${win.below > 0 ? `↓${win.below} ` : ""}more`}</Text> : null}
    </Box>
  );
}
