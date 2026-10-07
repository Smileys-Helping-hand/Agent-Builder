"use client";

/**
 * Download what a build has made: a zip with "Open the website.html" to
 * double-click (works with no internet or tools), the source code, and how to
 * open and publish it. Packaging can take a minute the first time, while it
 * builds the site.
 */
import { useState } from "react";

import { api } from "@/lib/api";
import { Busy, Icon, useToast } from "../ui";

export const DownloadBuild = ({ id, label = "Download" }: { id: string; label?: string }) => {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <button
      className="btn small"
      disabled={busy}
      title="A zip: the app as one file you can double-click, plus its source"
      onClick={async () => {
        setBusy(true);
        try {
          const url = await api.downloadBuildUrl(id);
          // The PC packages it on request; the browser saves the zip when it is ready.
          window.location.href = url;
          toast("Packaging it — the download starts in a moment.");
        } catch (error) {
          toast(error instanceof Error ? error.message : String(error));
        } finally {
          setTimeout(() => setBusy(false), 4000);
        }
      }}
    >
      {busy ? <Busy label="Packaging…" /> : <>{Icon.download} {label}</>}
    </button>
  );
};

/**
 * The build as an app: an Android APK for phones or a Windows program. The PC
 * makes it from the finished site (a minute or two, longer the very first
 * time), so this starts it, checks in every few seconds, and downloads it
 * when it is ready.
 */
export const DownloadApp = ({ id, platform }: { id: string; platform: "android" | "windows" }) => {
  const [stage, setStage] = useState<string | null>(null);
  const toast = useToast();
  const label = platform === "android" ? "Android app" : "Windows app";
  return (
    <button
      className="btn small"
      disabled={stage !== null}
      title={platform === "android" ? "An APK to install on Android phones" : "A Windows program (.exe) that opens the app in its own window"}
      onClick={async () => {
        setStage("starting");
        try {
          let status = await api.startApp(id, platform);
          const started = Date.now();
          while (status.state === "building" && Date.now() - started < 20 * 60 * 1000) {
            setStage(status.stage ?? "building");
            await new Promise((resolve) => setTimeout(resolve, 4000));
            status = await api.appStatus(id, platform);
          }
          if (status.state !== "ready") throw new Error(status.error ? `Could not make the ${label}: ${status.error}` : `The ${label} is taking longer than usual; try again in a minute.`);
          window.location.href = await api.appUrl(id, platform);
          toast(`${label} ready — downloading ${status.fileName ?? ""}`);
        } catch (error) {
          toast(error instanceof Error ? error.message : String(error));
        } finally {
          setStage(null);
        }
      }}
    >
      {stage ? <Busy label={stage === "starting" ? "Starting…" : `${stage[0].toUpperCase()}${stage.slice(1)}…`} /> : <>{Icon.download} {label}</>}
    </button>
  );
};
