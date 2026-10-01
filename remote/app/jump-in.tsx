"use client";

/**
 * The Home screen's starting points: the four things people come here to do,
 * one tap each, and whether the shop is connected. Kept small: Home already
 * shows the machine, the builds and the timeline.
 */
import Link from "next/link";

import { api } from "@/lib/api";
import { Icon, ago, useRemote } from "./ui";

const TILES = [
  { href: "/build", icon: Icon.sparkle, title: "Build something new", text: "A site, an app, a game — describe it" },
  { href: "/projects", icon: Icon.folder, title: "Carry on a project", text: "Pick up any project on this PC" },
  { href: "/projects?clone=1", icon: Icon.refresh, title: "Clone from GitHub", text: "Bring a repo in and start on it" },
  { href: "/orders", icon: Icon.list, title: "Sell a template", text: "Your shop on arpcloudsolutions.co.za" }
];

export function JumpIn() {
  return (
    <div className="jump-in">
      {TILES.map((tile) => (
        <Link key={tile.title} href={tile.href} className="jump-tile">
          <span className="jump-icon">{tile.icon}</span>
          <strong>{tile.title}</strong>
          <small>{tile.text}</small>
        </Link>
      ))}
    </div>
  );
}

/** The ordering site at a glance: connected, what is on sale, what is waiting. */
export function HubStrip() {
  const hub = useRemote(() => api.hubStatus(), 60000, "hub-status");
  const data = hub.data;
  if (!data) return null;
  const waiting = (data.counts?.received ?? 0) + (data.counts?.accepted ?? 0);
  const building = data.counts?.building ?? 0;
  const ok = data.configured && data.catalog?.ok !== false;
  return (
    <Link href="/orders" className={`hub-strip ${ok ? "ok" : "bad"}`}>
      <span className={`pill ${ok ? "up" : "down"}`} />
      <span className="hub-strip-main">
        <strong>Consolidated Hub</strong>
        <small>
          {!data.configured
            ? "Not connected — set SITE_URL and SITE_API_KEY on the PC"
            : data.catalog?.ok
              ? `${data.catalog.count} templates on sale · checked in ${ago(data.catalog.at)}`
              : `Not reaching the site${data.catalog?.failures ? ` (${data.catalog.failures} tries in a row` : ""}${
                  data.catalog?.failures ? (data.catalog.lastOkAt ? `; last got through ${ago(data.catalog.lastOkAt)})` : ")") : ""
                }${data.catalog?.message ? `: ${data.catalog.message}` : ""}`}
        </small>
      </span>
      <span className="hub-strip-counts">
        <span>
          <b>{waiting}</b> waiting
        </span>
        <span>
          <b>{building}</b> building
        </span>
      </span>
    </Link>
  );
}
