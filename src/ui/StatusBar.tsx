import React from "react";
import { Box, Text } from "ink";
import type { Theme } from "../theme.js";

export function StatusBar({ hints, message, theme }: { hints: string; message: string | null; theme: Theme }) {
  return (
    <Box>
      {message ? <Text color={theme.error}>{message}</Text> : <Text color={theme.meta}>{hints}</Text>}
    </Box>
  );
}
