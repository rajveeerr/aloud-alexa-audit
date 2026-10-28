/**
 * Graceful shutdown for the api and worker entry points. Runs `close` once however many signals
 * arrive, and force-exits if it hangs (a stuck job or a dead connection) so the platform's
 * restart isn't blocked. Unhandled rejections are logged rather than lost.
 */
export function onShutdown(close: () => Promise<void>, log: (message: string) => void, graceMs = 10_000): void {
  let closing = false;
  const stop = async (signal: string) => {
    if (closing) return;
    closing = true;
    log(`${signal}: shutting down`);
    const force = setTimeout(() => {
      log(`still closing after ${graceMs} ms, exiting anyway`);
      process.exit(1);
    }, graceMs);
    force.unref();
    try {
      await close();
      process.exit(0);
    } catch (err) {
      log(`shutdown failed: ${(err as Error).stack ?? String(err)}`);
      process.exit(1);
    }
  };
  process.on("SIGINT", () => void stop("SIGINT"));
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("unhandledRejection", (reason) => log(`unhandled rejection: ${(reason as Error)?.stack ?? String(reason)}`));
}
