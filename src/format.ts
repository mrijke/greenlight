import type { Check } from "./types.js";
import type { Theme } from "./theme.js";

const FAIL_CONCL = new Set(["failure", "timed_out", "startup_failure", "cancelled"]);
const SKIP_CONCL = new Set(["skipped", "neutral", "stale"]);

export function glyph(check: Check): "✓" | "✗" | "•" | "⊘" {
  if (check.status !== "completed") return "•";
  if (check.conclusion === "success") return "✓";
  if (check.conclusion && FAIL_CONCL.has(check.conclusion)) return "✗";
  if (check.conclusion && SKIP_CONCL.has(check.conclusion)) return "⊘";
  return "•";
}

export function glyphColor(check: Check, theme: Theme): string {
  const g = glyph(check);
  return g === "✓" ? theme.pass : g === "✗" ? theme.fail : g === "⊘" ? theme.skip : theme.pending;
}

export function formatDuration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt) return "—";
  if (!completedAt) return "running";
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

export function truncate(s: string, width: number): string {
  return s.length <= width ? s : `${s.slice(0, Math.max(0, width - 1))}…`;
}

export function windowRows<T>(items: T[], cursor: number, height: number): { rows: T[]; offset: number } {
  if (items.length <= height) return { rows: items, offset: 0 };
  let offset = Math.min(Math.max(0, cursor - Math.floor(height / 2)), items.length - height);
  return { rows: items.slice(offset, offset + height), offset };
}

export function checkCounts(checks: Check[]): { pass: number; fail: number; pending: number } {
  let pass = 0, fail = 0, pending = 0;
  for (const c of checks) {
    const g = glyph(c);
    if (g === "✓") pass++; else if (g === "✗") fail++; else if (g === "•") pending++;
  }
  return { pass, fail, pending };
}
