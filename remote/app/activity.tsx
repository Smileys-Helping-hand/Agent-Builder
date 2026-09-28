"use client";

/**
 * Builds, watched from every screen.
 *
 * One poll for the whole app rather than one per page: the Build tab's badge,
 * the tab title, the Home card and the Build screen all read the same list, so
 * they never disagree, and moving between screens never starts from empty.
 * The list is cached on the device, so a refresh shows it straight away.
 *
 * It also notices when a build ends — even one that ended while the app was
 * closed — and says so once.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

import { api, loadConnection, type Build } from "@/lib/api";
import { readJson, writeJson } from "@/lib/store";
import { useRemote, useToast } from "./ui";

interface Activity {
  builds: Build[];
  live: Build[];
  loading: boolean;
  error: string | null;
  updatedAt: number | null;
  fresh: boolean;
  refresh: () => Promise<void>;
}

const ActivityContext = createContext<Activity>({
  builds: [],
  live: [],
  loading: true,
  error: null,
  updatedAt: null,
  fresh: false,
  refresh: async () => {}
});

export const useActivity = () => useContext(ActivityContext);

export const isLive = (build: Build): boolean => build.live && (build.state === "running" || build.state === "paused");

const SEEN_KEY = "seen-build-states";

const endingMessage = (build: Build): { text: string; tone: "ok" | "error" | "info" } => {
  const score = Math.round(build.bestScore ?? build.qualityScore);
  switch (build.state) {
    case "completed":
      return build.passed
        ? { text: `${build.projectName} is built — every check passes (quality ${score}).`, tone: "ok" }
        : { text: `${build.projectName} finished at quality ${score}, but not every check passes yet.`, tone: "info" };
    case "error":
      return { text: `${build.projectName} failed: ${build.error ?? "no reason given"}`, tone: "error" };
    case "interrupted":
      return { text: `${build.projectName} was interrupted when the builder restarted. You can continue it.`, tone: "info" };
    default:
      return { text: `${build.projectName} stopped.`, tone: "info" };
  }
};

export const ActivityProvider = ({ children }: { children: React.ReactNode }) => {
  const toast = useToast();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const check = () => setConnected(Boolean(loadConnection()));
    check();
    // Connecting happens in Settings (or via the QR link); pick it up without a reload.
    window.addEventListener("storage", check);
    const timer = setInterval(check, 3000);
    return () => {
      window.removeEventListener("storage", check);
      clearInterval(timer);
    };
  }, []);

  const remote = useRemote(
    async () => (connected ? api.builds() : { count: 0, active: 0, builds: [] as Build[] }),
    6000,
    connected ? "builds" : undefined
  );
  const { refresh } = remote;

  useEffect(() => {
    if (connected) void refresh();
  }, [connected, refresh]);

  const builds = useMemo(() => remote.data?.builds ?? [], [remote.data]);
  const live = useMemo(() => builds.filter(isLive), [builds]);

  // Say once when a build ends. What was last seen is kept on the device, so a
  // refresh does not repeat it, and a build that ended while the app was
  // closed is still reported the next time it opens.
  const primed = useRef(false);
  useEffect(() => {
    if (!remote.fresh || builds.length === 0) return;
    const seen = readJson<Record<string, string>>(SEEN_KEY) ?? {};
    const firstRun = Object.keys(seen).length === 0 && !primed.current;
    primed.current = true;
    const next: Record<string, string> = {};
    for (const build of builds) {
      next[build.buildId] = build.state;
      const before = seen[build.buildId];
      const wasRunning = before === "running" || before === "paused";
      if (!firstRun && wasRunning && !isLive(build)) {
        const message = endingMessage(build);
        toast(message.text, message.tone);
      }
    }
    writeJson(SEEN_KEY, next);
  }, [builds, remote.fresh, toast]);

  // The tab title shows work in progress, so it is visible from another tab.
  useEffect(() => {
    const base = "Agent Builder";
    document.title = live.length > 0 ? `(${live.length}) Building · ${base}` : base;
  }, [live.length]);

  const value = useMemo<Activity>(
    () => ({
      builds,
      live,
      loading: remote.loading,
      error: remote.error,
      updatedAt: remote.updatedAt,
      fresh: remote.fresh,
      refresh: remote.refresh
    }),
    [builds, live, remote.loading, remote.error, remote.updatedAt, remote.fresh, remote.refresh]
  );

  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
};
