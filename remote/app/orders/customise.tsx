"use client";

/**
 * Live editor for a template's preview: words, colours, font, and which
 * sections show in what order — applied to the running site as you change
 * them, so you (or a customer beside you) see the result immediately.
 *
 * It speaks the templates' own protocol (templates/sites/_kit/src/lib/
 * customize.ts): say hello, receive the fields and sections the site has,
 * then send whitelisted changes. The site checks where they come from and
 * only accepts plain values: hex colours, known fonts, plain section ids.
 *
 * Nothing on the site is saved. The choices are kept on this device per
 * template, and "Use for a customer" turns them into exact instructions in
 * the order's brief, which the build makes permanent in src/content.ts.
 */
import { useEffect, useRef, useState } from "react";

import { Icon, usePersistentState, useToast } from "../ui";

interface Field {
  path: string;
  label: string;
  kind: "text" | "textarea" | "color" | "font";
  value: string;
}

interface Section {
  id: string;
  title: string;
}

interface Choices {
  patch: Record<string, string>;
  order: string[];
  hidden: string[];
}

const EMPTY: Choices = { patch: {}, order: [], hidden: [] };

/** The choices as instructions a build can follow exactly. */
export const choicesAsBrief = (choices: Choices, fields: Field[], sections: Section[]): string => {
  const lines: string[] = [];
  for (const [path, value] of Object.entries(choices.patch)) {
    const field = fields.find((entry) => entry.path === path);
    if (!field || field.value === value) continue;
    lines.push(`- ${field.label} (${path}): ${value}`);
  }
  const titled = (ids: string[]) => ids.map((id) => sections.find((section) => section.id === id)?.title ?? id).join(", ");
  if (choices.order.length) lines.push(`- Section order: ${titled(choices.order)}`);
  if (choices.hidden.length) lines.push(`- Leave out these sections: ${titled(choices.hidden)}`);
  return lines.length
    ? `Customisations chosen in the live editor. Apply them exactly — the values in src/content.ts, and the section order and hidden sections on the page:\n${lines.join("\n")}`
    : "";
};

