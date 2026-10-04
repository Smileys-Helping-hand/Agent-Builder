"use client";

/**
 * Talk to a research topic: ask it anything about what it has found, get
 * answers that cite its findings, and have it teach you. When its research does
 * not cover a question, one tap sends that question to the top of its list.
 */
import { useEffect, useRef, useState } from "react";

import { api, type ResearchChatMessage, type TopicDetail } from "@/lib/api";
import { Icon, useToast } from "../ui";

const STARTERS = [
  { label: "Explain it simply", text: "Explain what you have found so far as if I were a beginner, with an example." },
  { label: "Quiz me", text: "Quiz me: ask me three questions about what you have found, then tell me the answers." },
  { label: "What's still uncertain?", text: "What are you still unsure about, and where do your sources disagree?" },
  { label: "What should the builder do?", text: "What should an app builder do differently because of what you found? Give concrete rules." }
];

export function Talk({ data, onResearchThis }: { data: TopicDetail; onResearchThis: () => void }) {
  const toast = useToast();
  const [messages, setMessages] = useState<ResearchChatMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [openCite, setOpenCite] = useState<number | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const topicId = data.topic.id;

  useEffect(() => {
    let cancelled = false;
    void api
      .topicChat(topicId)
      .then((res) => !cancelled && setMessages(res.messages))
      .catch(() => undefined)
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [topicId]);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, sending]);

  const send = async (message: string) => {
    const clean = message.trim();
    if (!clean || sending) return;
    setSending(true);
    setText("");
    const pending: ResearchChatMessage = { id: -Date.now(), role: "you", text: clean, cites: [], gap: false, createdAt: new Date().toISOString() };
    setMessages((current) => [...current, pending]);
    try {
      const { question, answer } = await api.talkToTopic(topicId, clean);
      setMessages((current) => [...current.filter((m) => m.id !== pending.id), question, answer]);
    } catch (error) {
      setMessages((current) => current.filter((m) => m.id !== pending.id));
      setText(clean);
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setSending(false);
    }
  };

  const researchThis = async (question: string) => {
    try {
      await api.askTopic(topicId, question.slice(0, 280));
      toast("Added to the top of its research list.", "ok");
      onResearchThis();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const finding = (id: number) => data.findings.find((f) => f.id === id);

  return (
    <div className="talk">
      <div className="talk-thread" aria-live="polite">
        {loaded && messages.length === 0 ? (
          <div className="talk-empty">
            <strong>Ask it anything about {data.topic.title}</strong>
            <p>It answers from the {data.findings.length} findings it has gathered and shows which ones. Try:</p>
          </div>
        ) : null}
        {messages.map((message, index) => {
          const previousQuestion = messages.slice(0, index).reverse().find((m) => m.role === "you");
          return (
            <div key={message.id} className={`talk-msg ${message.role}`}>
              <div className="talk-bubble">
                {message.text.split(/\n{2,}/).map((para, i) => (
                  <p key={i}>
                    {para.split(/(\[F\d+\])/g).map((part, j) => {
                      const cite = part.match(/^\[F(\d+)\]$/);
                      if (!cite) return <span key={j}>{part}</span>;
                      const id = Number(cite[1]);
                      return (
                        <button key={j} className="talk-cite" onClick={() => setOpenCite(openCite === id ? null : id)} title="Show this finding">
                          F{id}
                        </button>
                      );
                    })}
                  </p>
                ))}
              </div>
              {message.role === "research" && message.gap && previousQuestion ? (
                <button className="btn small" onClick={() => void researchThis(previousQuestion.text)}>
                  {Icon.sparkle} Research this next
                </button>
              ) : null}
            </div>
          );
        })}
        {sending ? (
          <div className="talk-msg research">
            <div className="talk-bubble talk-typing" aria-label="Thinking">
              <i />
              <i />
              <i />
            </div>
          </div>
        ) : null}
        {openCite !== null ? (
          <div className="talk-finding">
            {finding(openCite) ? (
              <>
                <small>
                  F{openCite} · {Math.round((finding(openCite)?.confidence ?? 0) * 100)}%
                  {finding(openCite)?.status === "corroborated" ? " · confirmed" : ""}
                </small>
                <p>{finding(openCite)?.claim}</p>
                {finding(openCite)?.sourceUrl ? (
                  <a href={finding(openCite)?.sourceUrl ?? "#"} target="_blank" rel="noreferrer">
                    {finding(openCite)?.sourceTitle || finding(openCite)?.sourceUrl}
                  </a>
                ) : null}
              </>
            ) : (
              <p>That finding is not in the latest list. Open the Findings tab to search for it.</p>
            )}
          </div>
        ) : null}
        <div ref={end} />
      </div>

      <div className="chips" style={{ marginTop: 8 }}>
        {STARTERS.map((starter) => (
          <button key={starter.label} className="chip accent" disabled={sending} onClick={() => void send(starter.text)}>
            {starter.label}
          </button>
        ))}
      </div>

      <form
        className="talk-input"
        onSubmit={(event) => {
          event.preventDefault();
          void send(text);
        }}
      >
        <textarea
          rows={2}
          value={text}
          placeholder="Ask about what it found, or ask it to teach you…"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send(text);
            }
          }}
        />
        <button className="btn primary" type="submit" disabled={sending || !text.trim()}>
          {Icon.sparkle} Ask
        </button>
      </form>
      {messages.length > 0 ? (
        <button
          className="btn small ghost"
          style={{ marginTop: 6 }}
          onClick={() =>
            void api
              .clearTopicChat(topicId)
              .then(() => setMessages([]))
              .catch(() => undefined)
          }
        >
          Start a new conversation
        </button>
      ) : null}
    </div>
  );
}
