import { FormEvent, useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import {
  fetchGestures,
  fetchVoiceCommands,
  submitGesture,
  submitVoiceControl,
  type ArGesture,
  type VoiceCommand
} from "../lib/api";

export const ControlPanel = () => {
  const { data: voiceData, mutate: refreshVoice } = useSWR<{ commands: VoiceCommand[] }>(
    "controls-voice",
    () => fetchVoiceCommands()
  );
  const { data: gestureData, mutate: refreshGestures } = useSWR<{ gestures: ArGesture[] }>(
    "controls-gestures",
    () => fetchGestures()
  );
  const [voiceText, setVoiceText] = useState("");
  const [voiceConfidence, setVoiceConfidence] = useState(0.5);
  const [gesture, setGesture] = useState("");
  const [context, setContext] = useState("");
  const [isSending, setIsSending] = useState(false);

  const voiceCommands = useMemo(() => voiceData?.commands ?? [], [voiceData]);
  const gestures = useMemo(() => gestureData?.gestures ?? [], [gestureData]);

  const submitVoice = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!voiceText.trim()) return;
      setIsSending(true);
      try {
        await submitVoiceControl(voiceText.trim(), voiceConfidence);
        setVoiceText("");
        await refreshVoice();
      } finally {
        setIsSending(false);
      }
    },
    [voiceText, voiceConfidence, refreshVoice]
  );

  const submitAr = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!gesture.trim()) return;
      setIsSending(true);
      try {
        await submitGesture(gesture.trim(), context.trim() || undefined);
        setGesture("");
        setContext("");
        await refreshGestures();
      } finally {
        setIsSending(false);
      }
    },
    [gesture, context, refreshGestures]
  );

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-6">
        <h3 className="text-lg font-semibold text-slate-100">Voice Commands</h3>
        <p className="mt-2 text-sm text-slate-400">
          Prototype hook for issuing natural language controls to the orchestrator. Commands are stored for auditing.
        </p>
        <form onSubmit={submitVoice} className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_120px]">
          <label className="md:col-span-1">
            <span className="text-xs uppercase tracking-wide text-slate-400">Command</span>
            <input
              className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              value={voiceText}
              onChange={(event) => setVoiceText(event.target.value)}
            />
          </label>
          <label>
            <span className="text-xs uppercase tracking-wide text-slate-400">Confidence</span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.1}
              className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              value={voiceConfidence}
              onChange={(event) => setVoiceConfidence(Number(event.target.value))}
            />
          </label>
          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={isSending}
              className="inline-flex rounded-md bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700"
            >
              {isSending ? "Sending..." : "Send Voice Command"}
            </button>
          </div>
        </form>
        <div className="mt-6 space-y-3">
          {voiceCommands.length === 0 && (
            <p className="rounded-lg border border-dashed border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-400">
              No voice commands recorded yet.
            </p>
          )}
          {voiceCommands.map((command) => (
            <div key={command.id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-100">{command.text}</p>
                  <p className="text-xs text-slate-500">Confidence {(command.confidence * 100).toFixed(0)}%</p>
                </div>
                <p className="text-xs text-slate-500">{new Date(command.timestamp).toLocaleString()}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-6">
        <h3 className="text-lg font-semibold text-slate-100">AR Gestures</h3>
        <p className="mt-2 text-sm text-slate-400">
          Capture spatial gestures for future AR surfaces. Each gesture is logged alongside optional context.
        </p>
        <form onSubmit={submitAr} className="mt-4 grid gap-3 md:grid-cols-3">
          <label className="md:col-span-1">
            <span className="text-xs uppercase tracking-wide text-slate-400">Gesture</span>
            <input
              className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              value={gesture}
              onChange={(event) => setGesture(event.target.value)}
            />
          </label>
          <label className="md:col-span-2">
            <span className="text-xs uppercase tracking-wide text-slate-400">Context</span>
            <input
              className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              value={context}
              onChange={(event) => setContext(event.target.value)}
            />
          </label>
          <div className="md:col-span-3">
            <button
              type="submit"
              disabled={isSending}
              className="inline-flex rounded-md bg-purple-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-purple-400 disabled:cursor-not-allowed disabled:bg-slate-700"
            >
              {isSending ? "Submitting..." : "Submit Gesture"}
            </button>
          </div>
        </form>
        <div className="mt-6 space-y-3">
          {gestures.length === 0 && (
            <p className="rounded-lg border border-dashed border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-400">
              No gestures captured yet.
            </p>
          )}
          {gestures.map((entry) => (
            <div key={entry.id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-100">{entry.gesture}</p>
                  {entry.context && <p className="text-xs text-slate-500">Context: {entry.context}</p>}
                </div>
                <p className="text-xs text-slate-500">{new Date(entry.timestamp).toLocaleString()}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
