# Remote app — run your builder from anywhere

**Live at: https://agent-builder-remote.vercel.app**

The app is the interface. Everything actually runs on your PC — building,
researching, repairing. The app just shows you what is happening and tells the PC
what to do.

## Everyday use

### On the PC: double-click **Start Agent Builder**

It is on your desktop (run `Install Autostart.cmd` once to put it there, and to
start it automatically whenever you log in). It:

1. starts the local model,
2. starts the builder,
3. opens a tunnel so your phone can reach the machine from anywhere,
4. prints a **QR code**.

Scan that code with your phone's camera. The app opens already connected — no
typing an address, no pasting a 67-character key.

Leave the window open; closing it stops what it started. **Stop Agent Builder**
does the same thing from a shortcut.

### On the phone

| Screen | What it is for |
| --- | --- |
| **Home** | The power button, troubleshooting, live status, and the latest activity. |
| **Projects** | Every project on the machine. Tap for a briefing, or run Diagnose / Repair. |
| **Research** | Start a topic, watch findings accumulate, pause or resume. |
| **Feed** | Everything that has happened, newest first. |
| **Settings** | Connection, how this works, and shutting the builder down. |

Three buttons that are easy to confuse:

- **Switch everything on** — starts the model, resumes research, refreshes projects.
- **Pause work** — stops research and the project sweep so the GPU is free. The
  builder stays reachable.
- **Shut down** (in Settings) — stops the builder completely. Nothing in the app
  can start it again; you need the launcher on the PC.

## Install it as an app

- **Android / desktop Chrome or Edge**: open the site, menu → *Install app*.
- **iPhone**: Share → *Add to Home Screen*.
- **Android APK**: `release/Agent Builder.apk`. Copy it to the phone and open it
  (allow installing from unknown sources). Unsigned debug output — fine for your
  own device, not for distribution. Rebuild with
  `cd remote/android && ./gradlew assembleDebug`.

## Reaching your machine

The launcher's tunnel is the zero-effort option, but there are three:

| Option | How | Trade-off |
| --- | --- | --- |
| **Cloudflare tunnel** (what the launcher uses) | Automatic. | The address changes every restart, so rescan the QR. The address is public — your key is what protects it. |
| **Tailscale** | Install on PC and phone, same account; use the `100.x.y.z:4000` address. | Nothing is exposed to the internet, and the address never changes. Needs the app on both devices. |
| **Home Wi-Fi** | The PC's LAN address; start the API with `HOST=0.0.0.0`. | Only works at home. |

The launcher isolates its tunnel from `~/.cloudflared/config.yml` deliberately:
that config routes savestate.co.za and answers 404 to everything else, which a
quick tunnel would otherwise inherit.

## Keys

The launcher mints one for your phone on first run and keeps it in
`data/phone-key.txt`, so the QR keeps working across restarts. To make one by
hand, or for another device:

```
npm run key:agent -- --name phone --scopes read,write,execute
```

`--list` shows what exists, `--revoke` kills one, rerunning rotates it. Scopes:
`read` looks, `write` reports issues and rescans, `execute` runs diagnoses and
repairs.

## Hosting it yourself

Already deployed, but to redeploy or fork it: the app is a static export with no
server side, so no secret ever reaches the host.

```
cd remote
vercel deploy --prod
```

Or in the Vercel dashboard: New Project → this repo → **Root Directory: `remote`**.

Locally: `npm --prefix remote run dev -- -p 3003`.

## Limits worth knowing

- **A phone cannot wake a sleeping PC.** The machine has to be on with the
  builder running. Autostart plus leaving the PC awake is the way around it.
- **The power button starts what surrounds the builder**, not the builder itself —
  that is the thing answering your request.
- **A free tunnel gets a new address every restart.** Rescan the QR, or use
  Tailscale for a fixed one.
- **Repairs take minutes** and run on the PC. Leave the screen; check the Feed.
- **The key is the credential.** It lives in your device's browser storage and is
  sent as a header. Treat it like an SSH key; rotate it if it leaks.
