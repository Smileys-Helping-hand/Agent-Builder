/**
 * GpuLock - a binary semaphore around local-GPU model calls.
 *
 * The HTTP API lets multiple AutonomousOrchestrator builds run concurrently
 * (each buildId gets its own instance — see server/autonomous.ts). Without
 * this, two builds each hitting Ollama at once contend for the same GPU
 * queue with no coordination. This makes "one GPU inference at a time" a
 * property of the process, not something every caller has to remember.
 */
export class GpuLock {
  private locked = false;
  private queue: Array<() => void> = [];

  private acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve(() => this.release());
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.locked = true;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export const gpuLock = new GpuLock();
