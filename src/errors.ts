export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function httpStatus(e: unknown): number | undefined {
  if (typeof e === "object" && e !== null && "status" in e) {
    const s = (e as { status?: unknown }).status;
    return typeof s === "number" ? s : undefined;
  }
  return undefined;
}