export const LiveEditor = ({
  templateId,
  frameRef,
  onUseForCustomer
}: {
  templateId: string;
  frameRef: React.MutableRefObject<HTMLIFrameElement | null>;
  onUseForCustomer: (brief: string) => void;
}) => {
  const toast = useToast();
  const [fields, setFields] = useState<Field[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [fonts, setFonts] = useState<Array<{ label: string; value: string }>>([]);
  const [ready, setReady] = useState(false);
  const [choices, setChoices] = usePersistentState<Choices>(`template-customise.${templateId}`, EMPTY);
  const [dragging, setDragging] = useState<string | null>(null);
  const choicesRef = useRef(choices);
  choicesRef.current = choices;

  const send = (next: Choices) => {
    const target = frameRef.current?.contentWindow;
    if (!target) return;
    // The frame is sandboxed without an origin of its own, so "*" is the only
    // target that reaches it; what is sent is the choices, nothing private.
    target.postMessage({ type: "arp-customize", patch: next.patch, sections: { order: next.order, hidden: next.hidden } }, "*");
  };

  // Say hello to each new page (a reload, a device switch) until it answers.
  useEffect(() => {
    let lastFrame: HTMLIFrameElement | null = null;
    let answered = false;
    const onMessage = (event: MessageEvent) => {
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) return;
      const data = event.data as { type?: string; fields?: Field[]; sections?: Section[]; fonts?: Array<{ label: string; value: string }> };
      if (data?.type !== "arp-customize-ready") return;
      answered = true;
      setReady(true);
      setFields(data.fields ?? []);
      setSections(data.sections ?? []);
      setFonts(data.fonts ?? []);
      // A fresh page starts from the template's own content: put the choices back.
      send(choicesRef.current);
    };
    window.addEventListener("message", onMessage);
    const timer = setInterval(() => {
      if (frameRef.current !== lastFrame) {
        lastFrame = frameRef.current;
        answered = false;
        setReady(false);
      }
      if (!answered) frameRef.current?.contentWindow?.postMessage({ type: "arp-customize-hello" }, "*");
    }, 700);
    return () => {
      window.removeEventListener("message", onMessage);
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  const update = (next: Choices) => {
    setChoices(next);
    send(next);
  };

  const valueOf = (field: Field) => choices.patch[field.path] ?? field.value;
  const setValue = (field: Field, value: string) => update({ ...choices, patch: { ...choices.patch, [field.path]: value } });

  // The order shown: the chosen order first, then any section not yet placed.
  const ordered = [
    ...choices.order.map((id) => sections.find((section) => section.id === id)).filter((section): section is Section => Boolean(section)),
    ...sections.filter((section) => !choices.order.includes(section.id))
  ];
  const move = (id: string, to: number) => {
    const ids = ordered.map((section) => section.id).filter((entry) => entry !== id);
    ids.splice(Math.max(0, Math.min(ids.length, to)), 0, id);
    update({ ...choices, order: ids });
  };
  const toggle = (id: string) =>
    update({ ...choices, hidden: choices.hidden.includes(id) ? choices.hidden.filter((entry) => entry !== id) : [...choices.hidden, id] });

  const changed = Object.entries(choices.patch).filter(([path, value]) => fields.find((field) => field.path === path)?.value !== value).length;
  const brief = choicesAsBrief(choices, fields, sections);

  if (!ready) {
    return (
      <div className="editor">
        <p className="muted small">Connecting to the preview… (the template has to be showing, and support live editing)</p>
      </div>
    );
  }

  const colours = fields.filter((field) => field.kind === "color");
  const words = fields.filter((field) => field.kind === "text" || field.kind === "textarea");
  const font = fields.find((field) => field.kind === "font");

  return (
    <div className="editor">
      <div className="editor-head">
        <strong>Live editor</strong>
        <span className="muted small">
          {changed} change{changed === 1 ? "" : "s"}
          {choices.order.length || choices.hidden.length ? " · layout changed" : ""}
        </span>
      </div>

      {colours.length ? (
        <fieldset>
          <legend>Colours</legend>
          <div className="swatches">
            {colours.map((field) => (
              <label key={field.path} className="swatch">
                <input type="color" value={/^#[0-9a-f]{6}$/i.test(valueOf(field)) ? valueOf(field) : "#000000"} onChange={(event) => setValue(field, event.target.value)} />
                <span>{field.label}</span>
                <input
                  className="hex"
                  value={valueOf(field)}
                  onChange={(event) => setValue(field, event.target.value)}
                  spellCheck={false}
                  aria-label={`${field.label} hex value`}
                />
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {font ? (
        <fieldset>
          <legend>Font</legend>
          <div className="chips">
            {fonts.map((option) => (
              <button
                key={option.value}
                className={`chip ${valueOf(font) === option.value ? "accent" : ""}`}
                style={{ fontFamily: option.value }}
                onClick={() => setValue(font, option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}

      {words.length ? (
        <fieldset>
          <legend>Words</legend>
          {words.map((field) => (
            <label key={field.path} className="field compact">
              <span>{field.label}</span>
              {field.kind === "textarea" ? (
                <textarea rows={2} value={valueOf(field)} onChange={(event) => setValue(field, event.target.value)} />
              ) : (
                <input value={valueOf(field)} onChange={(event) => setValue(field, event.target.value)} />
              )}
            </label>
          ))}
        </fieldset>
      ) : null}

      {ordered.length ? (
        <fieldset>
          <legend>Sections — drag to reorder, tap the eye to hide</legend>
          <ol className="blocks">
            {ordered.map((section, index) => {
              const hidden = choices.hidden.includes(section.id);
              return (
                <li
                  key={section.id}
                  draggable
                  className={`${hidden ? "hidden" : ""} ${dragging === section.id ? "dragging" : ""}`}
                  onDragStart={() => setDragging(section.id)}
                  onDragEnd={() => setDragging(null)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    if (dragging && dragging !== section.id) move(dragging, index);
                    setDragging(null);
                  }}
                >
                  <span className="grip" aria-hidden="true">
                    ⋮⋮
                  </span>
                  <span className="block-title">{section.title}</span>
                  <button className="icon-btn" onClick={() => move(section.id, index - 1)} disabled={index === 0} aria-label={`Move ${section.title} up`}>
                    ↑
                  </button>
                  <button className="icon-btn" onClick={() => move(section.id, index + 1)} disabled={index === ordered.length - 1} aria-label={`Move ${section.title} down`}>
                    ↓
                  </button>
                  <button className="icon-btn" onClick={() => toggle(section.id)} aria-label={hidden ? `Show ${section.title}` : `Hide ${section.title}`}>
                    {hidden ? "◌" : Icon.eye}
                  </button>
                </li>
              );
            })}
          </ol>
        </fieldset>
      ) : null}

      <div className="btn-row">
        <button className="btn small primary" disabled={!brief} onClick={() => onUseForCustomer(brief)}>
          {Icon.sparkle} Use for a customer
        </button>
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
          disabled={!changed && !choices.order.length && !choices.hidden.length}
          onClick={() => {
            // The site only ever applies values it is sent, so going back means
            // sending the template's own values again.
            setChoices(EMPTY);
            send({ patch: Object.fromEntries(fields.map((field) => [field.path, field.value])), order: [], hidden: [] });
          }}
        >
          Reset
        </button>
      </div>
    </div>
  );
};
