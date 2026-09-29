"use client";

/**
 * Templates for sale: what the site offers under "Ready to build". Create and
 * edit them here; every change goes to the site straight away. A template can
 * have a source folder with its actual code, and then a customer's build starts
 * from that code instead of from nothing.
 */
import { useState } from "react";

import { api, type Template, type TemplateKind } from "@/lib/api";
import { ProjectBuildList } from "../projects/carry-on";
import { Banner, Busy, Icon, Skeleton, useRemote, useToast } from "../ui";

const KINDS: Array<{ id: TemplateKind; label: string }> = [
  { id: "website", label: "Website" },
  { id: "app", label: "App" },
  { id: "template", label: "Template" }
];

type Draft = {
  name: string;
  kind: TemplateKind;
  category: string;
  icon: string;
  price: string;
  timeframe: string;
  description: string;
  features: string;
  techStack: string;
  keywords: string;
  previewUrl: string;
  sourcePath: string;
  buildNotes: string;
};

const EMPTY: Draft = {
  name: "",
  kind: "website",
  category: "",
  icon: "🧩",
  price: "",
  timeframe: "",
  description: "",
  features: "",
  techStack: "",
  keywords: "",
  previewUrl: "",
  sourcePath: "",
  buildNotes: ""
};

const toDraft = (t: Template): Draft => ({
  name: t.name,
  kind: t.kind,
  category: t.category,
  icon: t.icon,
  price: t.price ? String(t.price) : "",
  timeframe: t.timeframe,
  description: t.description,
  features: t.features.join("\n"),
  techStack: (t.techStack ?? []).join(", "),
  keywords: (t.keywords ?? []).join(", "),
  previewUrl: t.previewUrl ?? "",
  sourcePath: t.sourcePath ?? "",
  buildNotes: t.buildNotes ?? ""
});

const fromDraft = (d: Draft): Partial<Template> & Record<string, unknown> => ({
  name: d.name,
  kind: d.kind,
  category: d.category,
  icon: d.icon,
  price: Number(d.price) || 0,
  currency: "ZAR",
  timeframe: d.timeframe,
  description: d.description,
  features: d.features.split("\n").map((f) => f.trim()).filter(Boolean),
  techStack: d.techStack.split(",").map((f) => f.trim()).filter(Boolean),
  keywords: d.keywords.split(",").map((f) => f.trim()).filter(Boolean),
  previewUrl: d.previewUrl,
  sourcePath: d.sourcePath,
  buildNotes: d.buildNotes
});

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.72)",
  backdropFilter: "blur(6px)",
  zIndex: 999,
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  padding: 16,
  overflowY: "auto"
};

const sheet: React.CSSProperties = {
  maxWidth: 560,
  width: "100%",
  margin: "24px 0",
  boxShadow: "0 24px 50px rgba(0, 0, 0, 0.7)",
  border: "1px solid var(--line-strong)"
};

type Panel =
  | { kind: "edit"; id: string | null; draft: Draft }
  | { kind: "code"; template: Template; instruction: string }
  | { kind: "customer"; template: Template; customerName: string; brief: string };

