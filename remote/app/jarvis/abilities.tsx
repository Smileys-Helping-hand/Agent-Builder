"use client";

/**
 * Everything Jarvis can do on this machine, read from the bridge he uses
 * (GET /api/agent-builder/bridge): builds from a prompt to a passing app, the
 * phone and PC apps, art and sprites, MediaGen, projects, research, orders,
 * the model and the machine. What needs his key's "execute" scope says so.
 */
import { api, type BridgeAction } from "@/lib/api";
import { Banner, Skeleton, useRemote } from "../ui";

const AREAS: Array<{ id: string; title: string }> = [
  { id: "builds", title: "Build and fix from a prompt" },
  { id: "apps", title: "Phone and PC apps" },
  { id: "art", title: "Art and sprites" },
  { id: "media", title: "MediaGen images and video" },
  { id: "projects", title: "Projects on this PC" },
  { id: "research", title: "Research" },
  { id: "orders", title: "Customer orders" },
  { id: "model", title: "The model and settings" },
  { id: "machine", title: "The machine" }
];

export function JarvisAbilities({ scopes }: { scopes: string[] }) {
  const catalogue = useRemote(() => api.bridgeCatalogue(), 0);
  const actions = catalogue.data?.actions ?? [];
  const byArea = (area: string): BridgeAction[] => actions.filter((action) => action.area === area);
  const canExecute = scopes.includes("execute");

  return (
    <>
      <div className="section-title">What Jarvis can do here ({actions.length ? actions.length + 1 : "…"} actions)</div>
      <div className="card">
        <p className="hint">
          Through his bridge, as <code>{"{ eventType: \"<action>\", metadata: { …params } }"}</code>. Each is a call into this builder made
          with his key, so it can do nothing his key could not. <code>api</code> reaches any other route except keys and accounts.
        </p>
        {!canExecute && scopes.length ? (
          <Banner kind="info">His key reads and writes but cannot execute: builds, repairs, drawing and app-making need the execute scope. Issue his key again to give it.</Banner>
        ) : null}
        {catalogue.loading && !catalogue.data ? <Skeleton rows={3} /> : null}
        {catalogue.error && !catalogue.data ? <Banner kind="error">{catalogue.error}</Banner> : null}
        <div className="abilities">
          {AREAS.map((area) => {
            const list = byArea(area.id);
            if (list.length === 0) return null;
            return (
              <div key={area.id}>
                <h3>{area.title}</h3>
                <ul>
                  {list.map((action) => (
                    <li key={action.name} title={Object.entries(action.params).map(([name, what]) => `${name}: ${what}`).join("\n")}>
                      <code>{action.name}</code>
                      <span>
                        {action.label}
                        {action.scope === "execute" ? <small className="muted"> · execute</small> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
