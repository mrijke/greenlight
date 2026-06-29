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
