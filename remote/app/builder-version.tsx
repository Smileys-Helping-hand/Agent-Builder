"use client";

/**
 * Is the builder on the PC as new as this app? The app on Vercel updates on
 * every merge; the builder only when the PC pulls. When they drift, new screens
 * call routes the builder does not have yet and simply do not work — this is
 * how the app notices and says so, on every screen, with the way to fix it.
 *
 * Kept free of ./ui imports so the shared Header can show the strip.
 */
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { ApiError, api, loadConnection, type BuilderVersion } from "@/lib/api";

interface VersionState {
  info: BuilderVersion | null;
  /** Older than the version check itself: it cannot even say. */
  tooOld: boolean;
  behind: number;
  refresh: (force?: boolean) => Promise<void>;
}

const VersionContext = createContext<VersionState>({ info: null, tooOld: false, behind: 0, refresh: async () => {} });

export const useBuilderVersion = () => useContext(VersionContext);

export const BuilderVersionProvider = ({ children }: { children: React.ReactNode }) => {
  const [info, setInfo] = useState<BuilderVersion | null>(null);
  const [tooOld, setTooOld] = useState(false);

  const refresh = useCallback(async (force = false) => {
    if (!loadConnection()) return;
    try {
      setInfo(await api.builderVersion(force));
      setTooOld(false);
    } catch (error) {
      // A builder from before this check answers 404: by definition behind.
      if (error instanceof ApiError && error.status === 404) setTooOld(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 15 * 60_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const behind = info?.available ? info.behind : 0;
  return <VersionContext.Provider value={{ info, tooOld, behind, refresh }}>{children}</VersionContext.Provider>;
};

/** One line under the header when the PC's builder is behind the app. */
export const UpdateStrip = () => {
  const { tooOld, behind } = useBuilderVersion();
  if (!tooOld && behind === 0) return null;
  return (
    <Link href="/control/#update" className="update-strip">
      <span>⬆</span>
      <span>
        {tooOld
          ? "The builder on your PC is older than this app, so some screens will not work. Update it — on the PC: git pull, then restart Agent Builder."
          : `The builder on your PC is ${behind} update${behind === 1 ? "" : "s"} behind this app.`}
      </span>
      {!tooOld ? <b>Update</b> : null}
    </Link>
  );
};
