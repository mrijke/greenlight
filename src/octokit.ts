import { Octokit } from "octokit";

export function createOctokit(token: string): Octokit {
  return new Octokit({
    auth: token,
    throttle: {
      onRateLimit: (_retryAfter: number, _options: unknown, _o: unknown, retryCount: number) => retryCount < 1,
      onSecondaryRateLimit: (_retryAfter: number, _options: unknown, _o: unknown, retryCount: number) => retryCount < 1,
    },
  });
}
