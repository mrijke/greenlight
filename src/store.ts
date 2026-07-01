import type { Check, PullRequest } from "./types.js";
import { glyph } from "./format.js";
import { errorMessage } from "./errors.js";
import { isFailedConclusion } from "./github/rerun.js";

export interface Timer { setInterval(fn: () => void, ms: number): unknown; clearInterval(h: unknown): void; }

export interface StoreState {
  prs: PullRequest[];
  checks: Record<number, Check[]>;
  selectedPr: number | null;
  error: string | null;
  loadingPrs: boolean;
}

interface Deps {
  loadPrs: () => Promise<{ prs: PullRequest[]; checks: Record<number, Check[]> }>;
  loadChecks: (prNumber: number) => Promise<Check[]>;
  timer: Timer;
  listMs: number;
  checksMs: number;
}

export interface Store {
  getState(): StoreState;
  subscribe(fn: () => void): () => void;
  selectPr(n: number): void;
  refreshNow(): Promise<void>;
  markRequeued(prNumber: number, runIds: number[]): void;
  start(): void;
  stop(): void;
}

export function createStore(deps: Deps): Store {
  let state: StoreState = { prs: [], checks: {}, selectedPr: null, error: null, loadingPrs: false };
  const subs = new Set<() => void>();
  let prsInFlight = false;
  let checksInFlight = false;
  let listHandle: unknown, checksHandle: unknown;

  const emit = () => { for (const fn of subs) fn(); };
  const set = (patch: Partial<StoreState>) => { state = { ...state, ...patch }; emit(); };

  async function loadPrs() {
    if (prsInFlight) return;
    prsInFlight = true; set({ loadingPrs: true });
    try {
      const { prs, checks } = await deps.loadPrs();
      // Rebuild the checks map from list data (closed PRs drop out), but keep the
      // existing entry for the currently-selected PR — it's owned by loadChecks
      // (fast poll + stale guard). Read selectedPr *now*, after the await (S2).
      const sel = state.selectedPr;
      const merged: Record<number, Check[]> = {};
      for (const p of prs) {
        merged[p.number] = p.number === sel && state.checks[p.number] ? state.checks[p.number] : (checks[p.number] ?? []);
      }
      set({ prs, checks: merged, error: null });
    }
    catch (e) { set({ error: errorMessage(e) }); }
    finally { prsInFlight = false; set({ loadingPrs: false }); }
  }

  async function loadChecks() {
    const target = state.selectedPr;
    if (target == null || checksInFlight) return;
    checksInFlight = true;
    try {
      const result = await deps.loadChecks(target);
      if (state.selectedPr === target) set({ checks: { ...state.checks, [target]: result }, error: null });
    } catch (e) { set({ error: errorMessage(e) }); }
    finally { checksInFlight = false; }
  }

  const hasPending = () => {
    const c = state.selectedPr != null ? state.checks[state.selectedPr] : undefined;
    return !!c && c.some((x) => glyph(x) === "•");
  };

  return {
    getState: () => state,
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    selectPr(n) { set({ selectedPr: n }); void loadChecks(); },
    async refreshNow() { await Promise.all([loadPrs(), loadChecks()]); },
    markRequeued(prNumber, runIds) {
      const runSet = new Set(runIds);
      const cur = state.checks[prNumber];
      if (!cur || runSet.size === 0) return;
      const now = new Date().toISOString();
      // Only the failed checks are re-run by reRunWorkflowFailedJobs; passing
      // checks of the same run are untouched, so don't flip them to pending.
      const updated = cur.map((c) =>
        c.workflowRunId != null && runSet.has(c.workflowRunId) && isFailedConclusion(c.conclusion)
          ? { ...c, status: "in_progress" as const, conclusion: null, startedAt: now, completedAt: null }
          : c,
      );
      set({ checks: { ...state.checks, [prNumber]: updated } });
      // No immediate reload: GitHub hasn't propagated the new attempt yet, so a
      // refetch now would just clobber this optimistic flip with the stale failed
      // rollup. The flip makes hasPending() true, so the checks interval poll
      // resumes and reconciles once the new attempt shows up.
    },
    start() {
      listHandle = deps.timer.setInterval(() => void loadPrs(), deps.listMs);
      checksHandle = deps.timer.setInterval(() => { if (hasPending()) void loadChecks(); }, deps.checksMs);
      void loadPrs();
    },
    stop() { deps.timer.clearInterval(listHandle); deps.timer.clearInterval(checksHandle); },
  };
}
