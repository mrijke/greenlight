# Greenlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A terminal UI (`greenlight`) that lists the current user's open PRs in the current repo and their CI checks, lets them rerun failed jobs, and triages failures (heuristic + optional LLM).

**Architecture:** A pure data/logic core (auth, repo resolution, GitHub queries via Octokit, failure heuristics, LLM client, config) with no React imports, sitting under a framework-agnostic state store + poll engine. The Ink UI layer subscribes to the store and renders two panes; it owns no timers and no network calls. Everything network- or time-dependent is injected so it can be tested headless.

**Tech Stack:** Node ≥20, TypeScript, Ink 5 (React for the terminal), `octokit` (REST + GraphQL + built-in throttling), `execa` (shell out to `gh`/`git`), `openai` (LLM via any OpenAI-compatible endpoint), `zod` (config validation), Vitest + `ink-testing-library` (tests), `tsup` (build), `tsx` (dev).

## Global Constraints

- **Package manager is pnpm, not npm.** Wherever the plan shows an `npm`/`npx` command, use the pnpm equivalent: `pnpm install`, `pnpm test`, `pnpm exec vitest run <file>`, `pnpm build`, `pnpm typecheck`. Commit `pnpm-lock.yaml`; never create `package-lock.json`.
- Node ≥ 20; ESM (`"type": "module"`), `"module": "NodeNext"` in tsconfig.
- Binary names: `greenlight` and alias `gl`.
- GitHub access is Octokit only; the token comes from `gh auth token` → `GITHUB_TOKEN` env. No OAuth app, no token persisted to disk.
- Check list is built from GraphQL `statusCheckRollup` only. REST is used solely for rerun/log actions.
- LLM is opt-in via any OpenAI-compatible endpoint (`baseURL`/`apiKey`/`model`); default `baseURL` = `https://models.github.ai/inference`. Heuristics must work with zero LLM config. The `gh` token does NOT carry `models:read`, so the GitHub Models default is opt-in, never assumed working.
- No hard-coded colors in UI components — all hues come from the theme-token layer. v1 ships theme `mocha` only.
- Default poll intervals: checks 10000 ms, list 30000 ms. Polling pauses when no check is pending.
- TDD throughout: every behavior gets a failing test first. Commit after each task.

---

## File Structure

```
src/
  types.ts                 Shared domain types (no logic)
  auth.ts                  Token resolution (gh → env)
  octokit.ts               Octokit client factory (throttling on)
  repo.ts                  Fork-aware repo + viewer resolution (uses git + octokit)
  config.ts                Load/validate config (flags → env → file → defaults)
  theme.ts                 Theme-token layer + mocha palette
  github/
    prs.ts                 List my open PRs (GraphQL search)
    checks.ts              Unified checks via GraphQL statusCheckRollup
    rerun.ts               Rerun failed jobs (map checks → runs)
    logs.ts                Fetch + trim failed-job logs and annotations
  analysis/
    heuristic.ts           Pure flaky-vs-real classifier
    llm.ts                 Optional OpenAI-compatible analysis
  store.ts                 State store + poll engine (single-flight, injectable timer)
  format.ts                Pure UI helpers (glyphs, duration, truncate, window)
  ui/
    App.tsx                Shell: wires store, focus, keybindings, panes, status bar
    PrList.tsx             Left pane (windowed list)
    Detail.tsx             Right pane (header + checks table)
    Analysis.tsx           Failure analysis region
    Overlay.tsx            Confirm + help (view-swap, focus-trapped)
    StatusBar.tsx          Hints + transient messages
  cli.tsx                  Entry: arg parse, boot, render <App/>, top-level errors
test/fixtures/             Recorded JSON/text fixtures
```

Each `src/X.ts` has a colocated `src/X.test.ts` (or `src/**/X.test.ts`).

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `tsup.config.ts`, `src/types.ts`, `src/cli.tsx`, `.gitignore`
- Test: `src/smoke.test.ts`

**Interfaces:**
- Produces: the domain types in `src/types.ts` used by every later task.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "greenlight",
  "version": "0.1.0",
  "type": "module",
  "bin": { "greenlight": "dist/cli.js", "gl": "dist/cli.js" },
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "tsx src/cli.tsx",
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "execa": "^9.5.0",
    "ink": "^5.1.0",
    "ink-spinner": "^5.0.0",
    "octokit": "^4.0.0",
    "openai": "^4.67.0",
    "react": "^18.3.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.16.0",
    "@types/react": "^18.3.0",
    "ink-testing-library": "^4.0.0",
    "tsup": "^8.3.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`, `tsup.config.ts`, `.gitignore`**

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", include: ["src/**/*.test.ts", "src/**/*.test.tsx"] } });
```
`tsup.config.ts`:
```ts
import { defineConfig } from "tsup";
export default defineConfig({ entry: ["src/cli.tsx"], format: ["esm"], target: "node20", banner: { js: "#!/usr/bin/env node" }, clean: true });
```
`.gitignore`:
```
node_modules
dist
```

- [ ] **Step 4: Create `src/types.ts`**

```ts
export type CheckStatus = "queued" | "in_progress" | "completed";
export type CheckConclusion =
  | "success" | "failure" | "cancelled" | "skipped"
  | "timed_out" | "action_required" | "neutral" | "stale" | "startup_failure" | null;

export interface Check {
  name: string;
  status: CheckStatus;
  conclusion: CheckConclusion;
  detailsUrl: string | null;
  startedAt: string | null;
  completedAt: string | null;
  checkRunId: number | null;     // CheckRun.databaseId — for annotations
  checkSuiteId: number | null;   // CheckSuite.databaseId
  workflowRunId: number | null;  // CheckSuite.workflowRun.databaseId — for rerun/logs
  isStatusContext: boolean;      // legacy commit status vs Actions check run
}

export interface PullRequest {
  number: number;
  title: string;
  headRefName: string;
  baseRefName: string;
  headSha: string;
  url: string;
  isCrossRepository: boolean;    // fork PR
}

export interface RepoTarget {
  owner: string;
  repo: string;
  viewerLogin: string;
  viewerCanWrite: boolean;
}

export type FlakyVerdict = "likely_flaky" | "likely_real" | "unclear";

export interface HeuristicResult {
  verdict: FlakyVerdict;
  confidence: number;            // 0..1
  failingStep: string | null;
  errorLines: string[];
  signals: string[];
}

export interface FailureContext {
  jobName: string;
  failingStep: string | null;
  logSlice: string;
  annotations: { path: string; message: string; level: string }[];
  runAttempt: number;
}
```

- [ ] **Step 5: Write smoke test** — `src/smoke.test.ts`

```ts
import { expect, test } from "vitest";
import type { Check } from "./types.js";
test("types module imports", () => {
  const c: Check = { name: "x", status: "completed", conclusion: "success", detailsUrl: null, startedAt: null, completedAt: null, checkRunId: null, checkSuiteId: null, workflowRunId: null, isStatusContext: false };
  expect(c.name).toBe("x");
});
```

- [ ] **Step 6: Install + verify**

Run: `npm install && npm test`
Expected: 1 passing test.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "chore: scaffold greenlight project"
```

---

### Task 2: Token resolution (`auth.ts`)

**Files:**
- Create: `src/auth.ts`
- Test: `src/auth.test.ts`

**Interfaces:**
- Produces: `resolveToken(deps?: { run?: Runner; env?: NodeJS.ProcessEnv }): Promise<string>` where `Runner = (cmd: string, args: string[]) => Promise<{ stdout: string }>`. Throws `Error` with a user-facing message if no token.

- [ ] **Step 1: Write failing tests** — `src/auth.test.ts`

```ts
import { expect, test, vi } from "vitest";
import { resolveToken } from "./auth.js";

test("uses gh auth token when available", async () => {
  const run = vi.fn().mockResolvedValue({ stdout: "gho_abc\n" });
  await expect(resolveToken({ run, env: {} })).resolves.toBe("gho_abc");
  expect(run).toHaveBeenCalledWith("gh", ["auth", "token"]);
});

test("falls back to GITHUB_TOKEN when gh fails", async () => {
  const run = vi.fn().mockRejectedValue(new Error("not found"));
  await expect(resolveToken({ run, env: { GITHUB_TOKEN: "ght_xyz" } })).resolves.toBe("ght_xyz");
});

test("throws a helpful error when no token anywhere", async () => {
  const run = vi.fn().mockRejectedValue(new Error("not found"));
  await expect(resolveToken({ run, env: {} })).rejects.toThrow(/gh auth login|GITHUB_TOKEN/);
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run src/auth.test.ts`
Expected: FAIL (`resolveToken` not exported).

- [ ] **Step 3: Implement** — `src/auth.ts`

```ts
import { execa } from "execa";

export type Runner = (cmd: string, args: string[]) => Promise<{ stdout: string }>;
const defaultRun: Runner = (cmd, args) => execa(cmd, args);

export async function resolveToken(
  deps: { run?: Runner; env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
  const run = deps.run ?? defaultRun;
  const env = deps.env ?? process.env;
  try {
    const { stdout } = await run("gh", ["auth", "token"]);
    const token = stdout.trim();
    if (token) return token;
  } catch {
    // fall through to env
  }
  const envToken = env.GITHUB_TOKEN?.trim();
  if (envToken) return envToken;
  throw new Error("No GitHub token found. Run `gh auth login` or set GITHUB_TOKEN.");
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run src/auth.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/auth.ts src/auth.test.ts && git commit -m "feat: resolve GitHub token from gh or env"
```

---

### Task 3: Octokit client factory (`octokit.ts`)

**Files:**
- Create: `src/octokit.ts`
- Test: `src/octokit.test.ts`

**Interfaces:**
- Produces: `createOctokit(token: string): Octokit` (from the `octokit` package), with throttling enabled and a one-retry backoff policy. Later tasks accept an `Octokit` instance as a parameter (dependency injection) — they never call `createOctokit` themselves.

- [ ] **Step 1: Write failing test** — `src/octokit.test.ts`

```ts
import { expect, test } from "vitest";
import { createOctokit } from "./octokit.js";

test("creates an Octokit with graphql + rest available", () => {
  const o = createOctokit("ght_test");
  expect(typeof o.graphql).toBe("function");
  expect(typeof o.rest.actions.reRunWorkflowFailedJobs).toBe("function");
});
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run src/octokit.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `src/octokit.ts`

```ts
import { Octokit } from "octokit";

