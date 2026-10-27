/**
 * GpuLock - a binary semaphore around local-GPU model calls.
 *
 * The HTTP API lets multiple AutonomousOrchestrator builds run concurrently
 * (each buildId gets its own instance — see server/autonomous.ts). Without
 * this, two builds each hitting Ollama at once contend for the same GPU
 * queue with no coordination. This makes "one GPU inference at a time" a
 * property of the process, not something every caller has to remember.
 */
/** "interactive": a person is waiting on this answer; "background": research, builds, practice. */
export type GpuPriority = "interactive" | "background";

export class GpuLock {
  private locked = false;
  private queue: Array<() => void> = [];

  /** How many waiting calls are interactive: they queue ahead of background work, in arrival order. */
  private interactiveWaiting = 0;

  private acquire(priority: GpuPriority): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve(() => this.release());
    }
    return new Promise((resolve) => {
      const start = () => {
        if (priority === "interactive") this.interactiveWaiting--;
        this.locked = true;
        resolve(() => this.release());
      };
      if (priority === "interactive") {
        // Someone is waiting on the answer (a chat, a lesson they opened):
        // ahead of research cycles and build passes, behind earlier askers.
        this.queue.splice(this.interactiveWaiting, 0, start);
        this.interactiveWaiting++;
      } else {
        this.queue.push(start);
      }
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

  /** True while a model call is running or waiting its turn. */
  get busy(): boolean {
    return this.locked || this.queue.length > 0;
  }

  /** Calls ahead of this one, for "you are 3rd in line". */
  get waiting(): number {
    return this.queue.length;
  }

  async run<T>(fn: () => Promise<T>, priority: GpuPriority = "background"): Promise<T> {
    const release = await this.acquire(priority);
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export const gpuLock = new GpuLock();
