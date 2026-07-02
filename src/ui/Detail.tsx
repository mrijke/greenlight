import React from "react";
import { Box, Text } from "ink";
import type { PullRequest } from "../types.js";
import type { Theme } from "../theme.js";
import { formatDuration, glyph, glyphColor, truncate, windowRows } from "../format.js";
import { groupGlyph, groupColor, rowId, type Row } from "./checkGroups.js";

interface Props { pr: PullRequest | null; rows: Row[]; cursor: number; focused: boolean; theme: Theme; width: number; visibleRows: number; }

export function Detail({ pr, rows, cursor, focused, theme, width, visibleRows }: Props) {
  const borderColor = focused ? theme.selection : theme.border;
  if (!pr) {
    return (
      <Box flexGrow={1} width={width} borderStyle="round" borderColor={borderColor} paddingX={1}>
        <Text color={theme.meta}>Select a PR to see its checks.</Text>
      </Box>
    );
  }
  const inner = Math.max(4, width - 4); // minus border(2) + paddingX(2)
  const overflow = rows.length > visibleRows;
  const win = windowRows(rows, cursor, overflow ? Math.max(1, visibleRows - 1) : visibleRows);
  return (
    <Box flexDirection="column" width={width} borderStyle="round" borderColor={borderColor} paddingX={1}>
      <Box>
        <Text color={theme.title}>#{pr.number} {truncate(pr.title, Math.max(8, inner - 8))}</Text>
        {pr.reviewDecision === "APPROVED" ? <Text color={theme.approved}> ✦ approved</Text> : null}
      </Box>
      <Text color={theme.meta}>{pr.headRefName} → {pr.baseRefName}{pr.isCrossRepository ? " (fork)" : ""}</Text>
      {pr.mergeable === "CONFLICTING" ? <Text color={theme.conflict}>⚠ merge conflict</Text> : null}
      <Text color={theme.border}>{"─".repeat(inner)}</Text>
      {win.rows.map((row, i) => {
        const isSel = win.offset + i === cursor;
        const caret = isSel ? "❯ " : "  ";
        if (row.kind === "header") {
          const g = row.group;
          return (
            <Box key={rowId(row)}>
              <Text color={isSel ? theme.selection : undefined}>{caret}</Text>
              <Text color={isSel ? theme.selection : theme.meta}>{row.expanded ? "▾ " : "▸ "}</Text>
              <Text color={groupColor(g.status, theme)}>{groupGlyph(g.status)} </Text>
              <Text color={isSel ? theme.selection : theme.checkName}>{truncate(g.title, 20).padEnd(20)} </Text>
              <Text color={theme.meta}>{`✓${g.counts.pass} ✗${g.counts.fail} •${g.counts.pending}`}</Text>
            </Box>
          );
        }
        const c = row.check;
        return (
          <Box key={rowId(row)}>
            <Text color={isSel ? theme.selection : undefined}>{caret}</Text>
            <Text color={theme.meta}>{"  "}</Text>
            <Text color={glyphColor(c, theme)}>{glyph(c)} </Text>
            <Text color={isSel ? theme.selection : theme.checkName}>{truncate(c.name, 20).padEnd(20)} </Text>
            <Text color={theme.meta}>{formatDuration(c.startedAt, c.completedAt)}</Text>
          </Box>
        );
      })}
      {overflow ? <Text color={theme.meta}>{`${win.above > 0 ? `↑${win.above} ` : ""}${win.below > 0 ? `↓${win.below} ` : ""}more`}</Text> : null}
    </Box>
  );
}
