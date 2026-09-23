"use client";

import { useState } from "react";

import { api, type Order, type OrderStatus } from "@/lib/api";
import { Banner, Busy, Header, Icon, NotConnected, Skeleton, ago, useConnected, useRemote, useToast } from "../ui";

/**
 * What each state means, in the customer's terms rather than the code's.
 * "review" is the one worth being explicit about: nothing reaches a customer
 * until a person has looked at it, and the wording should make that obvious.
 */
const STATUS: Record<OrderStatus, { label: string; hint: string; tone: "up" | "degraded" | "down" | "" }> = {
  received: { label: "New", hint: "Just came in. Accept it to put it in the queue.", tone: "degraded" },
  accepted: { label: "Queued", hint: "Waiting its turn to be built.", tone: "degraded" },
  building: { label: "Building", hint: "Being built right now.", tone: "up" },
  review: { label: "Ready to check", hint: "Finished. Nothing has gone to the customer yet.", tone: "up" },
  delivered: { label: "Delivered", hint: "Handed over. Not being improved.", tone: "up" },
  maintained: { label: "Delivered · improving", hint: "Handed over, and still being improved.", tone: "up" },
  failed: { label: "Needs you", hint: "Three builds failed. Someone has to look.", tone: "down" },
  cancelled: { label: "Cancelled", hint: "Stopped.", tone: "" }
};

const GROUPS: Array<{ title: string; statuses: OrderStatus[] }> = [
  { title: "Needs you", statuses: ["received", "review", "failed"] },
  { title: "In progress", statuses: ["building", "accepted"] },
  { title: "Delivered", statuses: ["delivered", "maintained"] },
  { title: "Closed", statuses: ["cancelled"] }
];

