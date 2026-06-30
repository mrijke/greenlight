import { useLayoutEffect, useState } from "react";
import { useStdout } from "ink";

export interface TerminalSize { rows: number; columns: number; }

export function useTerminalSize(): TerminalSize {
  const { stdout } = useStdout();
  const read = (): TerminalSize => ({ rows: stdout?.rows ?? 24, columns: stdout?.columns ?? 80 });
  const [size, setSize] = useState<TerminalSize>(read);

  // Seed from the real stdout after first render (avoids a one-frame fallback flash),
  // then track resizes. useStdout exposes the raw TTY size; treat it as the ceiling.
  useLayoutEffect(() => {
    setSize(read());
    if (!stdout) return;
    const onResize = () => setSize(read());
    stdout.on("resize", onResize);
    return () => { stdout.off("resize", onResize); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stdout]);

  return size;
}
