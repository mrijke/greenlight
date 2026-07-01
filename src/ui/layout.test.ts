import { expect, test } from "vitest";
import { computeLayout, PR_CAP, ANALYSIS_MIN_BODY } from "./layout.js";

test("fills height: regions sum within the terminal", () => {
  const r = computeLayout({ totalRows: 40, prCount: 3, analysisOpen: false, analysisBodyRows: 1 });
  // status(1) + prChrome(3)+prVisible + checksChrome(5)+checksVisible
  const used = 1 + 3 + r.prVisible + 5 + r.checksVisible;
  expect(used).toBeLessThanOrEqual(40);
  expect(r.prVisible).toBe(3);
  expect(r.analysisVisible).toBe(0);
  expect(r.checksVisible).toBeGreaterThan(10); // checks gets the lion's share
});

test("PR list is capped and auto-sized", () => {
  expect(computeLayout({ totalRows: 50, prCount: 1, analysisOpen: false, analysisBodyRows: 1 }).prVisible).toBe(1);
  expect(computeLayout({ totalRows: 50, prCount: 99, analysisOpen: false, analysisBodyRows: 1 }).prVisible).toBe(PR_CAP);
  expect(computeLayout({ totalRows: 50, prCount: 0, analysisOpen: false, analysisBodyRows: 1 }).prVisible).toBe(1);
});

test("opening analysis shrinks checks, not the PR list", () => {
  const closed = computeLayout({ totalRows: 40, prCount: 3, analysisOpen: false, analysisBodyRows: 8 });
  const open = computeLayout({ totalRows: 40, prCount: 3, analysisOpen: true, analysisBodyRows: 8 });
  expect(open.analysisVisible).toBe(8);
  expect(open.prVisible).toBe(closed.prVisible);
  expect(open.checksVisible).toBeLessThan(closed.checksVisible);
});

test("analysis body is clamped to its min and max", () => {
  expect(computeLayout({ totalRows: 60, prCount: 2, analysisOpen: true, analysisBodyRows: 1 }).analysisVisible).toBe(ANALYSIS_MIN_BODY);
  expect(computeLayout({ totalRows: 60, prCount: 2, analysisOpen: true, analysisBodyRows: 100 }).analysisVisible).toBe(14);
});

test("short terminal shrinks the PR list below its cap before clipping checks", () => {
  const r = computeLayout({ totalRows: 18, prCount: 8, analysisOpen: true, analysisBodyRows: 8 });
  expect(r.prVisible).toBeLessThan(PR_CAP);   // PR list yielded space
  expect(r.checksVisible).toBeGreaterThanOrEqual(1);
});

test("tiny terminal degrades gracefully: checks last, analysis never empty, all >= 1", () => {
  // At 16 rows with the pop-up open the minimal feasible sum (17) exceeds the height,
  // so checks cannot reach its floor of 3 — it lands at >= 1 after everything else yields.
  const r = computeLayout({ totalRows: 16, prCount: 5, analysisOpen: true, analysisBodyRows: 10 });
  expect(r.checksVisible).toBeGreaterThanOrEqual(1);
  expect(r.prVisible).toBe(1);                 // PR list borrowed down to 1
  expect(r.analysisVisible).toBeGreaterThanOrEqual(1); // pop-up never empty
  expect(r.analysisVisible).toBeLessThan(ANALYSIS_MIN_BODY); // squeezed below its body-min
});

test("a conflicting selected PR reserves one extra Detail header row", () => {
  const base = computeLayout({ totalRows: 40, prCount: 3, analysisOpen: false, analysisBodyRows: 1 });
  const conflict = computeLayout({ totalRows: 40, prCount: 3, analysisOpen: false, analysisBodyRows: 1, selectedConflicting: true });
  expect(conflict.checksVisible).toBe(base.checksVisible - 1);
});
