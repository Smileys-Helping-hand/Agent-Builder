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
