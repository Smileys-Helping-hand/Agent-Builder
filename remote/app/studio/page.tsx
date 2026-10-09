"use client";

/**
 * The Studio: pictures for apps and games, made on the PC.
 *
 * Create (describe it, pick a kind and a look, draw one or a few variations)
 * and watch it draw live; keep everything in a library to search, rename,
 * tag, edit ("make the roof blue"), and reuse — downloaded as PNG, JPG, WebP
 * or ICO at any size, packed as a game asset pack, cut into a sprite sheet,
 * dropped straight into a build, or turned into a short video with MediaGen.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, type ArtItem, type ArtJob, type ArtKind, type ArtStatus, type Build, type MediaGenJob } from "@/lib/api";
import { Banner, Busy, Header, Icon, NotConnected, Skeleton, useConnected, usePersistentState, useRemote, useToast } from "../ui";

const KINDS: { id: ArtKind; label: string; hint: string }[] = [
  { id: "sprite", label: "Sprite", hint: "One object, background cut out: characters, buildings, items" },
  { id: "background", label: "Background", hint: "A wide scene, kept whole" },
  { id: "icon", label: "Icon", hint: "A small square symbol, cut out" },
  { id: "ui", label: "UI piece", hint: "A button, panel or badge, cut out" }
];

const LOOKS = [
  "stylized mobile game art, vibrant colours, soft lighting",
  "pixel art, 16-bit, crisp edges",
  "flat vector illustration, bold shapes",
  "hand-painted fantasy, warm light",
  "realistic 3D render, studio lighting",
  "top-down view from directly above, clean shapes",
  "cute chibi cartoon, thick outlines"
];

const STARTERS = [
  { label: "Game hero", subject: "a brave knight in silver armour with a sword, full body", kind: "sprite" as ArtKind },
  { label: "Building", subject: "a medieval stone barracks with a red roof and banners", kind: "sprite" as ArtKind },
  { label: "Car (top-down)", subject: "a red sports car seen from directly above, facing right", kind: "sprite" as ArtKind },
  { label: "Item", subject: "a glowing blue health potion in a round glass bottle", kind: "icon" as ArtKind },
  { label: "Background", subject: "a lush fantasy valley with a river and distant mountains", kind: "background" as ArtKind },
  { label: "App icon", subject: "a rounded square app icon with a golden crown", kind: "icon" as ArtKind }
];

type Format = "png" | "jpg" | "webp" | "ico";

const RECOLOUR = /\b(?:red|orange|yellow|green|blue|purple|violet|pink|brown|black|white|grey|gray|silver|gold|golden|teal|cyan|magenta|crimson|navy)\b/i;

/** Load a library picture into a canvas at a size (keeping its shape inside the square). */
const toCanvas = async (link: string, size: number | null): Promise<HTMLCanvasElement> => {
  const url = URL.createObjectURL(await api.artBlob(link));
  return new Promise<HTMLCanvasElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const scale = size ? Math.min(size / image.naturalWidth, size / image.naturalHeight) : 1;
      const canvas = document.createElement("canvas");
      canvas.width = size ?? image.naturalWidth;
      canvas.height = size ?? image.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      const w = image.naturalWidth * scale;
      const h = image.naturalHeight * scale;
      ctx.drawImage(image, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
      resolve(canvas);
    };
    image.onerror = () => reject(new Error("Could not load the picture."));
    image.src = url;
  }).finally(() => URL.revokeObjectURL(url));
};

const blobOf = (canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> =>
  new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not convert it."))), type, quality));

/** An .ico holding PNGs at the given sizes (every modern system reads PNG-in-ICO). */
const icoOf = async (url: string, sizes: number[]): Promise<Blob> => {
  const pngs = await Promise.all(sizes.map(async (size) => new Uint8Array(await (await blobOf(await toCanvas(url, size), "image/png")).arrayBuffer())));
  const header = new DataView(new ArrayBuffer(6 + 16 * sizes.length));
  header.setUint16(2, 1, true);
  header.setUint16(4, sizes.length, true);
  let offset = 6 + 16 * sizes.length;
  sizes.forEach((size, i) => {
    const at = 6 + i * 16;
    header.setUint8(at, size >= 256 ? 0 : size);
    header.setUint8(at + 1, size >= 256 ? 0 : size);
    header.setUint16(at + 4, 1, true);
    header.setUint16(at + 6, 32, true);
    header.setUint32(at + 8, pngs[i].length, true);
    header.setUint32(at + 12, offset, true);
    offset += pngs[i].length;
  });
  return new Blob([header.buffer, ...pngs], { type: "image/x-icon" });
};

const save = (blob: Blob, name: string) => {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 4000);
};

