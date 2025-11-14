"use client";

import "regenerator-runtime/runtime";
import { FormEvent, useCallback, useEffect, useState } from "react";
import SpeechRecognition, { useSpeechRecognition } from "react-speech-recognition";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import {
  sendAutoCodeMessage,
  type AutoCodeChatHistory,
  type AutoCodeChatPayload,
  type AutoCodeChatResponse,
  type ProposedEdit
} from "../lib/api";
import heroImages from "../theme/heroImages";
import HeroSection from "./ui/HeroSection";

const renderers = {
  code({ inline, className, children }: { inline?: boolean; className?: string; children: string[] }) {
    const language = /language-(\w+)/.exec(className ?? "")?.[1] ?? "typescript";
    if (inline) {
      return <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-100">{children}</code>;
    }
    return (
      <SyntaxHighlighter language={language} style={vscDarkPlus} PreTag="div" className="rounded-lg">
        {String(children).replace(/\n$/, "")}
      </SyntaxHighlighter>
    );
  }
};

type Message = {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  edits?: ProposedEdit[];
};

export function ChatPanel() {
  const [filePath, setFilePath] = useState("src/index.ts");
  const [instruction, setInstruction] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastResponse, setLastResponse] = useState<AutoCodeChatResponse | null>(null);

  const { transcript, listening, resetTranscript, browserSupportsSpeechRecognition } = useSpeechRecognition();

  useEffect(() => {
    if (listening && transcript) {
      setInstruction(transcript);
    }
  }, [transcript, listening]);

  const supportsSpeech = browserSupportsSpeechRecognition;

  const handleMicrophoneToggle = useCallback(() => {
    if (!supportsSpeech) return;
    if (listening) {
      SpeechRecognition.stopListening();
      resetTranscript();
    } else {
      SpeechRecognition.startListening({ continuous: true });
    }
  }, [supportsSpeech, listening, resetTranscript]);

  const appendHistory = useCallback((history: AutoCodeChatHistory[], edits?: ProposedEdit[]) => {
    setMessages(
      history.map((entry) => ({
        role: entry.role,
        content: entry.content,
        timestamp: entry.timestamp,
        edits: entry.role === "assistant" ? edits : undefined
      }))
    );
  }, []);

  const sendRequest = useCallback(
    async (payload: AutoCodeChatPayload) => {
      setIsLoading(true);
      try {
        const response = await sendAutoCodeMessage(payload);
        setLastResponse(response);
        if (response.history) {
          appendHistory(response.history, response.edits);
        }
      } catch (error) {
        console.error("AutoCode request failed", error);
      } finally {
        setIsLoading(false);
      }
    },
    [appendHistory]
  );

  const onSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!instruction.trim()) return;
      await sendRequest({ action: "propose", filePath, instruction });
      if (listening) {
        SpeechRecognition.stopListening();
        resetTranscript();
      }
    },
    [instruction, filePath, sendRequest, listening, resetTranscript]
  );

  const applyEdit = useCallback(
    async (edit: ProposedEdit) => {
      await sendRequest({ action: "apply", edit });
    },
    [sendRequest]
  );

  const readFile = useCallback(async () => {
    await sendRequest({ action: "read", filePath });
  }, [sendRequest, filePath]);

  return (
    <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 shadow-xl shadow-black/40">
      <HeroSection
        image={heroImages.chat}
        title="AutoCode Chat"
        subtitle="Powered by Hustle Studio"
        className="rounded-t-xl border-b border-slate-800 overflow-hidden"
      />

      <div className="space-y-6 p-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
            <input
              type="text"
              value={filePath}
              onChange={(event) => setFilePath(event.target.value)}
              className="w-full min-w-[12rem] rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none sm:w-56"
              placeholder="src/index.ts"
            />
            <div className="flex gap-2">
              <button
                onClick={readFile}
                className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-sky-500 hover:text-sky-300"
                type="button"
              >
                Preview
              </button>
              <button
                onClick={handleMicrophoneToggle}
                type="button"
                className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  supportsSpeech
                    ? listening
                      ? "bg-rose-600 text-white"
                      : "bg-slate-800 text-slate-200 hover:bg-slate-700"
                    : "bg-slate-800/50 text-slate-500"
                }`}
                disabled={!supportsSpeech}
              >
                <span role="img" aria-label="microphone">
                  🎙️
                </span>
                {listening ? "Listening" : "Mic"}
              </button>
            </div>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
        <textarea
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder="Describe the change you'd like to make"
          className="h-28 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 shadow-inner focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
        />
        <div className="flex justify-end gap-2">
          <button
            type="submit"
            disabled={isLoading}
            className="rounded-md bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700"
          >
            {isLoading ? "Working..." : "Propose Edit"}
          </button>
        </div>
        </form>

        <div className="space-y-4">
        {messages.length === 0 ? (
          <p className="text-sm text-slate-500">No messages yet. Ask AutoCode to inspect a file or propose an edit.</p>
        ) : (
          messages.map((message, index) => (
            <article key={`${message.timestamp}-${index}`} className="rounded-lg border border-slate-800 bg-slate-950/70 p-4">
              <header className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-500">
                <span>{message.role}</span>
                <time>{new Date(message.timestamp).toLocaleTimeString()}</time>
              </header>
              <div className="prose prose-invert mt-2 max-w-none text-sm">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={renderers as any}>
                  {message.content || ""}
                </ReactMarkdown>
              </div>
              {message.edits?.map((edit) => (
                <div key={edit.filePath} className="mt-4 space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span className="font-semibold text-slate-300">{edit.filePath}</span>
                    <button
                      type="button"
                      onClick={() => applyEdit(edit)}
                      className="rounded-md border border-slate-700 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-200 transition hover:border-sky-500 hover:text-sky-300"
                    >
                      Apply Edit
                    </button>
                  </div>
                  <pre className="max-h-64 overflow-auto rounded-md bg-slate-900/90 p-3 text-[11px] text-slate-200">
                    {edit.diff || "(no diff available)"}
                  </pre>
                  <p className="text-xs text-slate-400">{edit.summary}</p>
                </div>
              ))}
            </article>
          ))
        )}
        </div>

        {lastResponse?.message && (
          <div className="rounded-md border border-slate-800 bg-slate-950/70 p-4 text-xs text-slate-400">
            <strong className="text-slate-200">Latest status:</strong> {lastResponse.message}
          </div>
        )}
      </div>
    </section>
  );
}
