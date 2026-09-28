import net from "net";

/**
 * Find a free port, starting at `preferred` and walking upwards.
 *
 * Optional side servers (Prometheus metrics, the collaboration socket) used to
 * bind fixed ports, and an EADDRINUSE there killed the whole API — which is
 * what happened to the packaged desktop app whenever a dev API already held
 * those ports. Returns null when the whole range is busy, so a caller can skip
 * that feature rather than die.
 */
export const findAvailablePort = async (preferred: number, attempts = 10): Promise<number | null> => {
  for (let offset = 0; offset < attempts; offset += 1) {
    const port = preferred + offset;
    const free = await new Promise<boolean>((resolve) => {
      const probe = net.createServer();
      probe.once("error", () => resolve(false));
      probe.once("listening", () => probe.close(() => resolve(true)));
      probe.listen(port);
    });
    if (free) return port;
  }
  return null;
};
