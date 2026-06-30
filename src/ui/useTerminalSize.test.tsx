import { render } from "ink-testing-library";
import { expect, test } from "vitest";
import React from "react";
import { Text } from "ink";
import { useTerminalSize } from "./useTerminalSize.js";

function Probe() {
  const { rows, columns } = useTerminalSize();
  return <Text>{`${columns}x${rows}`}</Text>;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test("reports fallback rows then updates on resize", async () => {
  const { lastFrame, stdout } = render(<Probe />);
  // ink-testing-library's fake stdout has columns=100 (getter) and no `rows`,
  // so the hook falls back to rows: 24.
  expect(lastFrame()).toMatch(/x24$/);
  // columns is a getter-only prototype prop and rows is absent; shadow both with
  // own data properties so the hook reads the new size on the next resize.
  Object.defineProperty(stdout, "columns", { value: 120, configurable: true });
  Object.defineProperty(stdout, "rows", { value: 40, configurable: true });
  stdout.emit("resize");
  await tick();
  expect(lastFrame()).toBe("120x40");
});
