"use client";

/**
 * The model's answer as it is being written, like a terminal: which model,
 * what it is doing, how fast, and the text so far. It follows the end of the
 * text unless you have scrolled up to read something.
 */
import { useEffect, useRef, useState } from "react";

import type { LiveWriting } from "@/lib/api";
import { useToast } from "../ui";

/** Seconds without a new token before the pane says what is going on instead. */
const QUIET_AFTER_S = 12;

export const WritingPane = ({ writing, stage }: { writing: LiveWriting | null | undefined; stage?: string | null }) => {
  const toast = useToast();
  const body = useRef<HTMLPreElement>(null);
  const [follow, setFollow] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  // A clock for "quiet for 20s": the build page polls, but not every second.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (follow && body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [writing?.tail, follow]);

  const quietFor = writing ? Math.round((now - new Date(writing.at).getTime()) / 1000) : 0;
  const quiet = !writing || writing.done || quietFor > QUIET_AFTER_S;
  const status = !writing
    ? "Warming up the model…"
    : writing.done
      ? `Finished writing — now ${stage ? stage.toLowerCase() : "checking what it wrote"}`
      : quiet
        ? `No new text for ${quietFor}s — the model may be loading or thinking`
        : `${writing.tokensPerSecond} tokens/s`;

  return (
    <div className={`writing ${quiet ? "" : "on"}`}>
      <div className="writing-head">
        <span>
          <i className="writing-dot" />
          {writing ? writing.phase : "Starting"}
          {writing ? <small> · {writing.model}</small> : null}
        </span>
        <span className="writing-meta">
          <small>{status}</small>
          {writing ? <small>{writing.chars.toLocaleString()} chars</small> : null}
          {writing?.tail ? (
            <button
              className="chip"
              onClick={() => {
                void navigator.clipboard.writeText(writing.tail).then(
                  () => toast("Copied what it is writing", "ok"),
                  () => toast("Could not copy", "error")
                );
              }}
            >
              Copy
            </button>
          ) : null}
        </span>
      </div>
      <pre
        ref={body}
        className="writing-body"
        onScroll={(event) => {
          const el = event.currentTarget;
          // Near the bottom: keep following. Scrolled up to read: stay put.
          setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
        }}
      >
        {writing?.tail || "Nothing written yet. The first answer appears here as it is generated."}
        {!quiet ? <span className="writing-caret" /> : null}
      </pre>
      {!follow ? (
        <button className="writing-jump chip accent" onClick={() => setFollow(true)}>
          Jump to the latest ↓
        </button>
      ) : null}
    </div>
  );
};

/**
 * One-tap instructions for the moments you see it going wrong. They fill the
 * box rather than sending, so you can adjust the words first.
 */
export const QUICK_STEERS: Array<{ label: string; text: string }> = [
  { label: "Fix what fails first", text: "Fix the check that is failing before changing anything else." },
  { label: "Only change what fails", text: "Stop rewriting files that already work. Change only what the failing check needs." },
  { label: "Keep it simple", text: "Keep it simple: fewer features, and make the ones that are there work properly." },
  { label: "Polish the look", text: "Polish the look: consistent spacing and colours, a clear layout, and make it work well on a phone." },
  { label: "Handle errors", text: "Add clear error messages, loading states and empty states wherever data is fetched or submitted." },
  { label: "Write tests", text: "Add focused tests for the main logic, and make sure they pass." }
];