export default function Orders() {
  const connected = useConnected();
  const toast = useToast();
  const orders = useRemote(() => api.orders(), 15000);
  const pipeline = useRemote(() => api.pipeline(), 30000);

  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [instruction, setInstruction] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ customerName: "", customerEmail: "", productType: "website", brief: "", budget: "", timeline: "" });

  if (connected === false) return <NotConnected />;

  const fail = (error: unknown) => toast(error instanceof Error ? error.message : String(error), "error");

  const act = async (label: string, run: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await run();
      toast(label, "ok");
      await Promise.all([orders.refresh(), pipeline.refresh()]);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const addOrder = async () => {
    await act("Order added.", async () => {
      await api.addOrder({
        customerName: draft.customerName.trim(),
        customerEmail: draft.customerEmail.trim() || undefined,
        productType: draft.productType.trim() || "website",
        brief: draft.brief.trim(),
        budget: draft.budget.trim() || undefined,
        timeline: draft.timeline.trim() || undefined
      });
      setDraft({ customerName: "", customerEmail: "", productType: "website", brief: "", budget: "", timeline: "" });
      setAdding(false);
    });
  };

  const instruct = async (order: Order) => {
    const text = (instruction[order.id] ?? "").trim();
    if (!text) return;
    await act("Sent. It takes effect on the next pass.", async () => {
      await api.instructOrder(order.id, text);
      setInstruction((current) => ({ ...current, [order.id]: "" }));
    });
  };

  const list = orders.data?.orders ?? [];
  const counts = orders.data?.counts;
  const attention = (counts?.received ?? 0) + (counts?.review ?? 0) + (counts?.failed ?? 0);
  const site = pipeline.data?.site;

  return (
    <>
      <Header
        title="Orders"
        sub={
          list.length === 0
            ? "No orders yet"
            : attention > 0
              ? `${attention} need you · ${list.length} total`
              : `${list.length} orders · all handled`
        }
        state={orders.error ? "down" : attention > 0 ? "warn" : (counts?.building ?? 0) > 0 ? "busy" : "up"}
      />

      <div className="wrap">
        {orders.error ? <Banner kind="error">{orders.error}</Banner> : null}

        <section className="hero">
          <div className="hero-label">Customer pipeline</div>
          <h2 className="hero-title">
            {site?.configured ? "Connected to your site" : "Not connected to your site yet"}
          </h2>
          <p className="hero-sub">
            {site?.configured
              ? `Orders are pulled from ${site.site} every few minutes. Built here, checked by you, then handed over — and they keep improving after that.`
              : "Add SITE_URL and SITE_API_KEY on your machine and orders from your website arrive here on their own. Until then you can add them by hand."}
          </p>

          <div className="quick" style={{ marginTop: 14 }}>
            <button onClick={() => setAdding((value) => !value)} disabled={busy}>
              {Icon.sparkle} {adding ? "Cancel" : "Add an order"}
            </button>
            <button onClick={() => act("Checked the site.", () => api.pullOrders())} disabled={busy || !site?.configured}>
              {Icon.refresh} Check the site now
            </button>
          </div>

          {adding ? (
            <div style={{ marginTop: 6 }}>
              <label className="field">
                <span>Customer name</span>
                <input value={draft.customerName} onChange={(event) => setDraft({ ...draft, customerName: event.target.value })} />
              </label>
              <label className="field">
                <span>Their email (optional)</span>
                <input value={draft.customerEmail} onChange={(event) => setDraft({ ...draft, customerEmail: event.target.value })} />
              </label>
              <label className="field">
                <span>What they want</span>
                <input
                  value={draft.productType}
                  onChange={(event) => setDraft({ ...draft, productType: event.target.value })}
                  placeholder="website, landing page, template…"
                />
              </label>
              <label className="field">
                <span>The brief, in their words</span>
                <textarea
                  rows={4}
                  value={draft.brief}
                  onChange={(event) => setDraft({ ...draft, brief: event.target.value })}
                  placeholder="What the site is for, what should be on it, and what should happen when someone uses it."
                />
              </label>
              <div className="row" style={{ display: "flex", gap: 10 }}>
                <label className="field" style={{ flex: 1 }}>
                  <span>Budget</span>
                  <input value={draft.budget} onChange={(event) => setDraft({ ...draft, budget: event.target.value })} />
                </label>
                <label className="field" style={{ flex: 1 }}>
                  <span>Timeline</span>
                  <input value={draft.timeline} onChange={(event) => setDraft({ ...draft, timeline: event.target.value })} />
                </label>
              </div>
              <button
                className="power"
                onClick={addOrder}
                disabled={busy || draft.customerName.trim().length < 2 || draft.brief.trim().length < 20}
              >
                {busy ? <Busy label="Adding…" /> : <>{Icon.check} Add it</>}
              </button>
            </div>
          ) : null}
        </section>

        {orders.loading && list.length === 0 ? <Skeleton rows={3} /> : null}

        {GROUPS.map((group) => {
          const inGroup = list.filter((order) => group.statuses.includes(order.status));
          if (inGroup.length === 0) return null;

          return (
            <div key={group.title}>
              <div className="section-title">
                {group.title} ({inGroup.length})
              </div>

              {inGroup.map((order) => {
                const meta = STATUS[order.status];
                const expanded = open === order.id;
                const building = order.status === "building";

                return (
                  <div key={order.id} className="card">
                    <div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
                      <span className={`pill ${meta.tone}`} style={{ marginTop: 7 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <strong style={{ fontSize: 15.5, display: "block" }}>{order.title}</strong>
                        <small style={{ color: "var(--muted)" }}>
                          {order.customerName} · {meta.label} · {ago(order.updatedAt)}
                        </small>

                        <div className="chips" style={{ marginTop: 8 }}>
                          <span className="chip">{order.productType}</span>
                          {order.budget ? <span className="chip">{order.budget}</span> : null}
                          {order.timeline ? <span className="chip">{order.timeline}</span> : null}
                          {order.qualityScore > 0 ? (
                            <span className="chip accent">quality {Math.round(order.qualityScore)}</span>
                          ) : null}
                          {order.attempts > 1 ? <span className="chip">attempt {order.attempts}</span> : null}
                          {order.autoImprove && (order.status === "maintained" || order.status === "delivered") ? (
                            <span className="chip accent">improving</span>
                          ) : null}
                        </div>

                        {building && order.build ? (
                          <small style={{ color: "var(--muted)", display: "block", marginTop: 8 }}>
                            Pass {order.build.iterations || 1} · {order.build.stage}
                          </small>
                        ) : null}

                        {order.status === "review" ? (
                          <Banner kind="info">
                            Finished and waiting for you. Look at it in {order.deliverablePath ?? "the build folder"}, then hand it over.
                          </Banner>
                        ) : null}

                        <div className="btn-row" style={{ marginTop: 11 }}>
                          {order.status === "received" ? (
                            <button className="btn" disabled={busy} onClick={() => act("Queued.", () => api.acceptOrder(order.id))}>
                              {Icon.check} Accept
                            </button>
                          ) : null}
                          {(order.status === "accepted" || order.status === "failed") ? (
                            <button className="btn" disabled={busy} onClick={() => act("Building.", () => api.buildOrder(order.id))}>
                              {Icon.sparkle} Build it now
                            </button>
                          ) : null}
                          {order.status === "review" ? (
                            <button className="btn" disabled={busy} onClick={() => act("Handed over.", () => api.deliverOrder(order.id))}>
                              {Icon.check} Hand it over
                            </button>
                          ) : null}
                          {order.status === "review" || order.status === "maintained" ? (
                            <button className="btn" disabled={busy} onClick={() => act("Another pass started.", () => api.buildOrder(order.id))}>
                              {Icon.refresh} Improve it again
                            </button>
                          ) : null}
                          {(order.status === "delivered" || order.status === "maintained") ? (
                            <button
                              className="btn"
                              disabled={busy}
                              onClick={() =>
                                act(order.autoImprove ? "Improvement off." : "Improvement on.", () =>
                                  api.setOrderAutoImprove(order.id, !order.autoImprove)
                                )
                              }
                            >
                              {order.autoImprove ? "Stop improving" : "Keep improving"}
                            </button>
                          ) : null}
                          <button className="btn" onClick={() => setOpen(expanded ? null : order.id)}>
                            {expanded ? "Less" : "The brief"}
                          </button>
                          {order.status !== "cancelled" && order.status !== "delivered" ? (
                            <button
                              className="btn"
                              disabled={busy}
                              onClick={() => act("Cancelled.", () => api.cancelOrder(order.id, "Cancelled from the app."))}
                            >
                              Cancel
                            </button>
                          ) : null}
                        </div>

                        {building ? (
                          <>
                            <label className="field" style={{ marginTop: 12 }}>
                              <span>Something the customer changed their mind about?</span>
                              <textarea
                                rows={2}
                                value={instruction[order.id] ?? ""}
                                onChange={(event) => setInstruction((current) => ({ ...current, [order.id]: event.target.value }))}
                                placeholder="e.g. They want the booking form on the home page, not a separate page."
                              />
                            </label>
                            <button className="btn" disabled={busy || !(instruction[order.id] ?? "").trim()} onClick={() => instruct(order)}>
                              {Icon.sparkle} Tell the build
                            </button>
                          </>
                        ) : null}

                        {expanded ? (
                          <div style={{ marginTop: 12, paddingTop: 11, borderTop: "1px solid var(--line)" }}>
                            <small style={{ color: "var(--muted)" }}>What they asked for</small>
                            <p style={{ fontSize: 13.8, margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{order.brief}</p>
                            {order.customerEmail ? (
                              <small style={{ color: "var(--muted)", display: "block", marginTop: 9 }}>{order.customerEmail}</small>
                            ) : null}
                            {order.deliverablePath ? (
                              <small style={{ color: "var(--muted)", display: "block", marginTop: 5, overflowWrap: "anywhere" }}>
                                {order.deliverablePath}
                              </small>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}

        {!orders.loading && list.length === 0 ? (
          <div className="empty">
            No orders yet. They arrive from your site on their own, or you can add one above.
          </div>
        ) : null}
      </div>
    </>
  );
}
