"use client";

import { api } from "@/lib/api";
import { Banner, Busy, Header, NotConnected, ago, useConnected, useRemote } from "../ui";

const toneFor = (kind: string): string => {
  if (["error", "issue"].includes(kind)) return "bad";
  if (["repair", "finding", "document"].includes(kind)) return "good";
  if (["backoff", "status"].includes(kind)) return "warn";
  return "";
};

export default function Feed() {
  const connected = useConnected();
  const feed = useRemote(() => api.feed(80), 15000);

  if (connected === false) return <NotConnected />;

  const entries = feed.data?.feed ?? [];

  return (
    <>
      <Header title="Feed" sub="Everything your builder has been doing" state={feed.error ? "down" : "up"} />
      <div className="wrap">
        {feed.error ? <Banner kind="error">{feed.error}</Banner> : null}

        <div className="card">
          {entries.length > 0 ? (
            entries.map((entry) => (
              <div key={entry.id} className="feed-item">
                <span className={`tag ${toneFor(entry.kind)}`}>{entry.kind}</span>
                <div className="text">
                  <p>{entry.message}</p>
                  <time>{ago(entry.at)}</time>
                </div>
              </div>
            ))
          ) : (
            <div className="empty">{feed.loading ? <Busy label="Loading…" /> : "Nothing yet."}</div>
          )}
        </div>
      </div>
    </>
  );
}
