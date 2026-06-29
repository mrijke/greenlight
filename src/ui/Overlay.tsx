import React from "react";
import { Box, Text } from "ink";
import type { Theme } from "../theme.js";

export function ConfirmOverlay({ message, theme }: { message: string; theme: Theme }) {
  return (
    <Box flexDirection="column" borderStyle="double" borderColor={theme.flag} paddingX={2} paddingY={1}>
      <Text color={theme.title}>{message}</Text>
      <Text color={theme.meta}>(y/n)</Text>
    </Box>
  );
}

export function HelpOverlay({ theme }: { theme: Theme }) {
  const rows = [
    ["↑/↓ j/k", "move"], ["Tab h/l", "switch pane"], ["↵", "analyze check"],
    ["r", "refresh"], ["R", "rerun failed"], ["a", "LLM analyze"], ["o", "open in browser"], ["q", "quit"],
  ];
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.selection} paddingX={2} paddingY={1}>
      <Text color={theme.title}>Keybindings</Text>
      {rows.map(([k, d]) => <Text key={k}><Text color={theme.checkName}>{k.padEnd(10)}</Text><Text color={theme.meta}>{d}</Text></Text>)}
    </Box>
  );
}
