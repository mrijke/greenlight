import React from "react";
import { Box, Text } from "ink";
import type { PullRequest, Check } from "../types.js";
import type { Theme } from "../theme.js";
import { formatDuration, glyph, glyphColor, truncate, windowRows } from "../format.js";

interface Props {
  pr: PullRequest | null;
  checks: Check[];
  checkCursor: number;
  focused: boolean;
  theme: Theme;
  height: number;
}

export function Detail({ pr, checks, checkCursor, focused, theme, height }: Props) {
  const borderColor = focused ? theme.selection : theme.border;
  if (!pr) {
    return (
      <Box flexGrow={1} borderStyle="round" borderColor={borderColor} paddingX={1}>
        <Text color={theme.meta}>Select a PR to see its checks.</Text>
      </Box>
    );
  }
  const { rows } = windowRows(checks, checkCursor, Math.max(1, height - 3));
  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={borderColor} paddingX={1}>
      <Text color={theme.title}>#{pr.number} {truncate(pr.title, 40)}</Text>
      <Text color={theme.meta}>{pr.headRefName} → {pr.baseRefName}{pr.isCrossRepository ? " (fork)" : ""}</Text>
      <Text color={theme.border}>{"─".repeat(30)}</Text>
      {rows.map((c, i) => {
        const isSel = checks.indexOf(c) === checkCursor;
        return (
          <Box key={c.name + i}>
            <Text color={glyphColor(c, theme)}>{glyph(c)} </Text>
            <Text color={isSel ? theme.selection : theme.checkName}>{truncate(c.name, 22).padEnd(22)} </Text>
            <Text color={theme.meta}>{formatDuration(c.startedAt, c.completedAt)}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
