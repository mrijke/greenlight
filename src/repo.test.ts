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
