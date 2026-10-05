"use client";

import Link from "next/link";
import { useState } from "react";

import { api, type Order, type OrderStatus } from "@/lib/api";
import { Banner, Busy, Header, Icon, NotConnected, Skeleton, ago, useConnected, useRemote, useToast } from "../ui";
import { BuildProgress, STAGE_LABEL } from "../build/parts";
import { OrdersModeSwitch } from "./mode";
import { TemplateStudio } from "./templates";
import { OrdersLog } from "./log";
import { PreviewPane } from "../preview";
import { ReviewPanel } from "./review";

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
  const hub = useRemote(() => api.hubStatus(), 30000);

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
      await Promise.all([orders.refresh(), pipeline.refresh(), hub.refresh()]);
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
    await act("Sent. It takes effect on the next repair or pass.", async () => {
      await api.instructOrder(order.id, text);
      setInstruction((current) => ({ ...current, [order.id]: "" }));
    });
  };

  const list = orders.data?.orders ?? [];
  const counts = orders.data?.counts;
  const attention = (counts?.received ?? 0) + (counts?.review ?? 0) + (counts?.failed ?? 0);
  const site = pipeline.data?.site;
  const hubData = hub.data;

  return (
    <>
      <Header
        title="Orders & Templates"
        sub={
          list.length === 0
            ? "No orders yet · Templates ready"
            : attention > 0
              ? `${attention} need you · ${list.length} total`
              : `${list.length} orders · all handled`
        }
        state={orders.error ? "down" : attention > 0 ? "warn" : (counts?.building ?? 0) > 0 ? "busy" : "up"}
      />

      <div className="wrap">
        {orders.error ? <Banner kind="error">{orders.error}</Banner> : null}

        {pipeline.data?.hold ? (
          <Banner kind="error">
            Builds are on hold: {pipeline.data.hold.reason ?? "the PC cannot build right now"}. Orders wait in the queue without using up their attempts,
            and the next try is at {new Date(pipeline.data.hold.until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.
          </Banner>
        ) : null}
        <OrdersModeSwitch mode={pipeline.data?.ordersMode} message={pipeline.data?.launchMessage} onChanged={() => pipeline.refresh()} />

        {/* Consolidated Hub & PayFast Integration Banner */}
        <section
          className="card"
          style={{
            marginTop: 16,
            marginBottom: 16,
            border: "1px solid rgba(61, 220, 154, 0.35)",
            background: "linear-gradient(135deg, rgba(61, 220, 154, 0.08), rgba(20, 30, 51, 0.8))"
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 14 }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                <span className="pill up" style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--good)" }} />
                <strong style={{ fontSize: 16 }}>Consolidated Hub · arpcloudsolutions.co.za</strong>
                <span className="chip accent">
                  PayFast {hubData?.payfast?.mode ? hubData.payfast.mode.toUpperCase() : "LIVE"} ({hubData?.payfast?.merchantId || "36249939"})
                </span>
              </div>
              <p style={{ margin: "7px 0 0", color: "var(--muted)", fontSize: 13.5, lineHeight: 1.45 }}>
                Direct customer intake & PayFast payment processing. Template purchases or client website requests dispatch builds autonomously, package the codebase into downloadable archives, and deliver to the client.
              </p>
              {hubData?.intake?.lastIntakeAt ? (
                <small style={{ color: "var(--faint)", display: "block", marginTop: 6 }}>
                  Last sync: {ago(hubData.intake.lastIntakeAt)} · {hubData.intake.lastIntakeCount} intake passes recorded
                </small>
              ) : null}
              {hubData?.catalog ? (
                <small style={{ color: hubData.catalog.ok ? "var(--faint)" : "var(--bad)", display: "block", marginTop: 4 }}>
                  {hubData.catalog.ok
                    ? `On the site: ${hubData.catalog.count} templates, published ${ago(hubData.catalog.at)}`
                    : `Templates not on the site yet: ${hubData.catalog.message}`}
                </small>
              ) : null}
            </div>

            <div style={{ display: "flex", gap: 9, flexWrap: "wrap", alignSelf: "center" }}>
              <button
                className="btn"
                disabled={busy}
                onClick={() => act("Checked Consolidated Hub.", () => api.pullOrders())}
              >
                {Icon.refresh} Pull Hub Orders
              </button>
              <button
                className="btn accent"
                disabled={busy}
                onClick={() =>
                  act("Signal verified to Consolidated Hub.", async () => {
                    const res = await api.testHub();
                    if (!res.ok) throw new Error(res.message || "Failed to reach Consolidated Hub");
                  })
                }
              >
                {Icon.sparkle} Test Signal
              </button>
            </div>
          </div>
        </section>

        <TemplateStudio />

        <section className="hero">
          <div className="hero-label">Manual Order Intake</div>
          <h2 className="hero-title">
            {site?.configured ? "Connected to your site" : "Add custom project or order"}
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

                        {building && order.build?.live ? <BuildProgress build={order.build} compact /> : null}
                        {order.build ? (
                          <Link
                            href={`/build/?id=${encodeURIComponent(order.build.buildId)}`}
                            style={{ color: "var(--accent)", display: "block", marginTop: 8, fontSize: 13 }}
                          >
                            {building
                              ? `Pass ${order.build.iterations || 1} · ${STAGE_LABEL[order.build.stage ?? "starting"] ?? order.build.stage} — follow the build →`
                              : "See how the build went →"}
                          </Link>
                        ) : null}

                        {/* Finished work can be looked at right here, not only downloaded. */}
                        {/* Ready to check: the whole review, open by default; afterwards it stays to hand. */}
                        {!building && order.buildId && order.status === "review" ? (
                          <details open style={{ marginTop: 10 }}>
                            <summary style={{ cursor: "pointer", fontWeight: 700 }}>Review before handover</summary>
                            <ReviewPanel order={order} onChanged={() => Promise.all([orders.refresh(), pipeline.refresh()])} />
                          </details>
                        ) : null}
                        {!building && order.buildId && ["delivered", "maintained"].includes(order.status) ? (
                          <details style={{ marginTop: 10 }}>
                            <summary style={{ cursor: "pointer", fontWeight: 600 }}>Preview what was built</summary>
                            <PreviewPane kind="build" id={order.buildId} height={460} title={`${order.title} preview`} />
                          </details>
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
                          {(order.deliverablePath || ["review", "delivered", "maintained"].includes(order.status)) ? (
                            <button
                              className="btn accent"
                              title="The built site (double-click to open) and its source, as a .zip"
                              disabled={busy}
                              onClick={() => {
                                // Open the tab now, while it still counts as the click; point it at the link once it arrives.
                                const tab = window.open("about:blank", "_blank");
                                void api.downloadPackageUrl(order.id).then(
                                  (url) => {
                                    if (tab) tab.location.href = url;
                                    else window.location.href = url;
                                  },
                                  (error: unknown) => {
                                    tab?.close();
                                    toast(error instanceof Error ? error.message : String(error), "error");
                                  }
                                );
                              }}
                            >
                              {Icon.folder} Download .zip
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

        <OrdersLog />
      </div>
    </>
  );
}
