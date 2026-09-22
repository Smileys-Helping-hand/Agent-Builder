"use client";

import { api, type FeedEntry } from "@/lib/api";
import { Banner, Header, NotConnected, Skeleton, ago, dayLabel, useConnected, useRemote } from "../ui";

const toneFor = (kind: string): string => {
  if (["error", "issue"].includes(kind)) return "bad";
  if (["repair", "finding", "document"].includes(kind)) return "good";
  if (["backoff", "status"].includes(kind)) return "warn";
  return "";
};

export default function Feed() {
  const connected = useConnected();
  const feed = useRemote(() => api.feed(100), 15000);

  if (connected === false) return <NotConnected />;

  const entries = feed.data?.feed ?? [];

  // Group by day so a long list stays readable instead of being one wall.
  const days: Array<{ label: string; items: FeedEntry[] }> = [];
  for (const entry of entries) {
    const label = dayLabel(entry.at);
    const last = days[days.length - 1];
    if (last && last.label === label) last.items.push(entry);
    else days.push({ label, items: [entry] });
  }

  return (
    <>
      <Header
        title="Feed"
        sub={entries.length ? `${entries.length} recent events` : "Everything your builder does"}
        state={feed.error ? "down" : "up"}
      />
      <div className="wrap">
        {feed.error ? <Banner kind="error">{feed.error}</Banner> : null}

        {feed.loading && entries.length === 0 ? <Skeleton rows={6} /> : null}

        {days.map((day) => (
          <div key={day.label} className="card">
            <div className="day-divider">{day.label}</div>
            {day.items.map((entry) => (
              <div key={entry.id} className="feed-item">
                <span className={`tag ${toneFor(entry.kind)}`}>{entry.kind}</span>
                <div className="text">
                  <p>{entry.message}</p>
                  <time>{ago(entry.at)}</time>
                </div>
              </div>
            ))}
          </div>
        ))}

        {!feed.loading && entries.length === 0 ? (
          <div className="card">
            <div className="empty">Nothing yet. Start something and it will show up here.</div>
          </div>
        ) : null}
      </div>
    </>
  );
}
