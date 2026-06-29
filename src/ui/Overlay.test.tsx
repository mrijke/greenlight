import { render } from "ink-testing-library";
import { expect, test } from "vitest";
import React from "react";
import { ConfirmOverlay, HelpOverlay } from "./Overlay.js";
import { StatusBar } from "./StatusBar.js";
import { getTheme } from "../theme.js";

const theme = getTheme("mocha");

test("confirm overlay shows message and y/n", () => {
  const { lastFrame } = render(<ConfirmOverlay message="Rerun 3 failed jobs across 2 workflows?" theme={theme} />);
  expect(lastFrame()).toContain("Rerun 3 failed jobs");
  expect(lastFrame()).toMatch(/y\/n/i);
});

test("help overlay lists a key", () => {
  const { lastFrame } = render(<HelpOverlay theme={theme} />);
  expect(lastFrame()).toMatch(/rerun/i);
});

test("status bar shows message over hints", () => {
  const { lastFrame } = render(<StatusBar hints="↑↓ move" message="rerunning 3 jobs…" theme={theme} />);
  expect(lastFrame()).toContain("rerunning 3 jobs…");
});