/** One picture in the format and size asked for. */
const downloadAs = async (item: ArtItem, format: Format, size: number | null) => {
  const url = item.url ?? "";
  if (format === "png" && !size) return save(await api.artBlob(url), `${item.name}.png`);
  if (format === "ico") return save(await icoOf(url, [16, 32, 48, 64, 128, 256]), `${item.name}.ico`);
  const canvas = await toCanvas(url, size);
  if (format === "jpg") {
    // JPEG has no transparency: put it on white.
    const flat = document.createElement("canvas");
    flat.width = canvas.width;
    flat.height = canvas.height;
    const ctx = flat.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, flat.width, flat.height);
    ctx.drawImage(canvas, 0, 0);
    return save(await blobOf(flat, "image/jpeg", 0.92), `${item.name}${size ? `-${size}` : ""}.jpg`);
  }
  save(await blobOf(canvas, format === "webp" ? "image/webp" : "image/png", 0.92), `${item.name}${size ? `-${size}` : ""}.${format}`);
};

/** The chosen pictures in one image, side by side, with an atlas saying where each is. */
const spriteSheet = async (items: ArtItem[], cell: number) => {
  const columns = Math.ceil(Math.sqrt(items.length));
  const rows = Math.ceil(items.length / columns);
  const sheet = document.createElement("canvas");
  sheet.width = columns * cell;
  sheet.height = rows * cell;
  const ctx = sheet.getContext("2d")!;
  const frames: Record<string, { x: number; y: number; w: number; h: number }> = {};
  for (const [i, item] of items.entries()) {
    const x = (i % columns) * cell;
    const y = Math.floor(i / columns) * cell;
    ctx.drawImage(await toCanvas(item.url ?? "", cell), x, y);
    frames[item.name] = { x, y, w: cell, h: cell };
  }
  save(await blobOf(sheet, "image/png"), "sprite-sheet.png");
  save(new Blob([JSON.stringify({ image: "sprite-sheet.png", size: { w: sheet.width, h: sheet.height }, frames }, null, 2)], { type: "application/json" }), "sprite-sheet.json");
};