export function createOctokit(token: string): Octokit {
  return new Octokit({
    auth: token,
    throttle: {
      onRateLimit: (retryAfter, options, o, retryCount) => retryCount < 1,
      onSecondaryRateLimit: (retryAfter, options, o, retryCount) => retryCount < 1,
    },
  });
}
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run src/octokit.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/octokit.ts src/octokit.test.ts && git commit -m "feat: octokit factory with throttling"
```

---

### Task 4: Fork-aware repo resolution (`repo.ts`)

**Files:**
- Create: `src/repo.ts`
- Test: `src/repo.test.ts`

**Interfaces:**
- Consumes: `Octokit` (only `.rest.repos.get`, `.graphql`), a `Runner` for `git`.
- Produces:
  - `parseRemote(url: string): { owner: string; repo: string } | null`
  - `resolveTarget(octokit, deps?): Promise<RepoTarget>` — reads `git remote get-url origin`, follows `.parent` if the repo is a fork, resolves viewer login + write permission. Accepts `{ run?: Runner; override?: string }`.

- [ ] **Step 1: Write failing tests** — `src/repo.test.ts`

```ts
import { expect, test, vi } from "vitest";
import { parseRemote, resolveTarget } from "./repo.js";

test("parseRemote handles ssh and https", () => {
  expect(parseRemote("git@github.com:me/forkrepo.git")).toEqual({ owner: "me", repo: "forkrepo" });
  expect(parseRemote("https://github.com/acme/widget.git")).toEqual({ owner: "acme", repo: "widget" });
  expect(parseRemote("not-a-url")).toBeNull();
});

test("resolveTarget follows fork parent and reads viewer permission", async () => {
  const run = vi.fn().mockResolvedValue({ stdout: "git@github.com:me/widget.git\n" });
  const octokit: any = {
    rest: {
      repos: {
        get: vi.fn().mockResolvedValue({ data: { fork: true, parent: { owner: { login: "acme" }, name: "widget" } } }),
        getCollaboratorPermissionLevel: vi.fn().mockResolvedValue({ data: { permission: "write" } }),
      },
    },
    graphql: vi.fn().mockResolvedValue({ viewer: { login: "me" } }),
  };
  const t = await resolveTarget(octokit, { run });
  expect(t).toEqual({ owner: "acme", repo: "widget", viewerLogin: "me", viewerCanWrite: true });
});

test("resolveTarget honors override and non-fork", async () => {
  const run = vi.fn();
  const octokit: any = {
    rest: {
      repos: {
        get: vi.fn().mockResolvedValue({ data: { fork: false } }),
        getCollaboratorPermissionLevel: vi.fn().mockResolvedValue({ data: { permission: "read" } }),
      },
    },
    graphql: vi.fn().mockResolvedValue({ viewer: { login: "me" } }),
  };
  const t = await resolveTarget(octokit, { run, override: "acme/widget" });
  expect(run).not.toHaveBeenCalled();
  expect(t.viewerCanWrite).toBe(false);
});
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run src/repo.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `src/repo.ts`

```ts
import { execa } from "execa";
import type { Octokit } from "octokit";
import type { RepoTarget } from "./types.js";

export type Runner = (cmd: string, args: string[]) => Promise<{ stdout: string }>;
const defaultRun: Runner = (cmd, args) => execa(cmd, args);

export function parseRemote(url: string): { owner: string; repo: string } | null {
  const m = url.trim().match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

export async function resolveTarget(
  octokit: Octokit,
  deps: { run?: Runner; override?: string } = {},
): Promise<RepoTarget> {
  const run = deps.run ?? defaultRun;

  let owner: string, repo: string;
  if (deps.override) {
    const [o, r] = deps.override.split("/");
    if (!o || !r) throw new Error(`Invalid repo override "${deps.override}" (expected owner/name).`);
    [owner, repo] = [o, r];
  } else {
    const { stdout } = await run("git", ["remote", "get-url", "origin"]);
    const parsed = parseRemote(stdout);
    if (!parsed) throw new Error("Could not determine GitHub repo from `git remote origin`.");
    ({ owner, repo } = parsed);
  }

  const { data: meta } = await octokit.rest.repos.get({ owner, repo });
  if (!deps.override && meta.fork && meta.parent) {
    owner = meta.parent.owner.login;
    repo = meta.parent.name;
  }

  const { viewer } = await octokit.graphql<{ viewer: { login: string } }>(`{ viewer { login } }`);

  let viewerCanWrite = false;
  try {
    const { data: perm } = await octokit.rest.repos.getCollaboratorPermissionLevel({ owner, repo, username: viewer.login });
    viewerCanWrite = perm.permission === "write" || perm.permission === "admin" || perm.permission === "maintain";
  } catch {
    viewerCanWrite = false;
  }

  return { owner, repo, viewerLogin: viewer.login, viewerCanWrite };
}
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run src/repo.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/repo.ts src/repo.test.ts && git commit -m "feat: fork-aware repo + viewer resolution"
```

---

### Task 5: List my open PRs (`github/prs.ts`)

**Files:**
- Create: `src/github/prs.ts`, `test/fixtures/prs-search.json`
- Test: `src/github/prs.test.ts`

**Interfaces:**
- Consumes: `Octokit` (`.graphql`), `RepoTarget`.
- Produces: `listMyOpenPrs(octokit, target: RepoTarget): Promise<PullRequest[]>`.

- [ ] **Step 1: Create fixture** — `test/fixtures/prs-search.json`

```json
{ "search": { "nodes": [
  { "number": 142, "title": "Fix auth flow", "url": "https://github.com/acme/widget/pull/142", "isCrossRepository": false, "headRefName": "feat/auth", "baseRefName": "main", "headRefOid": "abc123" },
  { "number": 138, "title": "Bump deps", "url": "https://github.com/acme/widget/pull/138", "isCrossRepository": false, "headRefName": "deps", "baseRefName": "main", "headRefOid": "def456" }
] } }
```

- [ ] **Step 2: Write failing test** — `src/github/prs.test.ts`

```ts
import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { listMyOpenPrs } from "./prs.js";
import type { RepoTarget } from "../types.js";

const fixture = JSON.parse(readFileSync(new URL("../../test/fixtures/prs-search.json", import.meta.url), "utf8"));
const target: RepoTarget = { owner: "acme", repo: "widget", viewerLogin: "me", viewerCanWrite: true };

test("maps GraphQL search results to PullRequest[] and builds the query", async () => {
  const graphql = vi.fn().mockResolvedValue(fixture);
  const prs = await listMyOpenPrs({ graphql } as any, target);
  expect(graphql).toHaveBeenCalledWith(expect.any(String), { q: "repo:acme/widget is:pr is:open author:@me sort:updated-desc" });
  expect(prs[0]).toEqual({ number: 142, title: "Fix auth flow", url: "https://github.com/acme/widget/pull/142", isCrossRepository: false, headRefName: "feat/auth", baseRefName: "main", headSha: "abc123" });
  expect(prs).toHaveLength(2);
});
```

- [ ] **Step 3: Run, verify fail** — FAIL.

- [ ] **Step 4: Implement** — `src/github/prs.ts`

```ts
import type { Octokit } from "octokit";
import type { PullRequest, RepoTarget } from "../types.js";

const QUERY = `
query($q: String!) {
  search(query: $q, type: ISSUE, first: 50) {
    nodes {
      ... on PullRequest {
        number title url isCrossRepository
        headRefName baseRefName headRefOid
      }
    }
  }
}`;

interface SearchNode {
  number: number; title: string; url: string; isCrossRepository: boolean;
  headRefName: string; baseRefName: string; headRefOid: string;
}

export async function listMyOpenPrs(octokit: Pick<Octokit, "graphql">, target: RepoTarget): Promise<PullRequest[]> {
  const q = `repo:${target.owner}/${target.repo} is:pr is:open author:@me sort:updated-desc`;
  const res = await octokit.graphql<{ search: { nodes: SearchNode[] } }>(QUERY, { q });
  return res.search.nodes
    .filter((n) => typeof n.number === "number")
    .map((n) => ({
      number: n.number, title: n.title, url: n.url, isCrossRepository: n.isCrossRepository,
      headRefName: n.headRefName, baseRefName: n.baseRefName, headSha: n.headRefOid,
    }));
}
```

- [ ] **Step 5: Run, verify pass** — PASS.

- [ ] **Step 6: Commit**

```bash
git add src/github/prs.ts src/github/prs.test.ts test/fixtures/prs-search.json && git commit -m "feat: list my open PRs via GraphQL search"
```

---

### Task 6: Unified checks via `statusCheckRollup` (`github/checks.ts`)

**Files:**
- Create: `src/github/checks.ts`, `test/fixtures/rollup.json`
- Test: `src/github/checks.test.ts`

**Interfaces:**
- Consumes: `Octokit` (`.graphql`), `RepoTarget`, PR number.
- Produces: `fetchChecks(octokit, target, prNumber: number): Promise<Check[]>`.

- [ ] **Step 1: Create fixture** — `test/fixtures/rollup.json`

```json
{ "repository": { "pullRequest": { "commits": { "nodes": [ { "commit": { "statusCheckRollup": { "contexts": { "nodes": [
  { "__typename": "CheckRun", "name": "build", "status": "COMPLETED", "conclusion": "SUCCESS", "detailsUrl": "https://x/1", "startedAt": "2026-06-29T10:00:00Z", "completedAt": "2026-06-29T10:01:12Z", "databaseId": 11, "checkSuite": { "databaseId": 91, "workflowRun": { "databaseId": 501 } } },
  { "__typename": "CheckRun", "name": "test (unit)", "status": "COMPLETED", "conclusion": "FAILURE", "detailsUrl": "https://x/2", "startedAt": "2026-06-29T10:00:00Z", "completedAt": "2026-06-29T10:00:44Z", "databaseId": 12, "checkSuite": { "databaseId": 91, "workflowRun": { "databaseId": 501 } } },
  { "__typename": "StatusContext", "context": "ci/legacy", "state": "SUCCESS", "targetUrl": "https://x/3", "createdAt": "2026-06-29T10:00:00Z" }
] } } } } ] } } } }
```

- [ ] **Step 2: Write failing test** — `src/github/checks.test.ts`

```ts
import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { fetchChecks } from "./checks.js";
import type { RepoTarget } from "../types.js";

const fixture = JSON.parse(readFileSync(new URL("../../test/fixtures/rollup.json", import.meta.url), "utf8"));
const target: RepoTarget = { owner: "acme", repo: "widget", viewerLogin: "me", viewerCanWrite: true };

test("normalizes check runs and legacy status contexts", async () => {
  const graphql = vi.fn().mockResolvedValue(fixture);
  const checks = await fetchChecks({ graphql } as any, target, 142);
  expect(checks).toHaveLength(3);
  const fail = checks.find((c) => c.name === "test (unit)")!;
  expect(fail.conclusion).toBe("failure");
  expect(fail.workflowRunId).toBe(501);
  expect(fail.checkRunId).toBe(12);
  expect(fail.isStatusContext).toBe(false);
  const legacy = checks.find((c) => c.name === "ci/legacy")!;
  expect(legacy.isStatusContext).toBe(true);
  expect(legacy.conclusion).toBe("success");
  expect(legacy.status).toBe("completed");
});

test("empty rollup yields no checks", async () => {
  const graphql = vi.fn().mockResolvedValue({ repository: { pullRequest: { commits: { nodes: [{ commit: { statusCheckRollup: null } }] } } } });
  expect(await fetchChecks({ graphql } as any, target, 1)).toEqual([]);
});
```

