# Remote app — run your builder from anywhere

**Live at: https://agent-builder-remote.vercel.app**

The app is the interface. Everything actually runs on your PC — building,
researching, repairing. The app shows you what is happening and tells the PC what
to do.

## Everyday use

### On the PC: double-click **Start Agent Builder**

It is on your desktop (run `Install Autostart.cmd` once to put it there and to
start it whenever you log in). It:

1. starts the local model,
2. starts the builder,
3. works out the best address for your phone to reach this machine,
4. prints a **QR code**.

Scan that code with your phone's camera. The app opens already connected — no
address to type, no 67-character key to paste.

Leave the window open; closing it stops what it started. **Stop Agent Builder**
does the same from a shortcut.

### On the phone

| Screen | What it is for |
| --- | --- |
| **Home** | Status at a glance, the power button, and one-tap troubleshoot / pause / scan. |
| **Projects** | Every project, filtered by what needs a look. Tap for a briefing, Diagnose or Repair. |
| **Research** | Start a topic, watch findings accumulate, pause or resume. |
| **Feed** | Everything that has happened, grouped by day. |
| **Settings** | Connection, how it all works, and shutting the builder down. |

Three buttons that are easy to confuse:

- **Switch everything on** — starts the model, resumes research, refreshes projects.
- **Pause work** — stops research and the project sweep so the GPU is free. The
  builder stays reachable.
- **Shut down** (Settings) — stops the builder completely. Nothing in the app can
  start it again; you need the launcher on the PC.

## Reaching your machine

**Tailscale is what you want**, and the launcher uses it automatically once it is
set up: a tailnet address never changes, so the QR keeps working and the app
stops asking you to reconnect.

```
winget install tailscale.tailscale     # accept the Windows permission prompt
tailscale up                           # sign in once, in the browser it opens
```

Do the same on the phone (Tailscale from the app store, same account). After
that, Start Agent Builder detects it, binds the builder so the tailnet can reach
it, and puts the stable `http://100.x.y.z:4000` address in the QR.

| Option | How | Trade-off |
| --- | --- | --- |
| **Tailscale** (preferred) | Installed and signed in on both devices; the launcher picks it up. | Address never changes and nothing is exposed to the internet. Needs the app on both. |
| **Cloudflare tunnel** (fallback) | Automatic when Tailscale is not set up. | Works anywhere with no setup, but the address changes each restart, so rescan the QR. |
| **Home Wi-Fi** | The PC's LAN address; start the builder with `HOST=0.0.0.0`. | Only works at home. |

The launcher isolates its tunnel from `~/.cloudflared/config.yml` deliberately:
that config routes savestate.co.za and answers 404 to everything else, which a
quick tunnel would otherwise inherit.

## Install it as an app

- **Android / desktop Chrome or Edge**: open the site, menu → *Install app*.
- **iPhone**: Share → *Add to Home Screen*.
- **Android APK**: `release/Agent Builder.apk`. Copy it to the phone and open it
  (allow installing from unknown sources). Unsigned debug output — fine for your
  own device, not for distribution. Rebuild with
  `cd remote/android && ./gradlew assembleDebug`.

## Keys

The launcher mints one for your phone on first run and keeps it in
`data/phone-key.txt`, so the QR keeps working across restarts. By hand, or for
another device:

```
npm run key:agent -- --name phone --scopes read,write,execute
```

`--list` shows what exists, `--revoke` kills one, rerunning rotates it. Scopes:
`read` looks, `write` reports issues and rescans, `execute` runs diagnoses and
repairs.

## Hosting it yourself

Already deployed, but to redeploy or fork it — the app is a static export with no
server side, so no secret ever reaches the host:

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
- **A free tunnel gets a new address every restart.** Tailscale fixes this
  permanently.
- **Repairs take minutes** and run on the PC. Leave the screen; check the Feed.
- **The key is the credential.** It lives in your device's browser storage and is
  sent as a header. Treat it like an SSH key; rotate it if it leaks.
