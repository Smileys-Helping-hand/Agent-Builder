"use client";

/**
 * Every dashboard, one tap away, and the button that installs this app on a
 * phone or PC so it opens like any other app (its own window, its icon, and a
 * long-press menu of shortcuts straight to Build, Orders, Projects, Media,
 * Control and Jarvis).
 *
 * The PC-only ones (Jarvis on this PC, the image engine) are shown only in a
 * browser on the PC itself, where their addresses work.
 */
import Link from "next/link";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { Header, Icon, useConnected, useRemote } from "../ui";

type Tile = { href: string; label: string; hint: string; icon: JSX.Element };

const SCREENS: Tile[] = [
  { href: "/", label: "Home", hint: "Status at a glance, the power button", icon: Icon.power },
  { href: "/build/", label: "Build", hint: "Describe it; watch every pass and fix", icon: Icon.sparkle },
  { href: "/prompt/", label: "Prompt builder", hint: "Turn an idea into a brief that builds", icon: Icon.code },
  { href: "/try/", label: "Try it", hint: "Open and play what was built", icon: Icon.play },
  { href: "/projects/", label: "Projects", hint: "Every project: diagnose, repair, carry on", icon: Icon.folder },
  { href: "/studio/", label: "Media Studio", hint: "Draw sprites, icons, backgrounds; MediaGen", icon: Icon.image },
  { href: "/orders/", label: "Orders", hint: "Customer orders, from arriving to handed over", icon: Icon.list },
  { href: "/research/", label: "Research", hint: "Topics, findings and what was learned", icon: Icon.flask },
  { href: "/jarvis/", label: "Jarvis", hint: "The link both ways, his access, his log", icon: Icon.plug },
  { href: "/control/", label: "Control", hint: "The model's GPU/RAM split, services, power", icon: Icon.gear },
  { href: "/settings/", label: "Settings", hint: "Models, builds, orders, folders", icon: Icon.wrench },
  { href: "/feed/", label: "Feed", hint: "Everything that happened, newest first", icon: Icon.clock },
  { href: "/help/", label: "Help", hint: "How each screen works", icon: Icon.book }
];

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** The browser's offer to install this app, kept until the button is pressed. */
function useInstall() {
  const [offer, setOffer] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);
  useEffect(() => {
    setInstalled(window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    const onOffer = (event: Event) => {
      event.preventDefault();
      setOffer(event as InstallPrompt);
    };
    const onInstalled = () => {
      setInstalled(true);
      setOffer(null);
    };
    window.addEventListener("beforeinstallprompt", onOffer);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onOffer);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  const install = async () => {
    if (!offer) return;
    await offer.prompt();
    if ((await offer.userChoice).outcome === "accepted") setInstalled(true);
    setOffer(null);
  };
  return { offer, installed, ios, install };
}

export default function Dashboards() {
  const connected = useConnected();
  const { offer, installed, ios, install } = useInstall();
  const [onPc, setOnPc] = useState(false);
  const jarvis = useRemote(() => (connected ? api.jarvisOverview(1) : Promise.resolve(null)), 0);

  useEffect(() => {
    setOnPc(["127.0.0.1", "localhost", "[::1]"].includes(window.location.hostname));
  }, []);

  const jarvisHost = jarvis.data?.config.host ?? null;
  const elsewhere: Array<Tile & { show: boolean }> = [
    { href: jarvisHost ?? "", label: "Jarvis (Second Brain)", hint: "His own app, wherever he runs", icon: Icon.external, show: Boolean(jarvisHost) },
    { href: "http://127.0.0.1:3005", label: "Jarvis on this PC", hint: "The copy the launcher runs here", icon: Icon.external, show: onPc },
    { href: "http://127.0.0.1:8188", label: "Image engine (ComfyUI)", hint: "Where sprites are drawn", icon: Icon.external, show: onPc }
  ];

  return (
    <>
      <Header title="Dashboards" sub="Every screen, one tap away" />
      <div className="wrap">
        <section className="hero">
          <div className="hero-label">This app</div>
          <h2 className="hero-title">{installed ? "Installed on this device" : "Install it like an app"}</h2>
          <p className="hero-sub">
            {installed
              ? "It opens in its own window from your home screen or Start menu. Long-press (or right-click) its icon for shortcuts to Build, Orders, Projects, Media, Control and Jarvis."
              : ios
                ? "On an iPhone or iPad: tap Share, then Add to Home Screen."
                : offer
                  ? "One tap and it lives on your home screen or Start menu, in its own window, with shortcuts to every dashboard."
                  : "Your browser offers it from its menu (Install app, or Add to Home screen). It needs the https address or this PC's own address."}
          </p>
          {!installed && offer ? (
            <div className="quick" style={{ marginTop: 14 }}>
              <button className="primary" onClick={() => void install()}>
                {Icon.download} Install Agent Builder
              </button>
            </div>
          ) : null}
        </section>

        <div className="section-title">Agent Builder</div>
        <div className="dash-grid">
          {SCREENS.map((tile) => (
            <Link key={tile.href} href={tile.href} className="dash-tile">
              {tile.icon}
              <strong>{tile.label}</strong>
              <small>{tile.hint}</small>
            </Link>
          ))}
        </div>

        {elsewhere.some((tile) => tile.show) ? (
          <>
            <div className="section-title">Elsewhere</div>
            <div className="dash-grid">
              {elsewhere
                .filter((tile) => tile.show)
                .map((tile) => (
                  <a key={tile.label} href={tile.href} target="_blank" rel="noreferrer" className="dash-tile external">
                    {tile.icon}
                    <strong>{tile.label}</strong>
                    <small>{tile.hint}</small>
                  </a>
                ))}
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
