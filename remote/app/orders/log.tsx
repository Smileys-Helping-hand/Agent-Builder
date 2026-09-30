"use client";

/**
 * The orders log: what happened to every order, and a receipt for every
 * hand-over. The activity is the same notes each order keeps, gathered into
 * one list; receipts are the permanent record written when an order is
 * delivered, each checked against the digest it was issued with.
 */
import { useState } from "react";

import { api, type OrderReceipt } from "@/lib/api";
import { Banner, Skeleton, ago, dayLabel, useRemote } from "../ui";

const KIND_TONE: Record<string, string> = {
  delivered: "good",
  receipt: "good",
  accepted: "",
  failed: "bad",
  cancelled: "bad",
  instruction: "warn"
};

/** A clean page with just the receipt, for printing or saving as PDF. */
const printReceipt = (receipt: OrderReceipt) => {
  const tab = window.open("", "_blank");
  if (!tab) return;
  const doc = tab.document;
  doc.title = `Receipt ${receipt.number}`;
  const style = doc.createElement("style");
  style.textContent =
    "body{font:14px system-ui;margin:40px;color:#111}h1{margin:0 0 4px}table{border-collapse:collapse;width:100%;margin-top:18px}" +
    "td{padding:8px 0;border-bottom:1px solid #eee;vertical-align:top}td:first-child{color:#666;width:40%}code{font-size:11px;word-break:break-all}";
  doc.head.appendChild(style);
  const h1 = doc.createElement("h1");
  h1.textContent = "Delivery receipt";
  const sub = doc.createElement("div");
  sub.textContent = `ARP Cloud Solutions · ${receipt.number}`;
  const table = doc.createElement("table");
  const rows: Array<[string, string]> = [
    ["Delivered", new Date(receipt.createdAt).toLocaleString("en-ZA")],
    ["Order", receipt.title],
    ["Customer", [receipt.customerName, receipt.customerEmail].filter(Boolean).join(" · ")],
    ["Quality score", String(Math.round(receipt.qualityScore))],
    ["Builds it took", String(receipt.attempts)],
    ["Where it lives", receipt.deliverableUrl ?? "Handed over as a download"],
    ["Handed over by", receipt.by],
    ["Build", receipt.buildId ?? "—"],
    ["Record check", receipt.verified ? "Matches the record" : "Does NOT match the record"]
  ];
  for (const [label, value] of rows) {
    const tr = doc.createElement("tr");
    const a = doc.createElement("td");
    const b = doc.createElement("td");
    a.textContent = label;
    b.textContent = value;
    tr.append(a, b);
    table.appendChild(tr);
  }
  const code = doc.createElement("p");
  const small = doc.createElement("code");
  small.textContent = `Check code: ${receipt.digest}`;
  code.appendChild(small);
  doc.body.append(h1, sub, table, code);
  tab.print();
};

export function OrdersLog() {
  const [tab, setTab] = useState<"activity" | "receipts">("activity");
  const activity = useRemote(() => api.orderActivity(150), 20000);
  const receipts = useRemote(() => api.orderReceipts(100), 30000);

  const entries = activity.data?.activity ?? [];
  const list = receipts.data?.receipts ?? [];

  // Group the activity by day so a long list stays readable.
  const days: Array<{ label: string; items: typeof entries }> = [];
  for (const entry of entries) {
    const label = dayLabel(entry.createdAt);
    const last = days[days.length - 1];
    if (last && last.label === label) last.items.push(entry);
    else days.push({ label, items: [entry] });
  }

  return (
    <section style={{ marginTop: 22 }}>
      <div className="section-title" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span>Activity & receipts</span>
        <span className="btn-row" style={{ marginLeft: "auto" }}>
          <button className={`btn ${tab === "activity" ? "accent" : ""}`} onClick={() => setTab("activity")}>
            Activity ({entries.length})
          </button>
          <button className={`btn ${tab === "receipts" ? "accent" : ""}`} onClick={() => setTab("receipts")}>
            Receipts ({list.length})
          </button>
        </span>
      </div>

      {tab === "activity" ? (
        <>
          {activity.error ? <Banner kind="error">{activity.error}</Banner> : null}
          {activity.loading && entries.length === 0 ? <Skeleton rows={3} /> : null}
          {!activity.loading && entries.length === 0 ? (
            <div className="empty">Nothing has happened to any order yet.</div>
          ) : null}
          {days.map((day) => (
            <div key={day.label} className="card">
              <small style={{ color: "var(--muted)", fontWeight: 600 }}>{day.label}</small>
              {day.items.map((entry) => (
                <div key={entry.id} style={{ display: "flex", gap: 10, padding: "8px 0", borderTop: "1px solid var(--line)" }}>
                  <span className={`pill ${KIND_TONE[entry.kind] ?? ""}`} style={{ marginTop: 6 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5 }}>
                      <strong>{entry.title}</strong>
                      <span style={{ color: "var(--muted)" }}> · {entry.customerName}</span>
                    </div>
                    <div style={{ fontSize: 13.5, overflowWrap: "anywhere" }}>{entry.message}</div>
                  </div>
                  <small style={{ color: "var(--faint)", whiteSpace: "nowrap" }}>
                    {entry.kind} · {ago(entry.createdAt)}
                  </small>
                </div>
              ))}
            </div>
          ))}
        </>
      ) : (
        <>
          {receipts.error ? <Banner kind="error">{receipts.error}</Banner> : null}
          {receipts.loading && list.length === 0 ? <Skeleton rows={2} /> : null}
          {!receipts.loading && list.length === 0 ? (
            <div className="empty">No receipts yet. One is written each time you hand an order over.</div>
          ) : null}
          {list.map((receipt) => (
            <div key={receipt.id} className="card">
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <strong style={{ display: "block" }}>{receipt.number}</strong>
                  <small style={{ color: "var(--muted)" }}>
                    {receipt.title} · {receipt.customerName} · {ago(receipt.createdAt)}
                  </small>
                  <div className="chips" style={{ marginTop: 8 }}>
                    <span className="chip accent">quality {Math.round(receipt.qualityScore)}</span>
                    <span className="chip">by {receipt.by}</span>
                    <span className={`chip ${receipt.verified ? "" : "bad"}`}>
                      {receipt.verified ? "matches the record" : "does not match the record"}
                    </span>
                  </div>
                </div>
                <button className="btn" onClick={() => printReceipt(receipt)}>
                  Print
                </button>
              </div>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