- [ ] **Step 3: Run, verify fail** — FAIL.

- [ ] **Step 4: Implement** — `src/github/checks.ts`

```ts
import type { Octokit } from "octokit";
import type { Check, CheckConclusion, CheckStatus, RepoTarget } from "../types.js";

const QUERY = `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
        __typename
        ... on CheckRun {
          name status conclusion detailsUrl startedAt completedAt databaseId
          checkSuite { databaseId workflowRun { databaseId } }
        }
        ... on StatusContext { context state targetUrl createdAt }
      } } } } } }
    }
  }
}`;

const mapStatus = (s: string): CheckStatus =>
  s === "COMPLETED" ? "completed" : s === "IN_PROGRESS" ? "in_progress" : "queued";
const mapConclusion = (c: string | null): CheckConclusion =>
  (c ? (c.toLowerCase() as CheckConclusion) : null);
// Legacy StatusContext.state: SUCCESS | FAILURE | ERROR | PENDING | EXPECTED
const mapStateStatus = (state: string): CheckStatus => (state === "PENDING" || state === "EXPECTED" ? "in_progress" : "completed");
const mapStateConclusion = (state: string): CheckConclusion =>
  state === "SUCCESS" ? "success" : state === "PENDING" || state === "EXPECTED" ? null : "failure";

export async function fetchChecks(octokit: Pick<Octokit, "graphql">, target: RepoTarget, prNumber: number): Promise<Check[]> {
  const res = await octokit.graphql<any>(QUERY, { owner: target.owner, repo: target.repo, number: prNumber });
  const rollup = res?.repository?.pullRequest?.commits?.nodes?.[0]?.commit?.statusCheckRollup;
  const nodes: any[] = rollup?.contexts?.nodes ?? [];
  return nodes.map((n): Check => {
    if (n.__typename === "CheckRun") {
      return {
        name: n.name, status: mapStatus(n.status), conclusion: mapConclusion(n.conclusion),
        detailsUrl: n.detailsUrl ?? null, startedAt: n.startedAt ?? null, completedAt: n.completedAt ?? null,
        checkRunId: n.databaseId ?? null, checkSuiteId: n.checkSuite?.databaseId ?? null,
        workflowRunId: n.checkSuite?.workflowRun?.databaseId ?? null, isStatusContext: false,
      };
    }
    return {
      name: n.context, status: mapStateStatus(n.state), conclusion: mapStateConclusion(n.state),
      detailsUrl: n.targetUrl ?? null, startedAt: n.createdAt ?? null, completedAt: null,
      checkRunId: null, checkSuiteId: null, workflowRunId: null, isStatusContext: true,
    };
  });
}
```

- [ ] **Step 5: Run, verify pass** — PASS.

- [ ] **Step 6: Commit**

```bash
git add src/github/checks.ts src/github/checks.test.ts test/fixtures/rollup.json && git commit -m "feat: unified checks via statusCheckRollup"
```

---

### Task 7: Rerun failed jobs (`github/rerun.ts`)

**Files:**
- Create: `src/github/rerun.ts`
- Test: `src/github/rerun.test.ts`

**Interfaces:**
- Consumes: `Octokit` (`.rest.actions.reRunWorkflowFailedJobs`), `RepoTarget`, `Check[]`.
- Produces:
  - `failedRunIds(checks: Check[]): number[]` (unique workflow run ids whose check failed/timed_out)
  - `rerunFailed(octokit, target, checks): Promise<{ rerun: number[] }>`.

- [ ] **Step 1: Write failing tests** — `src/github/rerun.test.ts`

```ts
import { expect, test, vi } from "vitest";
import { failedRunIds, rerunFailed } from "./rerun.js";
import type { Check, RepoTarget } from "../types.js";

const target: RepoTarget = { owner: "acme", repo: "widget", viewerLogin: "me", viewerCanWrite: true };
const mk = (over: Partial<Check>): Check => ({ name: "c", status: "completed", conclusion: "success", detailsUrl: null, startedAt: null, completedAt: null, checkRunId: null, checkSuiteId: null, workflowRunId: null, isStatusContext: false, ...over });

test("failedRunIds dedups runs and ignores passing/non-failure checks", () => {
  const checks = [
    mk({ conclusion: "failure", workflowRunId: 501 }),
    mk({ conclusion: "failure", workflowRunId: 501 }),
    mk({ conclusion: "timed_out", workflowRunId: 777 }),
    mk({ conclusion: "success", workflowRunId: 900 }),
  ];
  expect(failedRunIds(checks)).toEqual([501, 777]);
});

test("rerunFailed calls reRunWorkflowFailedJobs once per failed run", async () => {
  const reRunWorkflowFailedJobs = vi.fn().mockResolvedValue({});
  const octokit: any = { rest: { actions: { reRunWorkflowFailedJobs } } };
  const res = await rerunFailed(octokit, target, [mk({ conclusion: "failure", workflowRunId: 501 }), mk({ conclusion: "failure", workflowRunId: 777 })]);
  expect(res.rerun).toEqual([501, 777]);
  expect(reRunWorkflowFailedJobs).toHaveBeenCalledTimes(2);
  expect(reRunWorkflowFailedJobs).toHaveBeenCalledWith({ owner: "acme", repo: "widget", run_id: 501 });
});
```

- [ ] **Step 2: Run, verify fail** — FAIL.

- [ ] **Step 3: Implement** — `src/github/rerun.ts`

```ts
import type { Octokit } from "octokit";
import type { Check, RepoTarget } from "../types.js";

const FAILED: ReadonlySet<string> = new Set(["failure", "timed_out", "startup_failure", "cancelled"]);

export function failedRunIds(checks: Check[]): number[] {
  const ids = new Set<number>();
  for (const c of checks) {
    if (c.workflowRunId != null && c.conclusion && FAILED.has(c.conclusion)) ids.add(c.workflowRunId);
  }
  return [...ids];
}

export async function rerunFailed(
  octokit: Pick<Octokit, "rest">, target: RepoTarget, checks: Check[],
): Promise<{ rerun: number[] }> {
  const ids = failedRunIds(checks);
  for (const run_id of ids) {
    await octokit.rest.actions.reRunWorkflowFailedJobs({ owner: target.owner, repo: target.repo, run_id });
  }
  return { rerun: ids };
}
```

- [ ] **Step 4: Run, verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/github/rerun.ts src/github/rerun.test.ts && git commit -m "feat: rerun failed jobs per workflow run"
```

---

### Task 8: Fetch + trim failure context (`github/logs.ts`)

**Files:**
- Create: `src/github/logs.ts`
- Test: `src/github/logs.test.ts`

**Interfaces:**
- Consumes: `Octokit` (`.rest.actions.listJobsForWorkflowRun`, `.rest.actions.downloadJobLogsForJob`, `.rest.checks.listAnnotations`), `RepoTarget`, `Check`.
- Produces:
  - `trimLog(raw: string, maxLines?: number): string`
  - `fetchFailureContext(octokit, target, check): Promise<FailureContext>` (throws `Error("logs expired")` on 410).

- [ ] **Step 1: Write failing tests** — `src/github/logs.test.ts`

```ts
import { expect, test, vi } from "vitest";
import { fetchFailureContext, trimLog } from "./logs.js";
import type { Check, RepoTarget } from "../types.js";

const target: RepoTarget = { owner: "acme", repo: "widget", viewerLogin: "me", viewerCanWrite: true };
const check: Check = { name: "test (unit)", status: "completed", conclusion: "failure", detailsUrl: null, startedAt: null, completedAt: null, checkRunId: 12, checkSuiteId: 91, workflowRunId: 501, isStatusContext: false };

test("trimLog keeps the tail within maxLines", () => {
  const raw = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");
  const out = trimLog(raw, 10).split("\n");
  expect(out).toHaveLength(10);
  expect(out.at(-1)).toBe("line 499");
});

test("fetchFailureContext picks the matching failed job, trims, and reads annotations", async () => {
  const octokit: any = { rest: { actions: {
    listJobsForWorkflowRun: vi.fn().mockResolvedValue({ data: { jobs: [
      { name: "build", conclusion: "success", steps: [], run_attempt: 1 },
      { id: 999, name: "test (unit)", conclusion: "failure", run_attempt: 1, steps: [ { name: "Run tests", conclusion: "failure" } ] },
    ] } }),
    downloadJobLogsForJob: vi.fn().mockResolvedValue({ data: "AssertionError: expected 1 to equal 2\nstack..." }),
  }, checks: {
    listAnnotations: vi.fn().mockResolvedValue({ data: [ { path: "a.ts", message: "boom", annotation_level: "failure" } ] }),
  } } };
  const ctx = await fetchFailureContext(octokit, target, check);
  expect(ctx.jobName).toBe("test (unit)");
  expect(ctx.failingStep).toBe("Run tests");
  expect(ctx.logSlice).toContain("AssertionError");
  expect(ctx.annotations[0]).toEqual({ path: "a.ts", message: "boom", level: "failure" });
  expect(ctx.runAttempt).toBe(1);
});

test("fetchFailureContext surfaces expired logs (410)", async () => {
  const octokit: any = { rest: { actions: {
    listJobsForWorkflowRun: vi.fn().mockResolvedValue({ data: { jobs: [ { id: 999, name: "test (unit)", conclusion: "failure", run_attempt: 2, steps: [] } ] } }),
    downloadJobLogsForJob: vi.fn().mockRejectedValue(Object.assign(new Error("Gone"), { status: 410 })),
  }, checks: { listAnnotations: vi.fn().mockResolvedValue({ data: [] }) } } };
  await expect(fetchFailureContext(octokit, target, check)).rejects.toThrow(/logs expired/);
});
```

- [ ] **Step 2: Run, verify fail** — FAIL.

- [ ] **Step 3: Implement** — `src/github/logs.ts`

```ts
import type { Octokit } from "octokit";
import type { Check, FailureContext, RepoTarget } from "../types.js";

export function trimLog(raw: string, maxLines = 200): string {
  const lines = raw.split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - maxLines)).join("\n");
}

