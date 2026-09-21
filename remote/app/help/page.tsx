"use client";

import Link from "next/link";

import { Header } from "../ui";

export default function Help() {
  return (
    <>
      <Header title="How this works" sub="In plain language" />
      <div className="wrap">
        <div className="card">
          <h2>The short version</h2>
          <p className="hint" style={{ marginBottom: 0 }}>
            Everything actually happens on your PC — building apps, researching, fixing projects. This app is just the
            remote control. Nothing runs here, and nothing is stored here except the address of your machine and your
            key.
          </p>
        </div>

        <div className="section-title">Starting up</div>
        <div className="card">
          <h2>On the PC: double-click “Start Agent Builder”</h2>
          <p className="hint">
            It is on your desktop. It starts the model, the builder, and (if you asked for it) a tunnel so this app can
            reach the PC from anywhere. It then shows a QR code — scan it with your phone and this app connects itself.
          </p>
          <div className="row">
            <span className="pill up" />
            <div className="body">
              <strong>Leave the window open</strong>
              <span>Closing it stops the builder. Minimise it instead.</span>
            </div>
          </div>
          <div className="row">
            <span className="pill up" />
            <div className="body">
              <strong>Want it always ready?</strong>
              <span>Run “Install autostart” once and it starts whenever you log in.</span>
            </div>
          </div>
        </div>

        <div className="section-title">Using it from here</div>
        <div className="card">
          <div className="row">
            <span className="pill up" />
            <div className="body">
              <strong>Switch everything on</strong>
              <span>The big button on Home. Starts the model, resumes research, refreshes your projects.</span>
            </div>
          </div>
          <div className="row">
            <span className="pill degraded" />
            <div className="body">
              <strong>Pause background work</strong>
              <span>Stops research and the project sweep so the GPU is free. The builder stays reachable.</span>
            </div>
          </div>
          <div className="row">
            <span className="pill down" />
            <div className="body">
              <strong>Shut down</strong>
              <span>
                Stops the builder completely. Only do this at a PC you can get to — nothing here can start it again.
              </span>
            </div>
          </div>
          <div className="row">
            <span className="pill up" />
            <div className="body">
              <strong>Troubleshoot</strong>
              <span>Tells you what is wrong and the exact command that fixes it.</span>
            </div>
          </div>
        </div>

        <div className="section-title">Getting work done</div>
        <div className="card">
          <div className="row">
            <span className="pill up" />
            <div className="body">
              <strong>Projects</strong>
              <span>
                Every project on your machine. Tap one for a briefing — what it is, what is unfinished, what to do next.
                Diagnose runs its tests; Repair tries to fix what failed, on its own branch, never touching your work.
              </span>
            </div>
          </div>
          <div className="row">
            <span className="pill up" />
            <div className="body">
              <strong>Research</strong>
              <span>Type a topic. It reads and keeps reading, and writes study notes you can come back to.</span>
            </div>
          </div>
          <div className="row">
            <span className="pill up" />
            <div className="body">
              <strong>Feed</strong>
              <span>Everything that has happened, newest first. Check here after leaving something running.</span>
            </div>
          </div>
        </div>

        <div className="section-title">When it says offline</div>
        <div className="card">
          <p className="hint" style={{ marginBottom: 10 }}>In order, the usual causes:</p>
          <div className="row">
            <span className="pill degraded" />
            <div className="body">
              <strong>The PC is asleep or off</strong>
              <span>Nothing here can wake it. Wake it and run the launcher.</span>
            </div>
          </div>
          <div className="row">
            <span className="pill degraded" />
            <div className="body">
              <strong>The tunnel address changed</strong>
              <span>
                A free tunnel gets a new address each time it starts. Scan the new QR code, or copy the address from the
                launcher window into Settings.
              </span>
            </div>
          </div>
          <div className="row">
            <span className="pill degraded" />
            <div className="body">
              <strong>You are on mobile data and using a home address</strong>
              <span>A 192.168.x.x address only works on your own Wi-Fi.</span>
            </div>
          </div>
        </div>

        <div className="card">
          <Link href="/settings">
            <button className="btn primary">Open settings</button>
          </Link>
        </div>
      </div>
    </>
  );
}