export function TemplateStudio({ publishedNote }: { publishedNote?: string | null }) {
  const toast = useToast();
  const templates = useRemote(() => api.templates(), 30000);
  const projects = useRemote(() => api.projects(), 0);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [device, setDevice] = useState<"phone" | "desktop">("desktop");

  const all = templates.data?.all ?? [];
  // Whatever you last picked, or the first one: there is always something in the pane.
  const selected = all.find((t) => t.id === selectedId) ?? all[0] ?? null;
  const shown = all.filter((t) => !t.hidden).length;

  const run = async (key: string, ok: string, work: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await work();
      toast(ok, "ok");
      await templates.refresh();
      return true;
    } catch (error) {
      toast(errorText(error), "error");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (panel?.kind !== "edit") return;
    const body = fromDraft(panel.draft);
    const done = await run(
      "save",
      panel.id ? "Saved. The site shows the change on its next refresh." : "Template added and sent to the site.",
      () => (panel.id ? api.updateTemplate(panel.id, body) : api.createTemplate(body))
    );
    if (done) setPanel(null);
  };

  const setDraft = (patch: Partial<Draft>) =>
    setPanel((current) => (current?.kind === "edit" ? { ...current, draft: { ...current.draft, ...patch } } : current));

  return (
    <section style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 10, flexWrap: "wrap" }}>
        <div>
          <div className="hero-label">Sold on arpcloudsolutions.co.za</div>
          <h2 style={{ margin: "2px 0 0", fontSize: 18, fontWeight: 700 }}>
            Templates {templates.data ? `(${shown} on sale${all.length > shown ? `, ${all.length - shown} hidden` : ""})` : ""}
          </h2>
          {publishedNote ? <small style={{ color: "var(--faint)" }}>{publishedNote}</small> : null}
        </div>
        <div className="btn-row">
          <button className="btn accent" onClick={() => setPanel({ kind: "edit", id: null, draft: EMPTY })}>
            {Icon.sparkle} New template
          </button>
          <button
            className="btn"
            disabled={busy !== null}
            onClick={() =>
              run("publish", "Sent to the site.", async () => {
                const res = await api.publishTemplates();
                if (!res.ok) throw new Error(res.message);
              })
            }
          >
            {busy === "publish" ? <Busy label="Sending…" /> : <>{Icon.refresh} Send to site now</>}
          </button>
        </div>
      </div>

      {templates.error ? <Banner kind="error">{templates.error}</Banner> : null}
      {templates.loading ? <Skeleton rows={3} /> : null}

      <div className="template-studio">
      {/* The live preview of whichever template is picked. */}
      {selected ? (
        <aside className="template-pane">
          <div className="preview-bar">
            <strong style={{ fontSize: 14 }}>
              {selected.icon} {selected.name}
            </strong>
            <span className="chips">
              <button className={`chip ${device === "phone" ? "accent" : ""}`} onClick={() => setDevice("phone")}>
                Phone
              </button>
              <button className={`chip ${device === "desktop" ? "accent" : ""}`} onClick={() => setDevice("desktop")}>
                Desktop
              </button>
              {selected.previewUrl ? (
                <a className="chip" href={selected.previewUrl} target="_blank" rel="noreferrer">
                  Open ↗
                </a>
              ) : null}
              <a className="chip" href={`https://arpcloudsolutions.co.za/templates/${selected.id}`} target="_blank" rel="noreferrer">
                On the site ↗
              </a>
            </span>
          </div>
          {selected.previewUrl ? (
            <div className="preview-frame-wrap">
              <iframe
                key={`${selected.id}-${device}`}
                src={selected.previewUrl}
                title={`${selected.name}, live preview`}
                className={`preview-frame ${device}`}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              />
            </div>
          ) : (
            <div className="preview-empty" style={{ margin: 10 }}>
              No preview for this one yet. Templates with code get one when the previews are published (templates/sites/build-previews.mjs).
            </div>
          )}
        </aside>
      ) : null}

      <div className="template-list">
        {all.map((t) => (
          <div
            key={t.id}
            className={`card template-card ${selected?.id === t.id ? "picked" : ""}`}
            style={{ margin: 0, display: "flex", flexDirection: "column", gap: 8, opacity: t.hidden ? 0.55 : 1 }}
            onClick={(event) => {
              // Picking a card previews it; its own buttons still do their own thing.
              if (!(event.target as HTMLElement).closest("button, a")) setSelectedId(t.id);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && event.target === event.currentTarget) setSelectedId(t.id);
            }}
            role="button"
            tabIndex={0}
            aria-pressed={selected?.id === t.id}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <strong style={{ fontSize: 15 }}>
                {t.icon} {t.name}
              </strong>
              <span className="chip">{t.hidden ? "Hidden" : t.kind}</span>
            </div>
            <p style={{ color: "var(--muted)", fontSize: 13, margin: 0, lineHeight: 1.45 }}>{t.description || "No description yet."}</p>
            <small style={{ color: "var(--faint)" }}>
              {t.price ? `From R${t.price.toLocaleString("en-ZA")}` : "No price"}
              {t.timeframe ? ` · ${t.timeframe}` : ""}
            </small>
            <small style={{ color: t.sourcePath ? "var(--good)" : "var(--faint)", wordBreak: "break-all" }}>
              {t.sourcePath ? `Code: ${t.sourcePath}` : "No code yet: customer builds start from the description"}
            </small>
            <div className="btn-row" style={{ marginTop: "auto" }}>
              <button className="btn small" onClick={() => setPanel({ kind: "edit", id: t.id, draft: toDraft(t) })}>
                Edit
              </button>
              <button className="btn small" onClick={() => setPanel({ kind: "code", template: t, instruction: "" })}>
                {t.sourcePath ? "Change the code" : "Build the code"}
              </button>
              <button className="btn small" onClick={() => setPanel({ kind: "customer", template: t, customerName: "", brief: "" })}>
                Build for a customer
              </button>
              <button
                className="btn small"
                disabled={busy !== null}
                onClick={() =>
                  run(t.id, t.hidden ? "Back on sale." : "Hidden from the site.", () => api.updateTemplate(t.id, { hidden: !t.hidden }))
                }
              >
                {t.hidden ? "Show on site" : "Hide"}
              </button>
              {!t.builtIn ? (
                <button
                  className="btn small"
                  disabled={busy !== null}
                  onClick={() => {
                    if (window.confirm(`Delete "${t.name}"? Its code folder is not touched.`)) {
                      void run(t.id, "Deleted.", () => api.deleteTemplate(t.id));
                    }
                  }}
                >
                  Delete
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      </div>

      {panel?.kind === "edit" ? (
        <div style={overlay} onClick={(event) => event.target === event.currentTarget && setPanel(null)}>
          <div className="card" style={sheet}>
            <h3 style={{ margin: "0 0 12px", fontSize: 17 }}>{panel.id ? `Edit ${panel.draft.name}` : "New template"}</h3>
            <div style={{ display: "grid", gap: 10 }}>
              <label className="field">
                <span>Name (what customers see)</span>
                <input value={panel.draft.name} onChange={(e) => setDraft({ name: e.target.value })} placeholder="e.g. Salon Booking Site" />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 80px", gap: 10 }}>
                <label className="field">
                  <span>Kind</span>
                  <select value={panel.draft.kind} onChange={(e) => setDraft({ kind: e.target.value as TemplateKind })}>
                    {KINDS.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Category</span>
                  <input value={panel.draft.category} onChange={(e) => setDraft({ category: e.target.value })} placeholder="e.g. Beauty" />
                </label>
                <label className="field">
                  <span>Icon</span>
                  <input value={panel.draft.icon} onChange={(e) => setDraft({ icon: e.target.value })} />
                </label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label className="field">
                  <span>Price from (R)</span>
                  <input inputMode="numeric" value={panel.draft.price} onChange={(e) => setDraft({ price: e.target.value.replace(/[^0-9]/g, "") })} />
                </label>
                <label className="field">
                  <span>Timeframe</span>
                  <input value={panel.draft.timeframe} onChange={(e) => setDraft({ timeframe: e.target.value })} placeholder="e.g. 1-2 weeks" />
                </label>
              </div>
              <label className="field">
                <span>Description</span>
                <textarea rows={3} value={panel.draft.description} onChange={(e) => setDraft({ description: e.target.value })} />
              </label>
              <label className="field">
                <span>What it includes (one per line)</span>
                <textarea rows={4} value={panel.draft.features} onChange={(e) => setDraft({ features: e.target.value })} />
              </label>
              <label className="field">
                <span>Built with (comma separated, optional)</span>
                <input value={panel.draft.techStack} onChange={(e) => setDraft({ techStack: e.target.value })} placeholder="Next.js, Tailwind" />
              </label>
              <label className="field">
                <span>Words customers might use (comma separated, for matching payments)</span>
                <input value={panel.draft.keywords} onChange={(e) => setDraft({ keywords: e.target.value })} placeholder="salon, hair, booking" />
              </label>
              <label className="field">
                <span>Example link (optional)</span>
                <input value={panel.draft.previewUrl} onChange={(e) => setDraft({ previewUrl: e.target.value })} placeholder="https://…" />
              </label>
              <label className="field">
                <span>Source folder: the template's code on the PC (optional)</span>
                <input
                  list="template-source-folders"
                  value={panel.draft.sourcePath}
                  onChange={(e) => setDraft({ sourcePath: e.target.value })}
                  placeholder="Pick a project, or leave empty"
                />
                <datalist id="template-source-folders">
                  {(projects.data?.projects ?? []).map((p) => (
                    <option key={p.id} value={p.path}>
                      {p.name}
                    </option>
                  ))}
                </datalist>
              </label>
              <label className="field">
                <span>Notes for the builder (never shown on the site)</span>
                <textarea rows={2} value={panel.draft.buildNotes} onChange={(e) => setDraft({ buildNotes: e.target.value })} />
              </label>
            </div>
            <div className="btn-row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
              <button className="btn" onClick={() => setPanel(null)} disabled={busy === "save"}>
                Cancel
              </button>
              <button className="btn primary" onClick={save} disabled={busy === "save" || !panel.draft.name.trim()}>
                {busy === "save" ? <Busy label="Saving…" /> : panel.id ? "Save" : "Add template"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {panel?.kind === "code" ? (
        <div style={overlay} onClick={(event) => event.target === event.currentTarget && setPanel(null)}>
          <div className="card" style={sheet}>
            <h3 style={{ margin: "0 0 8px", fontSize: 17 }}>
              {panel.template.sourcePath ? "Change" : "Build"} the code: {panel.template.name}
            </h3>
            <p className="hint">
              {panel.template.sourcePath
                ? "It works on a copy of the template's code. Look at what it did below, then apply it to the template."
                : "It builds the template from its description. When it finishes, that build becomes the template's code, and customer builds start from it."}
            </p>
            <textarea
              rows={3}
              value={panel.instruction}
              onChange={(e) => setPanel({ ...panel, instruction: e.target.value })}
              placeholder={
                panel.template.sourcePath ? "e.g. Add a gallery page and make the header sticky" : "Anything extra it should do (optional)"
              }
            />
            <div className="btn-row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
              <button className="btn" onClick={() => setPanel(null)}>
                Close
              </button>
              <button
                className="btn primary"
                disabled={busy !== null || (Boolean(panel.template.sourcePath) && panel.instruction.trim().length < 3)}
                onClick={async () => {
                  setBusy("code");
                  try {
                    const res = await api.developTemplate(panel.template.id, panel.instruction.trim() || undefined);
                    toast(res.message, "ok");
                    setPanel({ ...panel, instruction: "" });
                    await templates.refresh();
                  } catch (error) {
                    toast(errorText(error), "error");
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {busy === "code" ? <Busy label="Starting…" /> : <>{Icon.sparkle} Start</>}
              </button>
            </div>
            {panel.template.sourcePath ? (
              <ProjectBuildList projectId={`template:${panel.template.id}`} refreshKey={all.length + (busy ? 1 : 0)} />
            ) : panel.template.developing ? (
              <small style={{ color: "var(--muted)", display: "block", marginTop: 10 }}>
                Build {panel.template.developing} is working on it. Follow it under Build.
              </small>
            ) : null}
          </div>
        </div>
      ) : null}

      {panel?.kind === "customer" ? (
        <div style={overlay} onClick={(event) => event.target === event.currentTarget && setPanel(null)}>
          <div className="card" style={sheet}>
            <h3 style={{ margin: "0 0 8px", fontSize: 17 }}>Build {panel.template.name} for a customer</h3>
            <p className="hint">
              Makes an order and starts building it now
              {panel.template.sourcePath ? ", starting from the template's code" : ""}. It shows under Orders like any other.
            </p>
            <label className="field">
              <span>Customer or project name</span>
              <input value={panel.customerName} onChange={(e) => setPanel({ ...panel, customerName: e.target.value })} />
            </label>
            <label className="field" style={{ marginTop: 10 }}>
              <span>What they want (optional)</span>
              <textarea rows={3} value={panel.brief} onChange={(e) => setPanel({ ...panel, brief: e.target.value })} />
            </label>
            <div className="btn-row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
              <button className="btn" onClick={() => setPanel(null)}>
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={busy !== null}
                onClick={async () => {
                  const done = await run("customer", "Build started. Follow it under Orders.", () =>
                    api.buildTemplate(panel.template.id, {
                      customerName: panel.customerName.trim() || undefined,
                      customBrief: panel.brief.trim() || undefined
                    })
                  );
                  if (done) setPanel(null);
                }}
              >
                {busy === "customer" ? <Busy label="Starting…" /> : <>{Icon.sparkle} Start build</>}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