export async function fetchFailureContext(octokit: Pick<Octokit, "rest">, target: RepoTarget, check: Check): Promise<FailureContext> {
  if (check.workflowRunId == null) throw new Error("This check has no associated workflow run (no logs available).");
  const { owner, repo } = target;
  const { data } = await octokit.rest.actions.listJobsForWorkflowRun({ owner, repo, run_id: check.workflowRunId, per_page: 100 });
  const jobs = data.jobs ?? [];
  const failed = jobs.filter((j: any) => j.conclusion === "failure" || j.conclusion === "timed_out");
  const job = failed.find((j: any) => j.name === check.name) ?? failed[0] ?? jobs[0];
  if (!job) throw new Error("No jobs found for this run.");

  const failingStep = (job.steps ?? []).find((s: any) => s.conclusion === "failure" || s.conclusion === "timed_out")?.name ?? null;

  let logSlice = "";
  try {
    const res = await octokit.rest.actions.downloadJobLogsForJob({ owner, repo, job_id: job.id });
    logSlice = trimLog(String(res.data ?? ""));
  } catch (err: any) {
    if (err?.status === 410) throw new Error("logs expired for this run");
    throw err;
  }

  let annotations: FailureContext["annotations"] = [];
  if (check.checkRunId != null) {
    const { data: ann } = await octokit.rest.checks.listAnnotations({ owner, repo, check_run_id: check.checkRunId, per_page: 50 });
    annotations = ann.map((a: any) => ({ path: a.path, message: a.message ?? "", level: a.annotation_level ?? "notice" }));
  }

  return { jobName: job.name, failingStep, logSlice, annotations, runAttempt: job.run_attempt ?? 1 };
}
```

- [ ] **Step 4: Run, verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/github/logs.ts src/github/logs.test.ts && git commit -m "feat: fetch and trim failed-job logs + annotations"
```

---

### Task 9: Heuristic flaky-vs-real classifier (`analysis/heuristic.ts`)

**Files:**
- Create: `src/analysis/heuristic.ts`
- Test: `src/analysis/heuristic.test.ts`

**Interfaces:**
- Consumes: `FailureContext`, `Check`.
- Produces: `classify(ctx: FailureContext, check: Check): HeuristicResult`.

- [ ] **Step 1: Write failing tests** — `src/analysis/heuristic.test.ts`

```ts
import { expect, test } from "vitest";
import { classify } from "./heuristic.js";
import type { Check, FailureContext } from "../types.js";

const baseCheck: Check = { name: "test", status: "completed", conclusion: "failure", detailsUrl: null, startedAt: null, completedAt: null, checkRunId: 1, checkSuiteId: 1, workflowRunId: 1, isStatusContext: false };
const ctx = (over: Partial<FailureContext>): FailureContext => ({ jobName: "test", failingStep: "Run tests", logSlice: "", annotations: [], runAttempt: 1, ...over });

test("network timeout reads as likely flaky", () => {
  const r = classify(ctx({ logSlice: "Error: connect ETIMEDOUT 10.0.0.1:443\nnpm ERR! network" }), baseCheck);
  expect(r.verdict).toBe("likely_flaky");
  expect(r.signals).toContain("network");
});

test("OOM / exit 137 reads as likely flaky (infra)", () => {
  const r = classify(ctx({ logSlice: "Container killed\nProcess completed with exit code 137." }), baseCheck);
  expect(r.verdict).toBe("likely_flaky");
  expect(r.signals).toContain("oom");
});

test("assertion failure reads as likely real", () => {
  const r = classify(ctx({ logSlice: "AssertionError: expected 1 to equal 2\n  at test.spec.ts:10" }), baseCheck);
  expect(r.verdict).toBe("likely_real");
  expect(r.signals).toContain("assertion");
});

test("compile/type error reads as likely real", () => {
  const r = classify(ctx({ logSlice: "src/x.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'." }), baseCheck);
  expect(r.verdict).toBe("likely_real");
});

test("retry attempt with no strong signal nudges toward flaky", () => {
  const r = classify(ctx({ logSlice: "some unrecognized failure output", runAttempt: 3 }), baseCheck);
  expect(r.signals).toContain("retried");
});

test("no recognizable signal is unclear", () => {
  const r = classify(ctx({ logSlice: "totally opaque failure" }), baseCheck);
  expect(r.verdict).toBe("unclear");
  expect(r.errorLines.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run, verify fail** — FAIL.

- [ ] **Step 3: Implement** — `src/analysis/heuristic.ts`

```ts
import type { Check, FailureContext, FlakyVerdict, HeuristicResult } from "../types.js";

const FLAKY_PATTERNS: { signal: string; re: RegExp }[] = [
  { signal: "network", re: /(ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|network\s*error|getaddrinfo|503 Service|502 Bad Gateway|429 Too Many)/i },
  { signal: "oom", re: /(exit code 137|out of memory|OOMKilled|Container killed|Cannot allocate memory|signal 9)/i },
  { signal: "timeout", re: /(timed out|timeout exceeded|deadline exceeded|cancel(l)?ed after)/i },
  { signal: "infra", re: /(The runner has received a shutdown signal|Lost communication with the server|rate limit exceeded)/i },
];

