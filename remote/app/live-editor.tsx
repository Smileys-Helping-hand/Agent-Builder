"use client";

/**
 * The live editor beside a preview — templates, builds and projects alike.
 *
 * Every preview the builder serves carries the editor's hands (see
 * src/server/previewEditor.ts), so this always connects: colours, fonts, text
 * size, roundness, section order and visibility, typing over text in place,
 * and pointing at anything to say what should change. Templates that carry
 * their own customiser also offer their content fields (business name,
 * headline…), which a build applies to exactly the right place.
 *
 * Nothing on the site is saved. The changes are kept on this device per
 * preview, and the actions turn them into precise instructions: a customer
 * order, a new build pass, or a change to a project.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { Busy, Icon, usePersistentState, useToast } from "./ui";

interface Block {
  id: string;
  title: string;
  tag: string;
}
interface Font {
  label: string;
  value: string;
}
interface Slots {
  background: string | null;
  text: string | null;
  heading: string | null;
  accent: string | null;
}
interface TemplateField {
  path: string;
  label: string;
  kind: "text" | "textarea" | "color" | "font";
  value: string;
}

export interface EditorChanges {
  vars: Record<string, string>;
  slots: Partial<Record<keyof Slots, string>>;
  fonts: { body?: string; heading?: string };
  scale: number;
  radius: number | null;
  order: string[];
  hidden: string[];
  texts: Array<{ path: string; before: string; text: string }>;
  notes: Array<{ path: string; tag: string; text: string; note: string }>;
  fields: Record<string, string>;
}

const EMPTY: EditorChanges = { vars: {}, slots: {}, fonts: {}, scale: 100, radius: null, order: [], hidden: [], texts: [], notes: [], fields: {} };

const SLOT_LABEL: Record<keyof Slots, string> = {
  background: "Page background",
  text: "Body text",
  heading: "Headings",
  accent: "Buttons & links"
};

const hex = (value: string | null | undefined) => (value && /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000");
const clip = (text: string, length = 120) => (text.length > length ? `${text.slice(0, length)}…` : text);

/** The changes as instructions a build can follow exactly. */
export const changesAsBrief = (changes: EditorChanges, blocks: Block[], fonts: Font[], fields: TemplateField[]): string => {
  const lines: string[] = [];
  const fontName = (value?: string) => fonts.find((font) => font.value === value)?.label ?? value;
  for (const [path, value] of Object.entries(changes.fields)) {
    const field = fields.find((entry) => entry.path === path);
    if (field && field.value !== value) lines.push(`- ${field.label} (${path} in src/content.ts): ${value}`);
  }
  for (const text of changes.texts) {
    if (text.before.trim() !== text.text.trim()) lines.push(`- Change the text "${clip(text.before, 200)}" to "${clip(text.text, 400)}"`);
  }
  for (const note of changes.notes) {
    lines.push(`- On the <${note.tag}>${note.text ? ` "${clip(note.text, 80)}"` : ""}: ${note.note}`);
  }
  const slotLines = (Object.keys(changes.slots) as Array<keyof Slots>)
    .filter((slot) => changes.slots[slot])
    .map((slot) => `${SLOT_LABEL[slot].toLowerCase()} ${changes.slots[slot]}`);
  if (slotLines.length) lines.push(`- Colours: ${slotLines.join("; ")}`);
  for (const [name, value] of Object.entries(changes.vars)) lines.push(`- Set the colour ${name} to ${value}`);
  if (changes.fonts.body) lines.push(`- Body text font: ${fontName(changes.fonts.body)} (${changes.fonts.body})`);
  if (changes.fonts.heading) lines.push(`- Headings font: ${fontName(changes.fonts.heading)} (${changes.fonts.heading})`);
  if (changes.scale !== 100) lines.push(`- Make all text ${changes.scale}% of its current size`);
  if (changes.radius !== null) lines.push(`- Use ${changes.radius}px rounded corners on buttons, cards, inputs and images`);
  const titled = (ids: string[]) => ids.map((id) => `"${blocks.find((block) => block.id === id)?.title ?? id}"`).join(", ");
  if (changes.order.length) lines.push(`- Put the page's sections in this order: ${titled(changes.order)}`);
  if (changes.hidden.length) lines.push(`- Remove these sections: ${titled(changes.hidden)}`);
  return lines.length ? `Changes made in the live editor — make all of them, exactly:\n${lines.join("\n")}` : "";
};

