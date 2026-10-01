"use client";

/**
 * Whether the business is taking orders yet. "Launching soon" tells the
 * Consolidated Hub at once (it shows the message instead of checkout) and keeps
 * any order that does come in from building by itself.
 */
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { Busy, useToast } from "../ui";

export const OrdersModeSwitch = ({
  mode,
  message,
  onChanged
}: {
  mode: "open" | "launching-soon" | undefined;
  message: string | null | undefined;
  onChanged: () => Promise<void> | void;
}) => {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(message ?? "");
  useEffect(() => setDraft(message ?? ""), [message]);

  if (!mode) return null;
  const soon = mode === "launching-soon";

  const save = async (values: Record<string, string>, done: string) => {
    setBusy(true);
    try {
      await api.saveBuilderSettings(values);
      toast(done, "ok");
      await onChanged();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`card orders-mode ${soon ? "soon" : "open"}`}>
      <div className="orders-mode-head">
        <div>
          <div className="hero-label">Taking orders</div>
          <strong className="orders-mode-state">{soon ? "Launching soon" : "Open for orders"}</strong>
          <p className="hint" style={{ margin: "4px 0 0" }}>
            {soon
              ? "The Hub shows your message instead of checkout. Orders that still arrive wait for you — nothing builds by itself."
              : "Customers can order on the Hub, and accepted orders build by themselves."}
          </p>
        </div>
        <div className="segmented" role="group" aria-label="Taking orders" style={{ minWidth: 240, gridTemplateColumns: "1fr 1fr" }}>
          <button className={!soon ? "on" : ""} disabled={busy || !soon} onClick={() => save({ ORDERS_MODE: "open" }, "Open for orders — the Hub is told now")}>
            Open
          </button>
          <button
            className={soon ? "on" : ""}
            disabled={busy || soon}
            onClick={() => save({ ORDERS_MODE: "launching-soon" }, "Launching soon — the Hub is told now")}
          >
            {busy ? <Busy label="…" /> : "Launching soon"}
          </button>
        </div>
      </div>
      {soon ? (
        <div className="orders-mode-message">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="e.g. We open for orders on 1 November — leave your email and we'll let you know."
            maxLength={300}
          />
          <button className="btn small" disabled={busy || draft === (message ?? "")} onClick={() => save({ ORDERS_LAUNCH_MESSAGE: draft }, "Message sent to the Hub")}>
            Save message
          </button>
        </div>
      ) : null}
    </section>
  );
};
