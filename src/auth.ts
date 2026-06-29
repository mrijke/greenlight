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
