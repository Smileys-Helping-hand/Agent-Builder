# Remote app — run your builder from anywhere

**Live at: https://builder.arpcloudsolutions.co.za** (also https://agent-builder-remote.vercel.app).
The subdomain is an `A` record, host `builder`, value `76.76.21.21`, in the Route 53 zone for `arpcloudsolutions.co.za`.

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

### On the PC itself: **Open Agent Builder**

Opens the app in your browser at `http://127.0.0.1:4000`, already connected,
starting the builder first if it is not running. The builder serves the app
itself, so this needs no internet and no Vercel. Opening that address in any
browser on the PC does the same.

Only a browser on the PC is connected automatically. The public address
(`https://agent.savestate.co.za`) serves the same app but never hands out the
key; there you connect with the QR code or by pasting the key.

A build that needs the local model starts it if it is not running.

### On the phone

| Screen | What it is for |
| --- | --- |
| **Home** | Status at a glance, the power button, and one-tap troubleshoot / pause / scan. |
| **Build** | Describe an app or site and it gets built. Watch each pass, and tell it things while it works. |
| **Orders** | Customer orders, from arriving to handed over. See [ORDERS.md](ORDERS.md). |
| **Projects** | Every project, filtered by what needs a look. Tap for a briefing, Diagnose or Repair. |
| **Research** | Start a topic, watch findings accumulate, pause or resume. |
| **Control** | The machine room: every service, the hardware, the Jarvis connection, and the way to Feed, Settings and Help. |

Feed, Settings and Help moved one tap deeper, under **Control** — six tabs is
as many as stays readable across the bottom of a phone.

Three buttons that are easy to confuse:

- **Switch everything on** — starts the model, resumes research, refreshes projects.
- **Pause work** — stops research and the project sweep so the GPU is free. The
  builder stays reachable.
- **Shut down** (Control) — stops the builder completely. Nothing in the app can
  start it again; you need the launcher on the PC.

## Building something from your phone

**Build** → give it a name and describe what you want → pick how hard it should
try → **Build it**. It writes the code, runs the tests, fixes what fails and goes
round again, raising the quality score each pass.

While it runs you can **send it an instruction**. It joins the prompt from the
next pass and stays there for the rest of the build, so it is standing direction
rather than a one-off. Pause frees the GPU without losing the work; Stop ends it.

You can close the app. The build keeps going on the PC.

## Carrying on with a project

**Projects** → the project → **AI Coder & Build** → say what to do next → **Carry on**.

It never works in the project itself. It copies the project as it is right now
(uncommitted work included, `node_modules` and other ignored files left out),
builds on the copy, and shows the result underneath as **Work on this project**:

- **View changes** shows exactly what it changed.
- **Apply to project** writes those changes into the project, one file at a
  time, and only where the file is still what the build started from. A file you
  edited in the meantime is left as you left it and listed as skipped. Nothing is
  committed; the changes are ordinary edits for you to look at, commit or undo.

A carry-on is a bounded job: up to three passes, then it stops.

## Cloning from GitHub

**Projects** → **Clone from GitHub** → the repository address. It is cloned into
`E:\Projects` and appears in the list. Say what it should do first and it
starts carrying on straight away. Private repositories work once GitHub is
signed in on the PC (for example `gh auth login`); the clone never waits for a
password prompt.

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

The Vercel project `agent-builder-remote` is connected to this repository with
**Root Directory: `remote`**: every merge to `main` deploys the app to
https://builder.arpcloudsolutions.co.za, and every pull request gets a preview.

The app is a static export with no server side and needs **no environment
variables**. Keep it that way: anything put in Vercel's environment, or written
into the app's code, ends up in files every visitor downloads. The key lives
only in each device's browser, put there by the QR code or pasted in Settings.

To fork it: in the Vercel dashboard, New Project → this repo → Root Directory `remote`.

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
