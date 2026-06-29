import type { Check, PullRequest } from "./types.js";
import { glyph } from "./format.js";
import { errorMessage } from "./errors.js";

export interface Timer { setInterval(fn: () => void, ms: number): unknown; clearInterval(h: unknown): void; }

export interface StoreState {
  prs: PullRequest[];
  checks: Record<number, Check[]>;
  selectedPr: number | null;
  error: string | null;
  loadingPrs: boolean;
}

interface Deps {
  loadPrs: () => Promise<PullRequest[]>;
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
    try { set({ prs: await deps.loadPrs(), error: null }); }
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
      const updated = cur.map((c) =>
        c.workflowRunId != null && runSet.has(c.workflowRunId)
          ? { ...c, status: "in_progress" as const, conclusion: null, startedAt: now, completedAt: null }
          : c,
      );
      set({ checks: { ...state.checks, [prNumber]: updated } });
      void loadChecks(); // kick the fast poll immediately so the user sees movement
    },
    start() {
      listHandle = deps.timer.setInterval(() => void loadPrs(), deps.listMs);
      checksHandle = deps.timer.setInterval(() => { if (hasPending()) void loadChecks(); }, deps.checksMs);
      void loadPrs();
    },
    stop() { deps.timer.clearInterval(listHandle); deps.timer.clearInterval(checksHandle); },
  };
}
