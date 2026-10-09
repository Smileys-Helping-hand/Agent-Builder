"use client";

/**
 * The coding model, as it sits on this PC: which one, how much of it is on the
 * graphics card and how much runs from RAM, and the buttons to load it,
 * restart the model server, or switch between the two set-ups that suit an
 * 8 GB card (the 14b split between GPU and RAM, or the 7b all on the card).
 */
import Link from "next/link";
import { useState } from "react";

import { ApiError, api } from "@/lib/api";
import { Busy, Icon, useRemote, useToast } from "../ui";

/** The two set-ups that make sense on an 8 GB card, measured on this PC. */
const PRESETS: Array<{ id: string; label: string; hint: string; values: Record<string, string> }> = [
  {
    id: "14b",
    label: "14b, split GPU + RAM",
    hint: "Better code. 28 of its 49 layers on the card, the rest from 32 GB RAM: about 5 words a second, loads in ~20 s.",
    values: {
      OLLAMA_MODEL: "qwen2.5-coder:14b",
      DEEP_REVIEW_MODEL: "qwen2.5-coder:14b",
      OLLAMA_NUM_CTX: "16384",
      OLLAMA_NUM_GPU: "auto",
      OLLAMA_KV_CACHE_TYPE: "q8_0",
      OLLAMA_FLASH_ATTENTION: "true"
    }
  },
  {
    id: "7b",
    label: "7b, all on the card",
    hint: "Faster passes, weaker code. Fits the 8 GB card whole.",
    values: {
      OLLAMA_MODEL: "qwen2.5-coder:7b",
      DEEP_REVIEW_MODEL: "qwen2.5-coder:14b",
      OLLAMA_NUM_CTX: "16384",
      OLLAMA_NUM_GPU: "auto",
      OLLAMA_KV_CACHE_TYPE: "q8_0",
      OLLAMA_FLASH_ATTENTION: "true"
    }
  }
];

export function ModelCard() {
  const toast = useToast();
  const model = useRemote(() => api.modelStatus(), 10000);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  const act = async (name: string, action: () => Promise<{ message: string }>) => {
    setBusy(name);
    try {
      const res = await action();
      toast(res.message, "ok");
      setConfirm(null);
      await model.refresh();
    } catch (error) {
      // A build is using the model: say so, and let them choose.
      if (error instanceof ApiError && error.status === 409) setConfirm(error.message);
      else toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(null);
    }
  };

  const data = model.data;
  const loaded = data?.loaded ?? [];
  const current = PRESETS.find((preset) => preset.values.OLLAMA_MODEL === data?.model);

  return (
    <div className="card model-card">
      <h2>The coding model</h2>
      <p className="hint">
        {data ? (
          <>
            Writes with <b>{data.model}</b>, reads {data.options.num_ctx.toLocaleString()} tokens at once
            {data.serverSettings.OLLAMA_KV_CACHE_TYPE ? `, ${data.serverSettings.OLLAMA_KV_CACHE_TYPE} cache` : ""}
            {data.options.num_gpu ? `, ${data.options.num_gpu} layers forced on the card` : ", as many layers on the card as fit"}.
          </>
        ) : (
          "Reading the model server…"
        )}
      </p>

      {loaded.length === 0 ? (
        <p className="hint">{data?.server === "down" ? "The model server is off; a build starts it." : "Not loaded right now; it loads on the next build, or press Load it now."}</p>
      ) : (
        loaded.map((entry) => (
          <div className="split" key={entry.name}>
            <div className="split-head">
              <strong>{entry.name}</strong>
              <span>
                {entry.gpuGB} GB on the card · {entry.ramGB} GB in RAM
                {entry.context ? ` · ${entry.context.toLocaleString()} tokens` : ""}
              </span>
            </div>
            <div className="split-bar" role="img" aria-label={`${entry.onGpuPercent}% on the graphics card`}>
              <span className="split-gpu" style={{ width: `${entry.onGpuPercent}%` }} />
            </div>
            <small className="hint">{entry.onGpuPercent}% on the graphics card, the rest on the CPU</small>
          </div>
        ))
      )}

      <div className="quick">
        <button disabled={busy !== null} onClick={() => void act("load", async () => {
          const res = await api.warmModel();
          return { message: `${res.message} (${res.seconds}s)` };
        })}>
          {busy === "load" ? <Busy label="Loading" /> : <>{Icon.sparkle} Load it now</>}
        </button>
        <button disabled={busy !== null} onClick={() => void act("restart", () => api.restartModelServer(false))}>
          {busy === "restart" ? <Busy label="Restarting" /> : <>{Icon.refresh} Restart model server</>}
        </button>
        <Link className="btn" href="/settings">
          {Icon.gear} All model settings
        </Link>
      </div>

      {confirm ? (
        <div className="confirm-box">
          <p>{confirm}</p>
          <div className="btn-row">
            <button className="btn danger" disabled={busy !== null} onClick={() => void act("restart", () => api.restartModelServer(true))}>
              Restart anyway
            </button>
            <button className="btn" onClick={() => setConfirm(null)}>
              Leave it
            </button>
          </div>
        </div>
      ) : null}

      <div className="preset-row">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            className={`preset ${current?.id === preset.id ? "on" : ""}`}
            aria-pressed={current?.id === preset.id}
            disabled={busy !== null}
            onClick={() => void act(`preset-${preset.id}`, () => api.saveBuilderSettings(preset.values))}
          >
            <strong>{busy === `preset-${preset.id}` ? <Busy label="Switching" /> : preset.label}</strong>
            <small>{preset.hint}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
