/**
 * WorkloadCoordinator - lets background learning yield to foreground builds.
 *
 * Research runs indefinitely; builds are what someone is waiting on. Both
 * share one GPU through gpuLock, which serializes model calls but doesn't
 * prioritize them — without this, a research cycle that grabs the lock first
 * makes a build sit behind a long document-generation call.
 */
let activeBuilds = 0;

export const WorkloadCoordinator = {
  /** Mark a build as running. Call the returned function exactly once when it ends; extra calls are ignored. */
  beginBuild(): () => void {
    activeBuilds += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      activeBuilds = Math.max(0, activeBuilds - 1);
    };
  },

  isBuildActive(): boolean {
    return activeBuilds > 0;
  },

  activeBuildCount(): number {
    return activeBuilds;
  }
};
