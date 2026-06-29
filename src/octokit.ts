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
