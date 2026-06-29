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
