export const STATUS_ROWS = 1;
export const PR_CHROME = 3;        // border(2) + "PRs" header(1)
export const CHECKS_CHROME = 5;    // border(2) + title + branch + divider
export const ANALYSIS_CHROME = 4;  // border(2) + title line(1) + hint footer(1)
export const PR_CAP = 8;
export const ANALYSIS_MIN_BODY = 6;
export const ANALYSIS_MAX_BODY = 14;
export const CHECKS_MIN_BODY = 3;
const ANALYSIS_FLOOR = 1;          // never render the pop-up with an empty body
const MIN_TOTAL = 8;

export interface LayoutInput { totalRows: number; prCount: number; analysisOpen: boolean; analysisBodyRows: number; }
export interface LayoutResult { prVisible: number; checksVisible: number; analysisVisible: number; }

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function computeLayout(input: LayoutInput): LayoutResult {
  const { totalRows, prCount, analysisOpen, analysisBodyRows } = input;
  const avail = Math.max(MIN_TOTAL, totalRows) - STATUS_ROWS;

  let prVisible = Math.max(1, Math.min(prCount === 0 ? 1 : prCount, PR_CAP));
  let analysisVisible = analysisOpen ? clamp(analysisBodyRows, ANALYSIS_MIN_BODY, ANALYSIS_MAX_BODY) : 0;

  const checks = () => avail - (PR_CHROME + prVisible) - (analysisOpen ? ANALYSIS_CHROME + analysisVisible : 0) - CHECKS_CHROME;

  // Checks keeps priority: it is reduced last (only by the final max(1, …) clamp).
  // Borrow from everything else first, in order — analysis to its body-min, then the
  // PR list to 1, then analysis to its hard floor of 1 (never empty). Below ~20 rows
  // with the pop-up open the minimal feasible sum exceeds the height, so not all
  // minimums can hold; checks then lands at >=1 rather than its preferred floor.
  while (checks() < CHECKS_MIN_BODY && analysisVisible > ANALYSIS_MIN_BODY) analysisVisible--;
  while (checks() < CHECKS_MIN_BODY && prVisible > 1) prVisible--;
  while (checks() < CHECKS_MIN_BODY && analysisVisible > ANALYSIS_FLOOR) analysisVisible--;

  return { prVisible, checksVisible: Math.max(1, checks()), analysisVisible };
}
