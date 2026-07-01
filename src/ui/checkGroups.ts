import type { Check } from "../types.js";
import type { Theme } from "../theme.js";
import { checkCounts } from "../format.js";

export type GroupStatus = "fail" | "pending" | "pass" | "skip";

export interface CheckGroup {
  key: string;
  title: string;
  checks: Check[];
  counts: { pass: number; fail: number; pending: number };
  status: GroupStatus;
}

export type Override = "expanded" | "collapsed";

export type Row =
  | { kind: "header"; group: CheckGroup; expanded: boolean }
  | { kind: "check"; check: Check; group: CheckGroup };

const OTHER_KEY = "__other__";

function groupStatus(counts: { pass: number; fail: number; pending: number }): GroupStatus {
  if (counts.fail > 0) return "fail";
  if (counts.pending > 0) return "pending";
  if (counts.pass > 0) return "pass";
  return "skip"; // checks present but all skipped/neutral (or empty)
}

// Sort by status first — failures on top, then in-progress, then passing, then
// all-skipped — with title breaking ties alphabetically. The identity-based cursor
// follows its group across the reordering a status transition causes. "Other" carries
// its own status like any group, so a failing legacy/third-party check surfaces on top.
const STATUS_RANK: Record<GroupStatus, number> = { fail: 0, pending: 1, pass: 2, skip: 3 };
function compareGroups(a: CheckGroup, b: CheckGroup): number {
  const byStatus = STATUS_RANK[a.status] - STATUS_RANK[b.status];
  if (byStatus !== 0) return byStatus;
  return a.title.toLowerCase().localeCompare(b.title.toLowerCase());
}

export function groupChecks(checks: Check[]): CheckGroup[] {
  const buckets = new Map<string, Check[]>();
  for (const c of checks) {
    const key = c.workflowRunId != null ? String(c.workflowRunId) : OTHER_KEY;
    let list = buckets.get(key);
    if (!list) { list = []; buckets.set(key, list); }
    list.push(c);
  }
  const groups: CheckGroup[] = [];
  for (const [key, list] of buckets) {
    const title = key === OTHER_KEY ? "Other" : (list.find((c) => c.workflowName)?.workflowName ?? "Workflow");
    const counts = checkCounts(list);
    groups.push({ key, title, checks: list, counts, status: groupStatus(counts) });
  }
  return groups.sort(compareGroups);
}

export function flattenRows(groups: CheckGroup[], expanded: Set<string>): Row[] {
  const rows: Row[] = [];
  for (const group of groups) {
    const isOpen = expanded.has(group.key);
    rows.push({ kind: "header", group, expanded: isOpen });
    if (isOpen) for (const check of group.checks) rows.push({ kind: "check", check, group });
  }
  return rows;
}

// Expansion is a pure function of current status plus sticky user overrides: a group is
// open iff it is failing, unless the user has explicitly overridden it.
export function deriveExpanded(groups: CheckGroup[], overrides: Map<string, Override>): Set<string> {
  const open = new Set<string>();
  for (const g of groups) {
    const o = overrides.get(g.key);
    if (o ? o === "expanded" : g.status === "fail") open.add(g.key);
  }
  return open;
}

// Stable identity for cursor tracking across polls (index-free).
export function rowId(row: Row): string {
  return row.kind === "header"
    ? `h:${row.group.key}`
    : `c:${row.check.checkRunId ?? `${row.group.key}:${row.check.name}`}`;
}

export function groupGlyph(status: GroupStatus): "✓" | "✗" | "•" | "⊘" {
  return status === "fail" ? "✗" : status === "pending" ? "•" : status === "skip" ? "⊘" : "✓";
}

export function groupColor(status: GroupStatus, theme: Theme): string {
  return status === "fail" ? theme.fail : status === "pending" ? theme.pending : status === "skip" ? theme.skip : theme.pass;
}
