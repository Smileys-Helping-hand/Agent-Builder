"use client";

/**
 * Jarvis's library: everything he asked the builder to make, newest first,
 * with what came of it. A build shows its score and opens on its own screen;
 * a drawing shows its pictures; a MediaGen request its image or video; a
 * research topic its findings; a template idea its practice.
 */
import Link from "next/link";
import { useState } from "react";

import { api, type LibraryItem, type LibraryKind } from "@/lib/api";
import { Header, Icon, NotConnected, Skeleton, ago, useConnected, useRemote, useToast } from "../ui";

const KIND: Record<LibraryKind, { label: string; icon: React.ReactNode }> = {
  build: { label: "Builds", icon: Icon.code },
  app: { label: "Apps", icon: Icon.download },
  picture: { label: "Pictures", icon: Icon.image },
  media: { label: "Media", icon: Icon.sparkle },
  research: { label: "Research", icon: Icon.flask },
  template: { label: "Templates", icon: Icon.book },
  project: { label: "Projects", icon: Icon.folder }
};

const STATE: Record<LibraryItem["state"], { label: string; tone: string }> = {
  working: { label: "In progress", tone: "accent" },
  done: { label: "Done", tone: "" },
  failed: { label: "Did not work", tone: "warn" },
  gone: { label: "Gone", tone: "warn" }
};

function Entry({ item, onRemoved }: { item: LibraryItem; onRemoved: () => void }) {
  const toast = useToast();
  const state = STATE[item.state];
  const remove = async () => {
    try {
      await api.libraryRemove(item.id);
      onRemoved();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <article className="card library-card">
      <div className="library-head">
        <span className="library-icon" aria-hidden="true">
          {KIND[item.kind].icon}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 className="library-title">{item.title}</h3>
          <p className="muted small" style={{ margin: "2px 0 0" }}>
            {KIND[item.kind].label.replace(/s$/, "")} · asked {ago(item.at)}
          </p>
        </div>
        <span className={`chip ${state.tone}`}>{state.label}</span>
      </div>

      {item.request && item.request !== item.title ? <blockquote className="library-request">{item.request}</blockquote> : null}

      {item.pictures.length > 0 ? (
        <div className="library-pictures">
          {item.pictures.map((picture) => (
            <a key={picture.id} href={api.artUrl(picture.path)} target="_blank" rel="noreferrer" title={picture.name}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={api.artUrl(picture.path)} alt={picture.name} loading="lazy" />
            </a>
          ))}
        </div>
      ) : null}

      {item.media ? (
        item.media.type === "video" ? (
          <video className="library-media" src={item.media.url} controls playsInline preload="metadata" />
        ) : (
          <a href={item.media.url} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="library-media" src={item.media.url} alt={item.title} loading="lazy" />
          </a>
        )
      ) : null}

      {item.detail ? <p className="small" style={{ margin: "8px 0 0" }}>{item.detail}</p> : null}

      <div className="btn-row" style={{ marginTop: 10 }}>
        {item.open ? (
          <Link className="btn small primary" href={item.open}>
            {Icon.eye} Open
          </Link>
        ) : null}
        {item.id > 0 ? (
          <button className="btn small ghost" onClick={remove} aria-label={`Take ${item.title} off the list`}>
            {Icon.trash} Hide
          </button>
        ) : null}
      </div>
    </article>
  );
}

export default function Library() {
  const connected = useConnected();
  const [kind, setKind] = useState<LibraryKind | "all">("all");
  const library = useRemote(() => api.library(), 15000, "library");

  if (connected === false) return <NotConnected />;
  const data = library.data;
  const items = (data?.items ?? []).filter((item) => kind === "all" || item.kind === kind);
  const kinds = (Object.keys(KIND) as LibraryKind[]).filter((k) => (data?.counts[k] ?? 0) > 0);
  const working = (data?.items ?? []).filter((item) => item.state === "working").length;

  return (
    <>
      <Header title="Jarvis's library" sub="What Jarvis asked the builder to make, and how it turned out" state={working ? "busy" : "up"} />
      <div className="wrap">
        {kinds.length > 1 ? (
          <div className="filters" role="tablist" aria-label="Show">
            <button className={kind === "all" ? "on" : ""} onClick={() => setKind("all")}>
              All {data?.items.length ?? 0}
            </button>
            {kinds.map((k) => (
              <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>
                {KIND[k].label} {data?.counts[k]}
              </button>
            ))}
          </div>
        ) : null}

        {!data && library.loading ? <Skeleton rows={3} /> : null}
        {data && items.length === 0 ? (
          <section className="card">
            <h2>Nothing here yet</h2>
            <p className="hint">When Jarvis asks the builder for something (a site, an app, a picture, a video, some research), it shows up here with the result.</p>
          </section>
        ) : null}
        {items.map((item) => (
          <Entry key={`${item.id}-${item.refs[0] ?? ""}`} item={item} onRemoved={() => library.refresh()} />
        ))}
      </div>
    </>
  );
}