export interface EditorAction {
  label: string;
  primary?: boolean;
  run: (brief: string) => Promise<void> | void;
}

export const LiveEditor = ({
  storageKey,
  frameRef,
  actions
}: {
  /** Where the changes are kept on this device, e.g. "template:landing". */
  storageKey: string;
  frameRef: React.MutableRefObject<HTMLIFrameElement | null>;
  actions: EditorAction[];
}) => {
  const toast = useToast();
  const [ready, setReady] = useState(false);
  const [waited, setWaited] = useState(0);
  const [vars, setVars] = useState<Array<{ name: string; value: string }>>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [fonts, setFonts] = useState<Font[]>([]);
  const [slots, setSlots] = useState<Slots>({ background: null, text: null, heading: null, accent: null });
  const [fields, setFields] = useState<TemplateField[]>([]);
  const [changes, setChanges] = usePersistentState<EditorChanges>(`live-edit.${storageKey}`, EMPTY);
  const [mode, setMode] = useState<"none" | "text" | "pick">("none");
  const [picked, setPicked] = useState<{ path: string; tag: string; text: string } | null>(null);
  const [note, setNote] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const changesRef = useRef(changes);
  changesRef.current = { ...EMPTY, ...changes };

  const post = (message: Record<string, unknown>) => frameRef.current?.contentWindow?.postMessage(message, "*");
  const apply = (next: EditorChanges) => {
    post({ type: "ab-edit-apply", ...next });
    if (Object.keys(next.fields).length) post({ type: "arp-customize", patch: next.fields });
  };
  const update = (next: EditorChanges) => {
    setChanges(next);
    apply(next);
  };

  // Say hello to each new page until it answers; put the changes back on it.
  useEffect(() => {
    let lastFrame: HTMLIFrameElement | null = null;
    let answered = false;
    const onMessage = (event: MessageEvent) => {
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) return;
      const data = event.data as Record<string, any>;
      if (data?.type === "ab-edit-ready") {
        answered = true;
        setReady(true);
        setVars(data.vars ?? []);
        setBlocks(data.blocks ?? []);
        setFonts(data.fonts ?? []);
        setSlots(data.slots ?? {});
        apply(changesRef.current);
      } else if (data?.type === "arp-customize-ready") {
        setFields((data.fields ?? []).filter((field: TemplateField) => field.kind === "text" || field.kind === "textarea"));
      } else if (data?.type === "ab-edit-text" && typeof data.path === "string") {
        const current = changesRef.current;
        const texts = current.texts.filter((entry) => entry.path !== data.path);
        const before = current.texts.find((entry) => entry.path === data.path)?.before ?? data.before ?? "";
        setChanges({ ...current, texts: [...texts, { path: data.path, before, text: String(data.text ?? "") }] });
      } else if (data?.type === "ab-edit-picked") {
        setPicked({ path: data.path, tag: data.tag, text: data.text ?? "" });
        setNote("");
      }
    };
    window.addEventListener("message", onMessage);
    const timer = setInterval(() => {
      if (frameRef.current !== lastFrame) {
        lastFrame = frameRef.current;
        answered = false;
        setReady(false);
        setWaited(0);
      }
      if (!answered) {
        setWaited((value) => value + 1);
        post({ type: "ab-edit-hello" });
        post({ type: "arp-customize-hello" });
      }
    }, 700);
    return () => {
      window.removeEventListener("message", onMessage);
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // The page forgets the mode when it reloads; tell it again.
  useEffect(() => {
    if (ready) post({ type: "ab-edit-mode", text: mode === "text", pick: mode === "pick" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, ready]);

  const c = { ...EMPTY, ...changes };
  const brief = useMemo(() => changesAsBrief(c, blocks, fonts, fields), [c, blocks, fonts, fields]);
  const count = brief ? brief.split("\n").length - 1 : 0;

  const ordered = [
    ...c.order.map((id) => blocks.find((block) => block.id === id)).filter((block): block is Block => Boolean(block)),
    ...blocks.filter((block) => !c.order.includes(block.id))
  ];
  const move = (id: string, to: number) => {
    const ids = ordered.map((block) => block.id).filter((entry) => entry !== id);
    ids.splice(Math.max(0, Math.min(ids.length, to)), 0, id);
    update({ ...c, order: ids });
  };

  if (!ready) {
    return (
      <div className="editor">
        {waited < 9 ? (
          <p className="muted small">Connecting to the preview…</p>
        ) : (
          <p className="small">
            The preview is not answering the editor. This needs the builder on the PC to be up to date: update it from Control →
            Update the builder (or the strip at the top), then reload the preview.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="editor">
      <div className="editor-head">
        <strong>Live editor</strong>
        <span className="muted small">{count ? `${count} change${count === 1 ? "" : "s"}` : "No changes yet"}</span>
      </div>

      <div className="segmented editor-modes" role="group" aria-label="What clicking the preview does">
        <button className={mode === "none" ? "on" : ""} onClick={() => setMode("none")}>
          Browse
        </button>
        <button className={mode === "text" ? "on" : ""} onClick={() => setMode("text")} title="Click any text in the preview and type over it">
          Edit text
        </button>
        <button className={mode === "pick" ? "on" : ""} onClick={() => setMode("pick")} title="Click anything in the preview and say what should change">
          Point &amp; say
        </button>
      </div>
      {mode === "text" ? <p className="muted small editor-tip">Click any heading, paragraph or button in the preview and type.</p> : null}
      {mode === "pick" ? (
        picked ? (
          <div className="picked">
            <small className="muted">
              Selected &lt;{picked.tag}&gt;{picked.text ? ` “${clip(picked.text, 60)}”` : ""}
            </small>
            <textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="What should change? e.g. make it bigger, use a photo of the team, link it to WhatsApp" />
            <div className="btn-row">
              <button
                className="btn small primary"
                disabled={!note.trim()}
                onClick={() => {
                  update({ ...c, notes: [...c.notes, { ...picked, note: note.trim() }] });
                  setPicked(null);
                  setNote("");
                }}
              >
                Add to the changes
              </button>
              <button className="btn small ghost" onClick={() => setPicked(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className="muted small editor-tip">Click anything in the preview — a section, a picture, a button — then say what should change.</p>
        )
      ) : null}

      {fields.length ? (
        <fieldset>
          <legend>Business details</legend>
          {fields.map((field) => (
            <label key={field.path} className="field compact">
              <span>{field.label}</span>
              {field.kind === "textarea" ? (
                <textarea rows={2} value={c.fields[field.path] ?? field.value} onChange={(event) => update({ ...c, fields: { ...c.fields, [field.path]: event.target.value } })} />
              ) : (
                <input value={c.fields[field.path] ?? field.value} onChange={(event) => update({ ...c, fields: { ...c.fields, [field.path]: event.target.value } })} />
              )}
            </label>
          ))}
        </fieldset>
      ) : null}

      <fieldset>
        <legend>Colours</legend>
        <div className="swatches">
          {(Object.keys(SLOT_LABEL) as Array<keyof Slots>).map((slot) => (
            <label key={slot} className="swatch">
              <input type="color" value={hex(c.slots[slot] ?? slots[slot])} onChange={(event) => update({ ...c, slots: { ...c.slots, [slot]: event.target.value } })} />
              <span>{SLOT_LABEL[slot]}</span>
              <input className="hex" value={c.slots[slot] ?? slots[slot] ?? ""} onChange={(event) => update({ ...c, slots: { ...c.slots, [slot]: event.target.value } })} spellCheck={false} aria-label={`${SLOT_LABEL[slot]} hex`} />
            </label>
          ))}
          {vars.map((entry) => (
            <label key={entry.name} className="swatch">
              <input type="color" value={hex(c.vars[entry.name] ?? entry.value)} onChange={(event) => update({ ...c, vars: { ...c.vars, [entry.name]: event.target.value } })} />
              <span className="mono">{entry.name.replace(/^--/, "")}</span>
              <input className="hex" value={c.vars[entry.name] ?? entry.value} onChange={(event) => update({ ...c, vars: { ...c.vars, [entry.name]: event.target.value } })} spellCheck={false} aria-label={`${entry.name} hex`} />
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Type &amp; shape</legend>
        <div className="font-pickers">
          {(["heading", "body"] as const).map((which) => (
            <label key={which} className="field compact">
              <span>{which === "heading" ? "Headings font" : "Text font"}</span>
              <select value={c.fonts[which] ?? ""} onChange={(event) => update({ ...c, fonts: { ...c.fonts, [which]: event.target.value || undefined } })}>
                <option value="">As it is</option>
                {fonts.map((font) => (
                  <option key={font.value} value={font.value}>
                    {font.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <label className="range">
          <span>Text size {c.scale}%</span>
          <input type="range" min={80} max={130} step={5} value={c.scale} onChange={(event) => update({ ...c, scale: Number(event.target.value) })} />
        </label>
        <label className="range">
          <span>Roundness {c.radius === null ? "as it is" : `${c.radius}px`}</span>
          <input type="range" min={0} max={28} step={2} value={c.radius ?? 10} onChange={(event) => update({ ...c, radius: Number(event.target.value) })} />
        </label>
      </fieldset>

      {ordered.length > 1 ? (
        <fieldset>
          <legend>Sections — drag or use the arrows; the eye hides one</legend>
          <ol className="blocks">
            {ordered.map((block, index) => {
              const hidden = c.hidden.includes(block.id);
              return (
                <li
                  key={block.id}
                  draggable
                  className={`${hidden ? "hidden" : ""} ${dragging === block.id ? "dragging" : ""}`}
                  onDragStart={() => setDragging(block.id)}
                  onDragEnd={() => setDragging(null)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    if (dragging && dragging !== block.id) move(dragging, index);
                    setDragging(null);
                  }}
                >
                  <span className="grip" aria-hidden="true">
                    ⋮⋮
                  </span>
                  <span className="block-title">{block.title}</span>
                  <button className="icon-btn" onClick={() => move(block.id, index - 1)} disabled={index === 0} aria-label={`Move ${block.title} up`}>
                    ↑
                  </button>
                  <button className="icon-btn" onClick={() => move(block.id, index + 1)} disabled={index === ordered.length - 1} aria-label={`Move ${block.title} down`}>
                    ↓
                  </button>
                  <button
                    className="icon-btn"
                    onClick={() => update({ ...c, hidden: hidden ? c.hidden.filter((id) => id !== block.id) : [...c.hidden, block.id] })}
                    aria-label={hidden ? `Show ${block.title}` : `Hide ${block.title}`}
                  >
                    {hidden ? "◌" : Icon.eye}
                  </button>
                </li>
              );
            })}
          </ol>
        </fieldset>
      ) : null}

      {c.texts.length || c.notes.length ? (
        <fieldset>
          <legend>Your changes</legend>
          <ul className="change-list">
            {c.texts
              .filter((text) => text.before.trim() !== text.text.trim())
              .map((text) => (
                <li key={text.path}>
                  <span>
                    “{clip(text.before, 40)}” → “{clip(text.text, 60)}”
                  </span>
                  <button className="icon-btn" aria-label="Undo this text change" onClick={() => update({ ...c, texts: c.texts.filter((entry) => entry.path !== text.path) })}>
                    ✕
                  </button>
                </li>
              ))}
            {c.notes.map((entry, index) => (
              <li key={`${entry.path}-${index}`}>
                <span>
                  &lt;{entry.tag}&gt; {entry.note}
                </span>
                <button className="icon-btn" aria-label="Remove this note" onClick={() => update({ ...c, notes: c.notes.filter((_, at) => at !== index) })}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}

      <div className="btn-row">
        {actions.map((action) => (
          <button
            key={action.label}
            className={`btn small ${action.primary ? "primary" : ""}`}
            disabled={!brief || busy !== null}
            onClick={async () => {
              setBusy(action.label);
              try {
                await action.run(brief);
              } catch (error) {
                toast(error instanceof Error ? error.message : String(error), "error");
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === action.label ? <Busy label="…" /> : action.label}
          </button>
        ))}
        <button
          className="btn small"
          disabled={!brief}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(brief);
              toast("Copied the changes as instructions", "ok");
            } catch {
              toast("Could not copy on this device", "error");
            }
          }}
        >
          {Icon.copy} Copy
        </button>
        <button
          className="btn small ghost"
          disabled={!count}
          onClick={() => {
            setChanges(EMPTY);
            // A reload is the honest way back to how the page really is.
            const frame = frameRef.current;
            if (frame) frame.src = frame.src;
          }}
        >
          Reset
        </button>
      </div>
    </div>
  );
};