/** The library, searched as you type (the newest answer wins). */
const useLibrary = (q: string, kind: ArtKind | "", connected: boolean | null) => {
  const [data, setData] = useState<{ items: ArtItem[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const latest = useRef(0);
  useEffect(() => {
    if (!connected) return;
    const ticket = ++latest.current;
    const timer = setTimeout(() => {
      setLoading(true);
      api
        .artLibrary(q, kind)
        .then((result) => ticket === latest.current && (setData(result), setError(null)))
        .catch((e) => ticket === latest.current && setError(e instanceof Error ? e.message : String(e)))
        .finally(() => ticket === latest.current && setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [q, kind, connected, nonce]);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, refresh };
};

/** A picture being drawn: progress, and the engine's preview frames as they come. */
const LiveJob = ({ job, onDone }: { job: ArtJob; onDone: (job: ArtJob) => void }) => {
  const [current, setCurrent] = useState(job);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let last: string | null = null;
    const tick = async () => {
      while (alive) {
        const next = await api.artJob(job.id).catch(() => null);
        if (!alive) return;
        if (next) {
          setCurrent(next);
          if (next.hasPreview && next.state === "drawing") {
            const url = await api.artPreview(job.id);
            if (url && alive) {
              if (last) URL.revokeObjectURL(last);
              last = url;
              setPreview(url);
            }
          }
          if (next.state === "done" || next.state === "failed") {
            onDone(next);
            return;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
    };
    void tick();
    return () => {
      alive = false;
      if (last) URL.revokeObjectURL(last);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one loop per job
  }, [job.id]);
  const share = current.progress.max ? Math.min(1, current.progress.value / current.progress.max) : 0;
  return (
    <div className="card studio-live">
      <div className="studio-live-frame">
        {preview ? <img src={preview} alt="Drawing in progress" /> : <span className="muted">{current.state === "queued" ? "Waiting its turn…" : "Starting…"}</span>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>{current.request.edit ? `Editing: ${current.request.edit}` : current.request.subject}</strong>
        <div className="studio-bar">
          <span style={{ width: `${Math.round(share * 100)}%` }} />
        </div>
        <span className="muted small">
          {current.state === "failed" ? `Failed: ${current.error}` : current.state === "queued" ? "Queued" : `Step ${current.progress.value} of ${current.progress.max}`}
        </span>
      </div>
    </div>
  );
};

export default function Studio() {
  const connected = useConnected();
  const toast = useToast();
  const status = useRemote(() => api.artStatus(), 15000, "studio.status");
  const [subject, setSubject] = usePersistentState("studio-subject", "");
  const [name, setName] = useState("");
  const [kind, setKind] = usePersistentState<ArtKind>("studio-kind", "sprite");
  const [style, setStyle] = usePersistentState("studio-style", LOOKS[0]);
  const [count, setCount] = usePersistentState("studio-count", 1);
  const [seed, setSeed] = useState("");
  const [live, setLive] = useState<ArtJob[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<ArtKind | "">("");
  const library = useLibrary(q, filter, connected);
  const [chosen, setChosen] = useState<string[]>([]);
  const [open, setOpen] = useState<ArtItem | null>(null);
  const [busy, setBusy] = useState(false);

  // Jobs started elsewhere (Jarvis, another device) show up live too.
  useEffect(() => {
    if (!connected) return;
    void api.artJobs().then(({ jobs }) => setLive((now) => [...now, ...jobs.filter((j) => (j.state === "queued" || j.state === "drawing") && !now.some((n) => n.id === j.id))]))
      .catch(() => undefined);
  }, [connected]);

  const draw = async () => {
    if (!subject.trim()) return toast("Say what to draw first.");
    setBusy(true);
    try {
      const { jobs } = await api.artDraw({ subject, name: name || undefined, kind, style, count, seed: seed ? Number(seed) : undefined });
      setLive((now) => [...jobs, ...now]);
      toast(jobs.length > 1 ? `Drawing ${jobs.length} variations…` : "Drawing…");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const finished = useCallback(
    (job: ArtJob) => {
      setLive((now) => now.filter((j) => j.id !== job.id));
      if (job.state === "done") {
        toast(`Ready: ${job.item?.name}`);
        library.refresh();
      } else toast(`Could not draw it: ${job.error}`);
    },
    [library.refresh, toast]
  );

  const items = library.data?.items ?? [];
  const selected = useMemo(() => items.filter((item) => chosen.includes(item.id)), [items, chosen]);

  if (connected === false) return <NotConnected />;
  const engine = status.data?.engine;
  const mediagen = status.data?.mediagen;

  return (
    <>
      <Header title="Media Studio" sub="Pictures for your apps and games, made on your PC" state={engine === "ready" ? "up" : engine === "offline" ? "warn" : undefined} />
      <div className="wrap">
        {engine === "offline" ? <Banner kind="info">The image engine (ComfyUI) is not running on the PC. Start it, and drawing works here.</Banner> : null}

        <section className="card">
          <h2>Create</h2>
          <p className="hint">Describe one thing; pick what kind of picture it is and the look. Sprites come out with the background removed.</p>
          <div className="chips" style={{ marginBottom: 8 }}>
            {STARTERS.map((s) => (
              <button
                key={s.label}
                className="chip"
                onClick={() => {
                  setSubject(s.subject);
                  setKind(s.kind);
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
          <label className="field">
            <span>What to draw</span>
            <textarea rows={3} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="a friendly dragon pet with green scales, full body" />
          </label>
          <div className="studio-row">
            <label className="field">
              <span>Kind</span>
              <select value={kind} onChange={(e) => setKind(e.target.value as ArtKind)}>
                {KINDS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Name (optional)</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="dragon" />
            </label>
            <label className="field">
              <span>How many</span>
              <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? "1 picture" : `${n} variations`}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Seed (optional)</span>
              <input value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ""))} placeholder="random" inputMode="numeric" />
            </label>
          </div>
          <label className="field">
            <span>Look</span>
            <input value={style} onChange={(e) => setStyle(e.target.value)} list="studio-looks" />
            <datalist id="studio-looks">
              {LOOKS.map((look) => (
                <option key={look} value={look} />
              ))}
            </datalist>
          </label>
          <p className="muted small">{KINDS.find((k) => k.id === kind)?.hint}</p>
          <div className="btn-row">
            <button className="btn primary" disabled={busy || engine === "offline"} onClick={draw}>
              {busy ? <Busy label="Starting…" /> : <>{Icon.sparkle} Draw</>}
            </button>
          </div>
        </section>

        {live.length > 0 ? (
          <section>
            <h3 className="section-title">Drawing now</h3>
            {live.map((job) => (
              <LiveJob key={job.id} job={job} onDone={finished} />
            ))}
          </section>
        ) : null}

        <section className="card">
          <h2>Library</h2>
          <div className="studio-row">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search names, prompts, tags" aria-label="Search the library" />
            <select value={filter} onChange={(e) => setFilter(e.target.value as ArtKind | "")} aria-label="Kind">
              <option value="">All kinds</option>
              {KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>
          {chosen.length > 0 ? (
            <div className="btn-row" style={{ margin: "10px 0" }}>
              <span className="muted small">{chosen.length} chosen</span>
              <button
                className="btn small"
                onClick={async () => {
                  try {
                    window.location.href = await api.artPackUrl(chosen);
                  } catch (error) {
                    toast(error instanceof Error ? error.message : String(error));
                  }
                }}
              >
                {Icon.download} Asset pack (.zip)
              </button>
              <button className="btn small" onClick={() => spriteSheet(selected, 256).catch((e) => toast(String(e)))}>
                {Icon.download} Sprite sheet
              </button>
              <UseInBuild ids={chosen} />
              <button className="btn small ghost" onClick={() => setChosen([])}>
                Clear
              </button>
            </div>
          ) : null}
          {library.error ? <Banner kind="error">{library.error}</Banner> : null}
          {library.loading && !library.data ? <Skeleton rows={2} /> : null}
          {items.length === 0 && library.data ? <p className="muted">Nothing here yet. Draw something above.</p> : null}
          <div className="studio-grid">
            {items.map((item) => (
              <figure key={item.id} className={`studio-tile ${chosen.includes(item.id) ? "chosen" : ""}`}>
                <button className="studio-thumb" onClick={() => setOpen(item)} aria-label={`Open ${item.name}`}>
                  <img src={api.artUrl(item.url ?? "")} alt={item.subject} loading="lazy" />
                </button>
                <figcaption>
                  <label>
                    <input type="checkbox" checked={chosen.includes(item.id)} onChange={(e) => setChosen((now) => (e.target.checked ? [...now, item.id] : now.filter((id) => id !== item.id)))} />
                    {item.name}
                  </label>
                  <span className="muted small">{item.kind}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        {mediagen?.configured ? <MediaGenPanel status={mediagen} onImported={() => library.refresh()} /> : (
          <section className="card">
            <h2>MediaGen</h2>
            <p className="hint">
              Connect your MediaGen app for short video from any picture and its cloud gallery: set MEDIAGEN_URL and MEDIAGEN_API_KEY in the builder&apos;s .env (and MEDIA_API_KEY on MediaGen).
            </p>
          </section>
        )}
      </div>
      {open ? <Detail item={open} onClose={() => setOpen(null)} onChanged={() => library.refresh()} onJob={(job) => setLive((now) => [job, ...now])} mediagen={Boolean(mediagen?.configured)} /> : null}
    </>
  );
}

/** Put the chosen pictures into a build's public/assets, where its game draws them. */
const UseInBuild = ({ ids }: { ids: string[] }) => {
  const toast = useToast();
  const builds = useRemote(() => api.builds(), 0, "studio.builds");
  const [buildId, setBuildId] = useState("");
  const list: Build[] = builds.data?.builds ?? [];
  return (
    <span className="btn-row" style={{ gap: 6 }}>
      <select value={buildId} onChange={(e) => setBuildId(e.target.value)} aria-label="Build to use them in" style={{ maxWidth: 200 }}>
        <option value="">Use in a build…</option>
        {list.slice(0, 30).map((b) => (
          <option key={b.buildId} value={b.buildId}>
            {b.projectName}
          </option>
        ))}
      </select>
      <button
        className="btn small"
        disabled={!buildId}
        onClick={async () => {
          try {
            const res = await api.artUse(buildId, ids);
            toast(res.added.length ? `Added ${res.added.join(", ")}. ${res.note}` : res.note);
          } catch (error) {
            toast(error instanceof Error ? error.message : String(error));
          }
        }}
      >
        Add
      </button>
    </span>
  );
};

/** One picture: look at it, change it, download it, reuse it. */
const Detail = ({ item, onClose, onChanged, onJob, mediagen }: { item: ArtItem; onClose: () => void; onChanged: () => void; onJob: (job: ArtJob) => void; mediagen: boolean }) => {
  const toast = useToast();
  const [change, setChange] = useState("");
  const [strength, setStrength] = useState(0.65);
  const [strengthSet, setStrengthSet] = useState(false);
  const [format, setFormat] = useState<Format>("png");
  const [size, setSize] = useState<number | null>(null);
  const [newName, setNewName] = useState(item.name);
  const [tags, setTags] = useState(item.tags.join(", "));
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    dialog.current?.focus();
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  const act = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) toast(done);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <div className="studio-modal" role="dialog" aria-modal="true" aria-label={item.name} onClick={onClose}>
      <div className="card studio-detail" ref={dialog} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <div className="btn-row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>{item.name}</h2>
          <button className="btn small ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="studio-detail-body">
          <div className="studio-checker">
            <img src={api.artUrl(item.url ?? "")} alt={item.subject} />
          </div>
          <div style={{ minWidth: 0 }}>
            <p className="muted small" style={{ overflowWrap: "anywhere" }}>
              {item.subject}
              {item.edit ? ` · edited: ${item.edit}` : ""}
              <br />
              {item.kind} · seed {item.seed} · {(item.bytes / 1024).toFixed(0)} KB · {new Date(item.createdAt).toLocaleString()}
            </p>

            <h3 className="section-title">Change it</h3>
            <label className="field">
              <span>What to change</span>
              <input
                value={change}
                onChange={(e) => {
                  setChange(e.target.value);
                  // A colour change comes out best redrawn from the description; the rest stays close.
                  if (!strengthSet) setStrength(RECOLOUR.test(e.target.value) && !/^\s*add\b/i.test(e.target.value) ? 1 : 0.65);
                }}
                placeholder="make the roof blue, add snow"
              />
            </label>
            <label className="field">
              <span>
                How much: {strength >= 0.95 ? "redraw from the description, same look (best for colours)" : strength < 0.4 ? "a touch" : strength < 0.7 ? "clearly" : "nearly new"}
              </span>
              <input
                type="range"
                min={0.2}
                max={1}
                step={0.05}
                value={strength}
                onChange={(e) => {
                  setStrengthSet(true);
                  setStrength(Number(e.target.value));
                }}
              />
            </label>
            <div className="btn-row">
              <button
                className="btn small primary"
                disabled={!change.trim()}
                onClick={() =>
                  act(async () => {
                    const { job } = await api.artEdit(item.id, change, strength);
                    onJob(job);
                    onClose();
                  })
                }
              >
                {Icon.sparkle} Edit
              </button>
              <button
                className="btn small"
                onClick={() =>
                  act(async () => {
                    const { jobs } = await api.artDraw({ subject: item.subject, name: item.name, kind: item.kind, style: item.style, count: 2 });
                    jobs.forEach(onJob);
                    onClose();
                  })
                }
              >
                Two more like it
              </button>
              {mediagen ? (
                <button className="btn small" onClick={() => act(async () => api.mediagenQueue({ type: "video_short", fromId: item.id, prompt: item.subject }), "Video queued on MediaGen; it appears in its gallery below.")}>
                  {Icon.play} Make a video
                </button>
              ) : null}
            </div>

            <h3 className="section-title">Download</h3>
            <div className="btn-row">
              <select value={format} onChange={(e) => setFormat(e.target.value as Format)} aria-label="Format">
                <option value="png">PNG (transparent)</option>
                <option value="webp">WebP (small, transparent)</option>
                <option value="jpg">JPG (white background)</option>
                <option value="ico">ICO (app / site icon)</option>
              </select>
              {format !== "ico" ? (
                <select value={size ?? ""} onChange={(e) => setSize(e.target.value ? Number(e.target.value) : null)} aria-label="Size">
                  <option value="">Original size</option>
                  {[64, 128, 256, 512, 1024].map((s) => (
                    <option key={s} value={s}>
                      {s} × {s}
                    </option>
                  ))}
                </select>
              ) : null}
              <button className="btn small" onClick={() => act(() => downloadAs(item, format, size))}>
                {Icon.download} Download
              </button>
            </div>

            <h3 className="section-title">Name and tags</h3>
            <div className="btn-row">
              <input value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="Name" style={{ maxWidth: 160 }} />
              <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tags, comma separated" aria-label="Tags" />
              <button
                className="btn small"
                onClick={() =>
                  act(async () => {
                    await api.artUpdate(item.id, { name: newName, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) });
                    onChanged();
                  }, "Saved.")
                }
              >
                Save
              </button>
            </div>
            <div className="btn-row" style={{ marginTop: 14 }}>
              <button
                className="btn small ghost danger"
                onClick={() =>
                  act(async () => {
                    if (!window.confirm(`Delete ${item.name}? This cannot be undone.`)) return;
                    await api.artDelete(item.id);
                    onChanged();
                    onClose();
                  })
                }
              >
                {Icon.trash} Delete
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/** The owner's MediaGen gallery: images to bring into the library, videos to watch and download. */
const MediaGenPanel = ({ onImported, status }: { onImported: () => void; status: ArtStatus["mediagen"] }) => {
  const toast = useToast();
  const gallery = useRemote(() => api.mediagenGallery(), 30000, "studio.mediagen");
  const items: MediaGenJob[] = gallery.data?.items ?? [];
  return (
    <section className="card">
      <h2>MediaGen gallery</h2>
      <p className="hint">Your MediaGen app&apos;s finished images and videos. Bring images into the library to reuse them in builds.</p>
      {status.error ? (
        <Banner kind="error">{status.error}</Banner>
      ) : status.workerOnline === false ? (
        <Banner kind="info">MediaGen&apos;s worker on this PC is not running: videos you ask for wait in its queue until it starts.</Banner>
      ) : null}
      {gallery.error ? <Banner kind="error">{gallery.error}</Banner> : null}
      <div className="studio-grid">
        {items.slice(0, 24).map((job) => (
          <figure key={job.id} className="studio-tile">
            <div className="studio-thumb">
              {job.mediaType === "video" ? <video src={job.mediaUrl ?? undefined} muted loop playsInline controls preload="metadata" /> : <img src={job.mediaUrl ?? undefined} alt={job.prompt} loading="lazy" />}
            </div>
            <figcaption>
              <span className="small" style={{ overflowWrap: "anywhere" }}>
                {job.prompt.slice(0, 60)}
              </span>
              {job.mediaType === "video" ? (
                <a className="btn small" href={job.mediaUrl ?? "#"} download>
                  {Icon.download} Video
                </a>
              ) : (
                <button
                  className="btn small"
                  onClick={async () => {
                    try {
                      await api.mediagenImport(job.id);
                      toast("In the library.");
                      onImported();
                    } catch (error) {
                      toast(error instanceof Error ? error.message : String(error));
                    }
                  }}
                >
                  Into library
                </button>
              )}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
};