const REAL_PATTERNS: { signal: string; re: RegExp }[] = [
  { signal: "assertion", re: /(AssertionError|expected .+ (to|but)\b|✕|FAIL\b|Expected:|Received:)/ },
  { signal: "compile", re: /(error TS\d+|SyntaxError|cannot find module|is not assignable to|undefined reference|compilation failed)/i },
  { signal: "lint", re: /(eslint|lint error|\d+ problems?\s*\(\d+ errors?)/i },
];

export function classify(ctx: FailureContext, check: Check): HeuristicResult {
  const haystack = `${ctx.logSlice}\n${ctx.annotations.map((a) => a.message).join("\n")}`;
  const signals: string[] = [];

  let flakyScore = 0;
  let realScore = 0;
  for (const { signal, re } of FLAKY_PATTERNS) if (re.test(haystack)) { signals.push(signal); flakyScore += 1; }
  for (const { signal, re } of REAL_PATTERNS) if (re.test(haystack)) { signals.push(signal); realScore += 1; }

  if (check.conclusion === "timed_out") { signals.push("timeout"); flakyScore += 1; }
  if (ctx.runAttempt > 1) { signals.push("retried"); flakyScore += 0.5; }

  const errorLines = ctx.logSlice.split("\n").filter((l) => /(error|fail|✕|exception|assert)/i.test(l)).slice(-12);

  let verdict: FlakyVerdict = "unclear";
  let confidence = 0.4;
  if (realScore > flakyScore) { verdict = "likely_real"; confidence = Math.min(0.9, 0.5 + 0.2 * realScore); }
  else if (flakyScore > realScore) { verdict = "likely_flaky"; confidence = Math.min(0.9, 0.5 + 0.2 * flakyScore); }

  return { verdict, confidence, failingStep: ctx.failingStep, errorLines, signals: [...new Set(signals)] };
}
```

- [ ] **Step 4: Run, verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/analysis/heuristic.ts src/analysis/heuristic.test.ts && git commit -m "feat: heuristic flaky-vs-real classifier"
```

---

### Task 10: Optional LLM analysis (`analysis/llm.ts`)

**Files:**
- Create: `src/analysis/llm.ts`
- Test: `src/analysis/llm.test.ts`

**Interfaces:**
- Consumes: `LlmConfig` (defined here), `FailureContext`, `HeuristicResult`.
- Produces:
  - `interface LlmConfig { baseURL: string; apiKey?: string; model: string }`
  - `buildPrompt(ctx: FailureContext, h: HeuristicResult): string`
  - `analyzeWithLlm(cfg, ctx, h, deps?): Promise<string>` where `deps.createClient` returns an object with `chat.completions.create`. Throws `Error("LLM unconfigured")` when `apiKey` is missing, and maps a 403 to `Error("models scope missing")`.

- [ ] **Step 1: Write failing tests** — `src/analysis/llm.test.ts`

```ts
import { expect, test, vi } from "vitest";
import { analyzeWithLlm, buildPrompt } from "./llm.js";
import type { FailureContext, HeuristicResult } from "../types.js";

const ctx: FailureContext = { jobName: "test", failingStep: "Run tests", logSlice: "AssertionError: nope", annotations: [], runAttempt: 1 };
const h: HeuristicResult = { verdict: "likely_real", confidence: 0.7, failingStep: "Run tests", errorLines: ["AssertionError: nope"], signals: ["assertion"] };

test("buildPrompt includes verdict, step and log", () => {
  const p = buildPrompt(ctx, h);
  expect(p).toContain("Run tests");
  expect(p).toContain("AssertionError: nope");
  expect(p).toContain("likely_real");
});

test("analyzeWithLlm throws when unconfigured (no apiKey)", async () => {
  await expect(analyzeWithLlm({ baseURL: "x", model: "m" }, ctx, h)).rejects.toThrow(/LLM unconfigured/);
});

test("analyzeWithLlm returns assistant text", async () => {
  const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: "It is a real assertion failure." } }] });
  const createClient = () => ({ chat: { completions: { create } } }) as any;
  const out = await analyzeWithLlm({ baseURL: "x", apiKey: "k", model: "gpt-4o-mini" }, ctx, h, { createClient });
  expect(out).toContain("real assertion failure");
  expect(create).toHaveBeenCalled();
});

test("analyzeWithLlm maps 403 to models scope missing", async () => {
  const create = vi.fn().mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
  const createClient = () => ({ chat: { completions: { create } } }) as any;
  await expect(analyzeWithLlm({ baseURL: "x", apiKey: "k", model: "m" }, ctx, h, { createClient })).rejects.toThrow(/models scope missing/);
});
```

- [ ] **Step 2: Run, verify fail** — FAIL.

- [ ] **Step 3: Implement** — `src/analysis/llm.ts`

```ts
import OpenAI from "openai";
import type { FailureContext, HeuristicResult } from "../types.js";

export interface LlmConfig { baseURL: string; apiKey?: string; model: string; }

export function buildPrompt(ctx: FailureContext, h: HeuristicResult): string {
  return [
    "You are a CI triage assistant. Decide whether this failure is a real code/test failure or a flaky/infra failure.",
    `Heuristic verdict: ${h.verdict} (confidence ${h.confidence}); signals: ${h.signals.join(", ") || "none"}.`,
    `Failing step: ${ctx.failingStep ?? "unknown"} in job "${ctx.jobName}".`,
    "Answer in <=4 sentences: what broke, flaky vs real + why, and the single best next action.",
    "--- LOG (trimmed) ---",
    ctx.logSlice,
  ].join("\n");
}

export async function analyzeWithLlm(
  cfg: LlmConfig, ctx: FailureContext, h: HeuristicResult,
  deps: { createClient?: (cfg: LlmConfig) => OpenAI } = {},
): Promise<string> {
  if (!cfg.apiKey) throw new Error("LLM unconfigured: set an endpoint/apiKey to enable analysis.");
  const createClient = deps.createClient ?? ((c) => new OpenAI({ baseURL: c.baseURL, apiKey: c.apiKey }));
  const client = createClient(cfg);
  try {
    const res = await client.chat.completions.create({
      model: cfg.model,
      messages: [{ role: "user", content: buildPrompt(ctx, h) }],
      temperature: 0.2,
    });
    return res.choices[0]?.message?.content?.trim() ?? "(no response)";
  } catch (err: any) {
    if (err?.status === 403) throw new Error("models scope missing: run `gh auth refresh -s models` or use a PAT with models:read.");
    if (err?.status === 429) throw new Error("LLM rate-limited; try again shortly.");
    throw err;
  }
}
```

- [ ] **Step 4: Run, verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/analysis/llm.ts src/analysis/llm.test.ts && git commit -m "feat: optional OpenAI-compatible LLM analysis"
```

---

### Task 11: Config loading (`config.ts`)

**Files:**
- Create: `src/config.ts`
- Test: `src/config.test.ts`

**Interfaces:**
- Produces:
  - `interface Config { theme: string; repo?: string; pollListMs: number; pollChecksMs: number; llm: LlmConfig }`
  - `loadConfig(deps?: { fileText?: string | null; env?: NodeJS.ProcessEnv; flags?: Partial<{ repo: string; theme: string }> }): Config` — precedence flags → env → file → defaults; invalid file JSON ignored with defaults.

- [ ] **Step 1: Write failing tests** — `src/config.test.ts`

```ts
import { expect, test } from "vitest";
import { loadConfig } from "./config.js";

test("defaults when nothing provided", () => {
  const c = loadConfig({ fileText: null, env: {} });
  expect(c.theme).toBe("mocha");
  expect(c.pollChecksMs).toBe(10000);
  expect(c.pollListMs).toBe(30000);
  expect(c.llm.baseURL).toBe("https://models.github.ai/inference");
});

test("file < env < flags precedence", () => {
  const c = loadConfig({
    fileText: JSON.stringify({ theme: "mocha", repo: "f/file", llm: { model: "from-file" } }),
    env: { GREENLIGHT_REPO: "e/env", LLM_MODEL: "from-env" },
    flags: { repo: "x/flag" },
  });
  expect(c.repo).toBe("x/flag");      // flag wins
  expect(c.llm.model).toBe("from-env"); // env wins over file
});

test("invalid JSON file falls back to defaults", () => {
  const c = loadConfig({ fileText: "{ not json", env: {} });
  expect(c.theme).toBe("mocha");
});
```

- [ ] **Step 2: Run, verify fail** — FAIL.

- [ ] **Step 3: Implement** — `src/config.ts`

```ts
import { z } from "zod";
import type { LlmConfig } from "./analysis/llm.js";

export interface Config { theme: string; repo?: string; pollListMs: number; pollChecksMs: number; llm: LlmConfig; }

const FileSchema = z.object({
  theme: z.string().optional(),
  repo: z.string().optional(),
  pollListMs: z.number().optional(),
  pollChecksMs: z.number().optional(),
  llm: z.object({ baseURL: z.string().optional(), apiKey: z.string().optional(), model: z.string().optional() }).optional(),
}).partial();

const DEFAULT_BASE_URL = "https://models.github.ai/inference";

export function loadConfig(
  deps: { fileText?: string | null; env?: NodeJS.ProcessEnv; flags?: Partial<{ repo: string; theme: string }> } = {},
): Config {
  const env = deps.env ?? process.env;
  let file: z.infer<typeof FileSchema> = {};
  if (deps.fileText) {
    try { file = FileSchema.parse(JSON.parse(deps.fileText)); } catch { file = {}; }
  }
  const pick = <T>(...vals: (T | undefined | "")[]) => vals.find((v) => v !== undefined && v !== "") as T | undefined;

  return {
    theme: pick(deps.flags?.theme, env.GREENLIGHT_THEME, file.theme, "mocha")!,
    repo: pick(deps.flags?.repo, env.GREENLIGHT_REPO, file.repo),
    pollListMs: pick(file.pollListMs, 30000)!,
    pollChecksMs: pick(file.pollChecksMs, 10000)!,
    llm: {
      baseURL: pick(env.LLM_BASE_URL, file.llm?.baseURL, DEFAULT_BASE_URL)!,
      apiKey: pick(env.LLM_API_KEY, file.llm?.apiKey),
      model: pick(env.LLM_MODEL, file.llm?.model, "openai/gpt-4o-mini")!,
    },
  };
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.XDG_CONFIG_HOME ?? `${env.HOME}/.config`;
  return `${home}/greenlight/config.json`;
}
```

- [ ] **Step 4: Run, verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/config.test.ts && git commit -m "feat: config loading with flags>env>file precedence"
```

---

### Task 12: Theme tokens + mocha palette (`theme.ts`)

**Files:**
- Create: `src/theme.ts`
- Test: `src/theme.test.ts`

**Interfaces:**
- Produces:
  - `interface Theme { name: string; base: string; border: string; title: string; checkName: string; selection: string; meta: string; pass: string; fail: string; pending: string; skip: string; flag: string; error: string }`
  - `getTheme(name: string): Theme` — returns `mocha`; unknown names fall back to `mocha`.

- [ ] **Step 1: Write failing tests** — `src/theme.test.ts`

```ts
import { expect, test } from "vitest";
import { getTheme } from "./theme.js";

test("mocha palette has the documented hues", () => {
  const t = getTheme("mocha");
  expect(t.pass).toBe("#a6e3a1");
  expect(t.fail).toBe("#f38ba8");
  expect(t.title).toBe("#cba6f7");
});

test("unknown theme falls back to mocha", () => {
  expect(getTheme("does-not-exist").name).toBe("mocha");
});
```

- [ ] **Step 2: Run, verify fail** — FAIL.

- [ ] **Step 3: Implement** — `src/theme.ts`

```ts
export interface Theme {
  name: string; base: string; border: string; title: string; checkName: string;
  selection: string; meta: string; pass: string; fail: string; pending: string;
  skip: string; flag: string; error: string;
}

const mocha: Theme = {
  name: "mocha", base: "#1e1e2e", border: "#313244", title: "#cba6f7", checkName: "#94e2d5",
  selection: "#89b4fa", meta: "#6c7086", pass: "#a6e3a1", fail: "#f38ba8", pending: "#fab387",
  skip: "#6c7086", flag: "#f9e2af", error: "#f38ba8",
};

const THEMES: Record<string, Theme> = { mocha };

export function getTheme(name: string): Theme {
  return THEMES[name] ?? mocha;
}
```

- [ ] **Step 4: Run, verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/theme.ts src/theme.test.ts && git commit -m "feat: theme-token layer with mocha palette"
```

---

### Task 13: Pure UI formatting helpers (`format.ts`)

**Files:**
- Create: `src/format.ts`
- Test: `src/format.test.ts`

**Interfaces:**
- Produces:
  - `glyph(check: Check): "✓" | "✗" | "•" | "⊘"`
  - `glyphColor(check: Check, theme: Theme): string`
  - `formatDuration(startedAt: string | null, completedAt: string | null): string` (e.g. `1m12s`, `running`, `—`)
  - `truncate(s: string, width: number): string`
  - `windowRows<T>(items: T[], cursor: number, height: number): { rows: T[]; offset: number }`
  - `checkCounts(checks: Check[]): { pass: number; fail: number; pending: number }`

- [ ] **Step 1: Write failing tests** — `src/format.test.ts`

```ts
import { expect, test } from "vitest";
import { checkCounts, formatDuration, glyph, truncate, windowRows } from "./format.js";
import type { Check } from "./types.js";

const mk = (o: Partial<Check>): Check => ({ name: "c", status: "completed", conclusion: "success", detailsUrl: null, startedAt: null, completedAt: null, checkRunId: null, checkSuiteId: null, workflowRunId: null, isStatusContext: false, ...o });

test("glyph reflects state", () => {
  expect(glyph(mk({ conclusion: "success" }))).toBe("✓");
  expect(glyph(mk({ conclusion: "failure" }))).toBe("✗");
  expect(glyph(mk({ status: "in_progress", conclusion: null }))).toBe("•");
  expect(glyph(mk({ conclusion: "skipped" }))).toBe("⊘");
});

test("formatDuration", () => {
  expect(formatDuration("2026-06-29T10:00:00Z", "2026-06-29T10:01:12Z")).toBe("1m12s");
  expect(formatDuration("2026-06-29T10:00:00Z", null)).toBe("running");
  expect(formatDuration(null, null)).toBe("—");
});

test("truncate adds ellipsis", () => {
  expect(truncate("hello world", 5)).toBe("hell…");
  expect(truncate("hi", 5)).toBe("hi");
});

test("windowRows keeps cursor visible", () => {
  const items = Array.from({ length: 20 }, (_, i) => i);
  const { rows, offset } = windowRows(items, 15, 5);
  expect(rows).toHaveLength(5);
  expect(rows.includes(15)).toBe(true);
  expect(offset).toBeLessThanOrEqual(15);
});

test("checkCounts tallies", () => {
  const c = checkCounts([mk({ conclusion: "success" }), mk({ conclusion: "failure" }), mk({ status: "in_progress", conclusion: null })]);
  expect(c).toEqual({ pass: 1, fail: 1, pending: 1 });
});
```

- [ ] **Step 2: Run, verify fail** — FAIL.

- [ ] **Step 3: Implement** — `src/format.ts`

```ts
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
```

- [ ] **Step 4: Run, verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/format.ts src/format.test.ts && git commit -m "feat: pure UI formatting helpers"
```

---

### Task 14: State store + poll engine (`store.ts`)

**Files:**
- Create: `src/store.ts`
- Test: `src/store.test.ts`

**Interfaces:**
- Consumes: data functions from earlier tasks (injected), an injectable `Timer`.
- Produces:
  - `interface Timer { setInterval(fn: () => void, ms: number): unknown; clearInterval(h: unknown): void }`
  - `interface StoreState { prs: PullRequest[]; checks: Record<number, Check[]>; selectedPr: number | null; error: string | null; loadingPrs: boolean }`
  - `createStore(deps): Store` where `Store` has `getState()`, `subscribe(fn)`, `selectPr(n)`, `refreshNow()`, `start()`, `stop()`. `deps = { loadPrs: () => Promise<PullRequest[]>; loadChecks: (pr) => Promise<Check[]>; timer: Timer; listMs: number; checksMs: number }`.
- Behavior: single-flight per resource; pause checks polling when no pending check; reconcile by stable id (stale checks response for a non-selected PR is ignored).

- [ ] **Step 1: Write failing tests** — `src/store.test.ts`

```ts
import { expect, test, vi } from "vitest";
import { createStore } from "./store.js";
import type { Check, PullRequest } from "./types.js";

const pr = (number: number): PullRequest => ({ number, title: `pr${number}`, url: "", isCrossRepository: false, headRefName: "h", baseRefName: "main", headSha: "s" });
const check = (o: Partial<Check>): Check => ({ name: "c", status: "completed", conclusion: "success", detailsUrl: null, startedAt: null, completedAt: null, checkRunId: null, checkSuiteId: null, workflowRunId: null, isStatusContext: false, ...o });
const fakeTimer = () => { const handles: (() => void)[] = []; return { timer: { setInterval: (fn: () => void) => { handles.push(fn); return handles.length - 1; }, clearInterval: () => {} }, tick: async () => { for (const h of [...handles]) h(); await Promise.resolve(); } }; };

test("loads PRs and checks for selected PR", async () => {
  const { timer } = fakeTimer();
  const loadPrs = vi.fn().mockResolvedValue([pr(1), pr(2)]);
  const loadChecks = vi.fn().mockResolvedValue([check({})]);
  const store = createStore({ loadPrs, loadChecks, timer, listMs: 30000, checksMs: 10000 });
  await store.refreshNow();
  expect(store.getState().prs).toHaveLength(2);
  store.selectPr(1);
  await store.refreshNow();
  expect(store.getState().checks[1]).toHaveLength(1);
});

test("single-flight: a slow load is not started twice", async () => {
  const { timer, tick } = fakeTimer();
  let resolve!: (v: PullRequest[]) => void;
  const loadPrs = vi.fn().mockImplementation(() => new Promise<PullRequest[]>((r) => { resolve = r; }));
  const store = createStore({ loadPrs, loadChecks: vi.fn().mockResolvedValue([]), timer, listMs: 1, checksMs: 1 });
  store.start();
  await tick(); await tick(); // two ticks while first call is in flight
  expect(loadPrs).toHaveBeenCalledTimes(1);
  resolve([]);
});

test("stale checks response for a non-selected PR is discarded", async () => {
  const { timer } = fakeTimer();
  const store = createStore({ loadPrs: vi.fn().mockResolvedValue([pr(1), pr(2)]), loadChecks: vi.fn().mockResolvedValue([check({ name: "stale" })]), timer, listMs: 1, checksMs: 1 });
  store.selectPr(1);
  const p = store.refreshNow();          // begins loading checks for PR 1
  store.selectPr(2);                      // user moves before it resolves
  await p;
  expect(store.getState().checks[1]).toBeUndefined();
});
```

- [ ] **Step 2: Run, verify fail** — FAIL.

- [ ] **Step 3: Implement** — `src/store.ts`

```ts
import type { Check, PullRequest } from "./types.js";
import { glyph } from "./format.js";

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
    catch (e: any) { set({ error: e?.message ?? String(e) }); }
    finally { prsInFlight = false; set({ loadingPrs: false }); }
  }

  async function loadChecks() {
    const target = state.selectedPr;
    if (target == null || checksInFlight) return;
    checksInFlight = true;
    try {
      const result = await deps.loadChecks(target);
      if (state.selectedPr === target) set({ checks: { ...state.checks, [target]: result }, error: null });
    } catch (e: any) { set({ error: e?.message ?? String(e) }); }
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
    start() {
      listHandle = deps.timer.setInterval(() => void loadPrs(), deps.listMs);
      checksHandle = deps.timer.setInterval(() => { if (hasPending()) void loadChecks(); }, deps.checksMs);
      void loadPrs();
    },
    stop() { deps.timer.clearInterval(listHandle); deps.timer.clearInterval(checksHandle); },
  };
}
```

- [ ] **Step 4: Run, verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store.ts src/store.test.ts && git commit -m "feat: state store + poll engine (single-flight, reconcile by id)"
```

---

### Task 15: PR list pane (`ui/PrList.tsx`)

**Files:**
- Create: `src/ui/PrList.tsx`
- Test: `src/ui/PrList.test.tsx`

**Interfaces:**
- Consumes: `format.ts` helpers, `theme.ts`.
- Produces: `<PrList prs theme checks selected focused height />` where `prs: PullRequest[]`, `checks: Record<number, Check[]>`, `selected: number | null`, `focused: boolean`, `height: number`.

- [ ] **Step 1: Write failing test** — `src/ui/PrList.test.tsx`

```tsx
import { render } from "ink-testing-library";
import { expect, test } from "vitest";
import React from "react";
import { PrList } from "./PrList.js";
import { getTheme } from "../theme.js";
import type { PullRequest, Check } from "../types.js";

const prs: PullRequest[] = [{ number: 142, title: "Fix auth flow", url: "", isCrossRepository: false, headRefName: "a", baseRefName: "main", headSha: "s" }];
const checks: Record<number, Check[]> = { 142: [{ name: "test", status: "completed", conclusion: "failure", detailsUrl: null, startedAt: null, completedAt: null, checkRunId: null, checkSuiteId: null, workflowRunId: null, isStatusContext: false }] };

test("renders PR number, title and a fail glyph", () => {
  const { lastFrame } = render(<PrList prs={prs} checks={checks} selected={142} focused theme={getTheme("mocha")} height={10} />);
  expect(lastFrame()).toContain("#142");
  expect(lastFrame()).toContain("Fix auth");
  expect(lastFrame()).toContain("✗");
});

test("empty state", () => {
  const { lastFrame } = render(<PrList prs={[]} checks={{}} selected={null} focused theme={getTheme("mocha")} height={10} />);
  expect(lastFrame()).toMatch(/No open PRs/i);
});
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run src/ui/PrList.test.tsx` → FAIL.

- [ ] **Step 3: Implement** — `src/ui/PrList.tsx`

```tsx
import React from "react";
import { Box, Text } from "ink";
import type { PullRequest, Check } from "../types.js";
import type { Theme } from "../theme.js";
import { checkCounts, glyph, glyphColor, truncate, windowRows } from "../format.js";

interface Props { prs: PullRequest[]; checks: Record<number, Check[]>; selected: number | null; focused: boolean; theme: Theme; height: number; }

export function PrList({ prs, checks, selected, focused, theme, height }: Props) {
  const borderColor = focused ? theme.selection : theme.border;
  if (prs.length === 0) {
    return (
      <Box flexDirection="column" width={36} borderStyle="round" borderColor={borderColor} paddingX={1}>
        <Text color={theme.title}>PRs</Text>
        <Text color={theme.meta}>No open PRs by you here.</Text>
      </Box>
    );
  }
  const cursor = Math.max(0, prs.findIndex((p) => p.number === selected));
  const { rows } = windowRows(prs, cursor, height);
  return (
    <Box flexDirection="column" width={36} borderStyle="round" borderColor={borderColor} paddingX={1}>
      <Text color={theme.title}>PRs</Text>
      {rows.map((pr) => {
        const isSel = pr.number === selected;
        const cs = checks[pr.number] ?? [];
        const top = cs.find((c) => glyph(c) === "✗") ?? cs.find((c) => glyph(c) === "•") ?? cs[0];
        const { pass, fail, pending } = checkCounts(cs);
        return (
          <Box key={pr.number}>
            <Text color={isSel ? theme.selection : undefined}>{isSel ? "❯ " : "  "}</Text>
            {top ? <Text color={glyphColor(top, theme)}>{glyph(top)} </Text> : <Text>  </Text>}
            <Text color={isSel ? theme.selection : undefined}>#{pr.number} </Text>
            <Text>{truncate(pr.title, 16)} </Text>
            <Text color={theme.meta}>{`✓${pass} ✗${fail} •${pending}`}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
```

- [ ] **Step 4: Run, verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/PrList.tsx src/ui/PrList.test.tsx && git commit -m "feat: PR list pane"
```

---

### Task 16: Detail pane (`ui/Detail.tsx`)

**Files:**
- Create: `src/ui/Detail.tsx`
- Test: `src/ui/Detail.test.tsx`

**Interfaces:**
- Produces: `<Detail pr checks theme checkCursor focused height />` — header (title, `branch → base`) + checks table (glyph, name, duration, flag placeholder).

- [ ] **Step 1: Write failing test** — `src/ui/Detail.test.tsx`

```tsx
import { render } from "ink-testing-library";
import { expect, test } from "vitest";
import React from "react";
import { Detail } from "./Detail.js";
import { getTheme } from "../theme.js";
import type { PullRequest, Check } from "../types.js";

const pr: PullRequest = { number: 142, title: "Fix auth flow", url: "", isCrossRepository: false, headRefName: "feat/auth", baseRefName: "main", headSha: "s" };
const checks: Check[] = [
  { name: "build", status: "completed", conclusion: "success", detailsUrl: null, startedAt: "2026-06-29T10:00:00Z", completedAt: "2026-06-29T10:01:12Z", checkRunId: 1, checkSuiteId: 1, workflowRunId: 1, isStatusContext: false },
  { name: "test (unit)", status: "completed", conclusion: "failure", detailsUrl: null, startedAt: "2026-06-29T10:00:00Z", completedAt: "2026-06-29T10:00:44Z", checkRunId: 2, checkSuiteId: 1, workflowRunId: 1, isStatusContext: false },
];

test("renders header and checks with durations", () => {
  const { lastFrame } = render(<Detail pr={pr} checks={checks} checkCursor={1} focused theme={getTheme("mocha")} height={12} />);
  expect(lastFrame()).toContain("Fix auth flow");
  expect(lastFrame()).toContain("feat/auth");
  expect(lastFrame()).toContain("main");
  expect(lastFrame()).toContain("build");
  expect(lastFrame()).toContain("1m12s");
});

test("shows placeholder when no PR selected", () => {
  const { lastFrame } = render(<Detail pr={null} checks={[]} checkCursor={0} focused theme={getTheme("mocha")} height={12} />);
  expect(lastFrame()).toMatch(/Select a PR/i);
});
```

- [ ] **Step 2: Run, verify fail** — FAIL.

- [ ] **Step 3: Implement** — `src/ui/Detail.tsx`

```tsx
import React from "react";
import { Box, Text } from "ink";
import type { PullRequest, Check } from "../types.js";
import type { Theme } from "../theme.js";
import { formatDuration, glyph, glyphColor, truncate, windowRows } from "../format.js";

interface Props { pr: PullRequest | null; checks: Check[]; checkCursor: number; focused: boolean; theme: Theme; height: number; }

export function Detail({ pr, checks, checkCursor, focused, theme, height }: Props) {
  const borderColor = focused ? theme.selection : theme.border;
  if (!pr) {
    return (
      <Box flexGrow={1} borderStyle="round" borderColor={borderColor} paddingX={1}>
        <Text color={theme.meta}>Select a PR to see its checks.</Text>
      </Box>
    );
  }
  const { rows } = windowRows(checks, checkCursor, Math.max(1, height - 3));
  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={borderColor} paddingX={1}>
      <Text color={theme.title}>#{pr.number} {truncate(pr.title, 40)}</Text>
      <Text color={theme.meta}>{pr.headRefName} → {pr.baseRefName}{pr.isCrossRepository ? " (fork)" : ""}</Text>
      <Text color={theme.border}>{"─".repeat(30)}</Text>
      {rows.map((c, i) => {
        const isSel = checks.indexOf(c) === checkCursor;
        return (
          <Box key={c.name + i}>
            <Text color={glyphColor(c, theme)}>{glyph(c)} </Text>
            <Text color={isSel ? theme.selection : theme.checkName}>{truncate(c.name, 22).padEnd(22)} </Text>
            <Text color={theme.meta}>{formatDuration(c.startedAt, c.completedAt)}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
```

- [ ] **Step 4: Run, verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/Detail.tsx src/ui/Detail.test.tsx && git commit -m "feat: detail pane with checks table"
```

---

### Task 17: Analysis region (`ui/Analysis.tsx`)

**Files:**
- Create: `src/ui/Analysis.tsx`
- Test: `src/ui/Analysis.test.tsx`

**Interfaces:**
- Produces: `<Analysis heuristic llmText llmLoading llmError theme />` where `heuristic: HeuristicResult | null`, `llmText: string | null`, `llmLoading: boolean`, `llmError: string | null`.

- [ ] **Step 1: Write failing test** — `src/ui/Analysis.test.tsx`

```tsx
import { render } from "ink-testing-library";
import { expect, test } from "vitest";
import React from "react";
import { Analysis } from "./Analysis.js";
import { getTheme } from "../theme.js";
import type { HeuristicResult } from "../types.js";

const h: HeuristicResult = { verdict: "likely_real", confidence: 0.7, failingStep: "Run tests", errorLines: ["AssertionError: nope"], signals: ["assertion"] };

test("renders heuristic verdict and error lines", () => {
  const { lastFrame } = render(<Analysis heuristic={h} llmText={null} llmLoading={false} llmError={null} theme={getTheme("mocha")} />);
  expect(lastFrame()).toMatch(/likely real/i);
  expect(lastFrame()).toContain("Run tests");
  expect(lastFrame()).toContain("AssertionError");
});

test("shows LLM hint when there is an llmError", () => {
  const { lastFrame } = render(<Analysis heuristic={h} llmText={null} llmLoading={false} llmError={"LLM unconfigured"} theme={getTheme("mocha")} />);
  expect(lastFrame()).toMatch(/LLM unconfigured/i);
});
```

- [ ] **Step 2: Run, verify fail** — FAIL.

- [ ] **Step 3: Implement** — `src/ui/Analysis.tsx`

```tsx
import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import type { HeuristicResult } from "../types.js";
import type { Theme } from "../theme.js";

interface Props { heuristic: HeuristicResult | null; llmText: string | null; llmLoading: boolean; llmError: string | null; theme: Theme; }

const label = (v: HeuristicResult["verdict"]) => v === "likely_real" ? "likely real" : v === "likely_flaky" ? "likely flaky" : "unclear";

export function Analysis({ heuristic, llmText, llmLoading, llmError, theme }: Props) {
  if (!heuristic) return <Box><Text color={theme.meta}>Press ↵ on a failed check to analyze.</Text></Box>;
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text>
        <Text color={theme.flag}>⚑ {label(heuristic.verdict)}</Text>
        <Text color={theme.meta}> ({Math.round(heuristic.confidence * 100)}% · {heuristic.signals.join(", ") || "no signals"})</Text>
      </Text>
      {heuristic.failingStep ? <Text color={theme.meta}>step: {heuristic.failingStep}</Text> : null}
      {heuristic.errorLines.map((l, i) => <Text key={i} color={theme.fail}>{l}</Text>)}
      {llmLoading ? <Text color={theme.checkName}><Spinner type="dots" /> analyzing…</Text> : null}
      {llmText ? <Text color={theme.checkName}>{llmText}</Text> : null}
      {llmError ? <Text color={theme.error}>{llmError}</Text> : null}
    </Box>
  );
}
```

- [ ] **Step 4: Run, verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/Analysis.tsx src/ui/Analysis.test.tsx && git commit -m "feat: analysis region (heuristic + LLM)"
```

---

### Task 18: Overlays + status bar (`ui/Overlay.tsx`, `ui/StatusBar.tsx`)

**Files:**
- Create: `src/ui/Overlay.tsx`, `src/ui/StatusBar.tsx`
- Test: `src/ui/Overlay.test.tsx`

**Interfaces:**
- Produces:
  - `<ConfirmOverlay message theme />` (view that replaces content; parent owns y/n input)
  - `<HelpOverlay theme />`
  - `<StatusBar hints message theme />`

- [ ] **Step 1: Write failing test** — `src/ui/Overlay.test.tsx`

```tsx
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
```

- [ ] **Step 2: Run, verify fail** — FAIL.

- [ ] **Step 3: Implement** — `src/ui/Overlay.tsx`

```tsx
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
```

`src/ui/StatusBar.tsx`:
```tsx
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
```

- [ ] **Step 4: Run, verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/Overlay.tsx src/ui/StatusBar.tsx src/ui/Overlay.test.tsx && git commit -m "feat: overlays and status bar"
```

---

### Task 19: App shell — wiring, focus, keybindings (`ui/App.tsx`)

**Files:**
- Create: `src/ui/App.tsx`
- Test: `src/ui/App.test.tsx`

**Interfaces:**
- Consumes: `Store`, all UI components, `Theme`, `RepoTarget`, and action callbacks `onRerun(prNumber): Promise<{rerun:number[]}>`, `onAnalyze(check): Promise<{ heuristic: HeuristicResult; llm: () => Promise<string> }>`, `openUrl(url)`.
- Produces: `<App store theme target onRerun onAnalyze openUrl />`.
- Behavior: subscribes to store; `j/k`/arrows move within the focused pane; `Tab` toggles focus; `Enter` analyzes the selected check; `R` opens confirm overlay then calls `onRerun` and optimistically marks affected checks pending; `?` toggles help; `q` exits.

- [ ] **Step 1: Write failing test** — `src/ui/App.test.tsx`

```tsx
import { render } from "ink-testing-library";
import { expect, test, vi } from "vitest";
import React from "react";
import { App } from "./App.js";
import { createStore } from "../store.js";
import { getTheme } from "../theme.js";
import type { Check, PullRequest, RepoTarget } from "../types.js";

const target: RepoTarget = { owner: "acme", repo: "widget", viewerLogin: "me", viewerCanWrite: true };
const prs: PullRequest[] = [{ number: 142, title: "Fix auth flow", url: "u", isCrossRepository: false, headRefName: "a", baseRefName: "main", headSha: "s" }];
const checks: Check[] = [{ name: "test", status: "completed", conclusion: "failure", detailsUrl: null, startedAt: null, completedAt: null, checkRunId: 1, checkSuiteId: 1, workflowRunId: 1, isStatusContext: false }];
const noTimer = { setInterval: () => 0, clearInterval: () => {} };

function mkStore() {
  const store = createStore({ loadPrs: vi.fn().mockResolvedValue(prs), loadChecks: vi.fn().mockResolvedValue(checks), timer: noTimer, listMs: 1, checksMs: 1 });
  return store;
}

test("renders both panes after data loads", async () => {
  const store = mkStore();
  await store.refreshNow();
  store.selectPr(142); await store.refreshNow();
  const { lastFrame } = render(<App store={store} theme={getTheme("mocha")} target={target} onRerun={vi.fn()} onAnalyze={vi.fn()} openUrl={vi.fn()} />);
  expect(lastFrame()).toContain("#142");
  expect(lastFrame()).toContain("test");
});

test("? toggles help overlay", async () => {
  const store = mkStore();
  await store.refreshNow(); store.selectPr(142); await store.refreshNow();
  const { lastFrame, stdin } = render(<App store={store} theme={getTheme("mocha")} target={target} onRerun={vi.fn()} onAnalyze={vi.fn()} openUrl={vi.fn()} />);
  stdin.write("?");
  expect(lastFrame()).toMatch(/Keybindings/i);
});
```

- [ ] **Step 2: Run, verify fail** — FAIL.

- [ ] **Step 3: Implement** — `src/ui/App.tsx`

```tsx
import React, { useEffect, useState, useSyncExternalStore } from "react";
import { Box, useApp, useInput } from "ink";
import type { Store } from "../store.js";
import type { Check, HeuristicResult, PullRequest, RepoTarget } from "../types.js";
import type { Theme } from "../theme.js";
import { PrList } from "./PrList.js";
import { Detail } from "./Detail.js";
import { Analysis } from "./Analysis.js";
import { ConfirmOverlay, HelpOverlay } from "./Overlay.js";
import { StatusBar } from "./StatusBar.js";

const HINTS = "↑↓ move · ⇥ pane · ↵ analyze · R rerun · r refresh · o open · ? help · q quit";

interface Props {
  store: Store; theme: Theme; target: RepoTarget;
  onRerun: (prNumber: number, checks: Check[]) => Promise<{ rerun: number[] }>;
  onAnalyze: (check: Check) => Promise<{ heuristic: HeuristicResult; llm: () => Promise<string> }>;
  openUrl: (url: string) => void;
}

export function App({ store, theme, target, onRerun, onAnalyze, openUrl }: Props) {
  const { exit } = useApp();
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const [focus, setFocus] = useState<"list" | "detail">("list");
  const [checkCursor, setCheckCursor] = useState(0);
  const [overlay, setOverlay] = useState<null | "help" | "confirm">(null);
  const [message, setMessage] = useState<string | null>(null);
  const [heuristic, setHeuristic] = useState<HeuristicResult | null>(null);
  const [llmText, setLlmText] = useState<string | null>(null);
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [runLlm, setRunLlm] = useState<null | (() => Promise<string>)>(null);

  const prs: PullRequest[] = state.prs;
  const selectedPr = prs.find((p) => p.number === state.selectedPr) ?? null;
  const checks: Check[] = state.selectedPr != null ? state.checks[state.selectedPr] ?? [] : [];

  useEffect(() => { if (state.selectedPr == null && prs[0]) store.selectPr(prs[0].number); }, [prs.length]);
  useEffect(() => { setMessage(state.error); }, [state.error]);

  useInput((input, key) => {
    if (overlay === "confirm") {
      if (input === "y") { setOverlay(null); void doRerun(); }
      else if (input === "n" || key.escape) setOverlay(null);
      return;
    }
    if (overlay === "help") { if (input === "?" || key.escape) setOverlay(null); return; }

    if (input === "q") { exit(); return; }
    if (input === "?") { setOverlay("help"); return; }
    if (key.tab || input === "h" || input === "l") { setFocus((f) => (f === "list" ? "detail" : "list")); return; }
    if (input === "r") { void store.refreshNow(); return; }
    if (input === "o") { const url = focus === "detail" ? checks[checkCursor]?.detailsUrl ?? selectedPr?.url : selectedPr?.url; if (url) openUrl(url); return; }
    if (input === "R") {
      if (!target.viewerCanWrite) { setMessage(`no write access to ${target.owner}/${target.repo}`); return; }
      const n = checks.filter((c) => c.conclusion === "failure" || c.conclusion === "timed_out").length;
      if (n === 0) { setMessage("no failed checks to rerun"); return; }
      setOverlay("confirm"); return;
    }

    const up = key.upArrow || input === "k";
    const down = key.downArrow || input === "j";
    if (focus === "list" && (up || down)) {
      const idx = prs.findIndex((p) => p.number === state.selectedPr);
      const next = Math.min(prs.length - 1, Math.max(0, idx + (down ? 1 : -1)));
      if (prs[next]) { store.selectPr(prs[next].number); setCheckCursor(0); setHeuristic(null); setLlmText(null); setLlmError(null); }
    } else if (focus === "detail" && (up || down)) {
      setCheckCursor((c) => Math.min(checks.length - 1, Math.max(0, c + (down ? 1 : -1))));
    } else if (key.return && focus === "detail") {
      void analyze();
    }
  });

  async function analyze() {
    const check = checks[checkCursor];
    if (!check) return;
    setLlmText(null); setLlmError(null);
    try {
      const { heuristic: h, llm } = await onAnalyze(check);
      setHeuristic(h); setRunLlm(() => llm);
    } catch (e: any) { setMessage(e?.message ?? String(e)); }
  }

  async function doRerun() {
    try {
      setMessage("rerunning failed jobs…");
      await onRerun(state.selectedPr!, checks);
      await store.refreshNow();
      setMessage(null);
    } catch (e: any) { setMessage(e?.message ?? String(e)); }
  }

  // 'a' triggers the deferred LLM call
  useInput((input) => {
    if (input === "a" && !overlay) {
      if (!runLlm) { setLlmError("press ↵ on a failed check first"); return; }
      setLlmLoading(true); setLlmError(null);
      runLlm().then((t) => setLlmText(t)).catch((e) => setLlmError(e?.message ?? String(e))).finally(() => setLlmLoading(false));
    }
  });

  if (overlay === "help") return <HelpOverlay theme={theme} />;
  if (overlay === "confirm") {
    const n = checks.filter((c) => c.conclusion === "failure" || c.conclusion === "timed_out").length;
    return <ConfirmOverlay message={`Rerun ${n} failed job(s)?`} theme={theme} />;
  }

  return (
    <Box flexDirection="column">
      <Box>
        <PrList prs={prs} checks={state.checks} selected={state.selectedPr} focused={focus === "list"} theme={theme} height={12} />
        <Box flexDirection="column" flexGrow={1}>
          <Detail pr={selectedPr} checks={checks} checkCursor={checkCursor} focused={focus === "detail"} theme={theme} height={12} />
          <Analysis heuristic={heuristic} llmText={llmText} llmLoading={llmLoading} llmError={llmError} theme={theme} />
        </Box>
      </Box>
      <StatusBar hints={HINTS} message={message} theme={theme} />
    </Box>
  );
}
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run src/ui/App.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/App.tsx src/ui/App.test.tsx && git commit -m "feat: app shell with focus, keybindings, overlays"
```

---

### Task 20: Entry / CLI wiring (`cli.tsx`)

**Files:**
- Modify: `src/cli.tsx` (replace the scaffold stub)
- Test: `src/cli.test.ts`

**Interfaces:**
- Consumes: everything. Produces the runnable binary.
- Produces: `parseArgs(argv: string[]): { repo?: string; help: boolean; version: boolean }` (testable pure fn); `main()` (side-effecting, not unit-tested).

- [ ] **Step 1: Write failing test** — `src/cli.test.ts`

```ts
import { expect, test } from "vitest";
import { parseArgs } from "./cli.js";

test("parses --repo and flags", () => {
  expect(parseArgs(["--repo", "a/b"]).repo).toBe("a/b");
  expect(parseArgs(["--help"]).help).toBe(true);
  expect(parseArgs(["--version"]).version).toBe(true);
  expect(parseArgs([]).repo).toBeUndefined();
});
```

- [ ] **Step 2: Run, verify fail** — FAIL.

- [ ] **Step 3: Implement** — `src/cli.tsx` (full replacement)

```tsx
import React from "react";
import { render } from "ink";
import { readFileSync } from "node:fs";
import { execa } from "execa";
import { resolveToken } from "./auth.js";
import { createOctokit } from "./octokit.js";
import { resolveTarget } from "./repo.js";
import { loadConfig, configPath } from "./config.js";
import { getTheme } from "./theme.js";
import { listMyOpenPrs } from "./github/prs.js";
import { fetchChecks } from "./github/checks.js";
import { rerunFailed } from "./github/rerun.js";
import { fetchFailureContext } from "./github/logs.js";
import { classify } from "./analysis/heuristic.js";
import { analyzeWithLlm } from "./analysis/llm.js";
import { createStore } from "./store.js";
import { App } from "./ui/App.js";
import type { Check } from "./types.js";

export function parseArgs(argv: string[]): { repo?: string; help: boolean; version: boolean } {
  const out: { repo?: string; help: boolean; version: boolean } = { help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--repo") out.repo = argv[++i];
    else if (argv[i] === "--help" || argv[i] === "-h") out.help = true;
    else if (argv[i] === "--version" || argv[i] === "-v") out.version = true;
  }
  return out;
}

function readConfigFile(): string | null {
  try { return readFileSync(configPath(), "utf8"); } catch { return null; }
}

export async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log("greenlight — your open PRs + CI checks\n  --repo owner/name   override repo\n  keys: ↑↓ move, ⇥ pane, ↵ analyze, R rerun, a LLM, o open, q quit"); return; }
  if (args.version) { console.log("greenlight 0.1.0"); return; }

  const config = loadConfig({ fileText: readConfigFile(), flags: { repo: args.repo } });
  const theme = getTheme(config.theme);

  let token: string, target;
  try {
    token = await resolveToken();
    const octokit = createOctokit(token);
    target = await resolveTarget(octokit, { override: config.repo });

    const store = createStore({
      loadPrs: () => listMyOpenPrs(octokit, target),
      loadChecks: (n) => fetchChecks(octokit, target, n),
      timer: { setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (h) => clearInterval(h as NodeJS.Timeout) },
      listMs: config.pollListMs, checksMs: config.pollChecksMs,
    });

    const onRerun = (prNumber: number, checks: Check[]) => rerunFailed(octokit, target!, checks);
    const onAnalyze = async (check: Check) => {
      const ctx = await fetchFailureContext(octokit, target!, check);
      const heuristic = classify(ctx, check);
      const llm = () => analyzeWithLlm(config.llm, ctx, heuristic);
      return { heuristic, llm };
    };
    const openUrl = (url: string) => { void execa("gh", ["browse", "--repo", `${target!.owner}/${target!.repo}`, url]).catch(() => {}); };

    store.start();
    const { waitUntilExit } = render(<App store={store} theme={theme} target={target} onRerun={onRerun} onAnalyze={onAnalyze} openUrl={openUrl} />);
    await waitUntilExit();
    store.stop();
  } catch (e: any) {
    console.error(`greenlight: ${e?.message ?? e}`);
    process.exitCode = 1;
  }
}

// Only run when executed directly (not when imported by tests)
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run src/cli.test.ts` → PASS.

- [ ] **Step 5: Full suite + build + typecheck**

Run: `npm test && npm run typecheck && npm run build`
Expected: all tests pass, no type errors, `dist/cli.js` emitted with shebang.

- [ ] **Step 6: Manual smoke (in a repo with your PRs)**

Run: `node dist/cli.js --version` → prints `greenlight 0.1.0`; then `node dist/cli.js` inside a repo where you have an open PR → renders the two panes.

- [ ] **Step 7: Commit**

```bash
git add src/cli.tsx src/cli.test.ts && git commit -m "feat: CLI entry wiring the full app"
```

---

## Self-Review

**Spec coverage:**
- §2 token/`gh`→env → Task 2. Octokit/throttling → Task 3. LLM pluggable + `models:read` distinct error → Tasks 10, 11.
- §3 modules: auth(2), config(11), repo(4), octokit(3), prs(5), checks(6), rerun(7), logs(8), store(14), heuristic(9), llm(10), ui(15–19). Source-of-truth GraphQL rollup → Task 6. check_suite_id/workflowRunId join → Tasks 6/7. Fork-aware resolution + write gate → Tasks 4, 19. Rerun preconditions/write gate → Tasks 7, 19.
- §5 hybrid poll, single-flight, pause-on-terminal, reconcile-by-id → Task 14. Rate-limit backoff → Task 3 (throttling).
- §6 dense layout, mocha theme tokens, glyph language, windowing, view-swap overlays, status bar → Tasks 12, 13, 15–19. Persistent "changed" affordance: *not yet implemented* — see gap below.
- §7 heuristic + LLM → Tasks 9, 10, 17, 19.
- §8 error states (no repo/token, expired logs 410, models scope, unconfigured, no write) → Tasks 2, 4, 8, 10, 19.
- §9 testing: heuristic fixtures (9), mappers + fork/multi-attempt fixtures (5,6 — *fork PR fixture is a gap, see below*), store fake-timer (14), UI ink-testing-library (15–19).

**Identified gaps (intentionally deferred, not blockers for a working v1):**
- Persistent "changed-since-you-looked" marker (§6 motion) and the shared spinner ticker are not in these tasks — the v1 renders live status on poll without the change-marker. Add as a fast-follow task once the core loop is verified.
- A dedicated fork-PR rollup fixture and a multi-attempt `check_suite_id` dedup fixture (§9) aren't separate tasks; Task 6/7 cover the mapping logic with representative fixtures. Add targeted fixtures when hardening.
- `tokyo-night` palette deferred per spec (§6) — `getTheme` already falls back, so adding it later is a pure data addition to `THEMES`.

**Placeholder scan:** none — every code/test step has concrete content.

**Type consistency:** `Check`/`PullRequest`/`RepoTarget`/`HeuristicResult`/`FailureContext` defined in Task 1 and used verbatim throughout. `LlmConfig` defined in Task 10 and imported by Task 11. `Store`/`Timer`/`StoreState` defined in Task 14 and consumed by Tasks 19/20. `getTheme`/`Theme` from Task 12 used by all UI tasks. Function names (`resolveToken`, `createOctokit`, `resolveTarget`, `listMyOpenPrs`, `fetchChecks`, `failedRunIds`/`rerunFailed`, `fetchFailureContext`/`trimLog`, `classify`, `buildPrompt`/`analyzeWithLlm`, `loadConfig`/`configPath`, `createStore`) are consistent between definition and call sites.
