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
| **Control** | The machine room: the coding model (how much is on the graphics card and how much in RAM, Load it now, Restart model server, the 14b / 7b switch), every service, the hardware and the Jarvis connection. |
| **All** | Every dashboard on one screen, and the button that installs the app. The **A** logo at the top of any screen opens it too. |

Feed, Settings, Help, Research, Jarvis and the prompt builder are one tap
deeper, under **All** — eight tabs is as many as stays readable across the
bottom of a phone.

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

**Also make** adds the Android app (.apk) and the Windows app (.exe), made from
the website once every check passes; a finished build can make them later too.

**How it begins** (under More options, default in Settings → Builds):

- **From my prompt** (the default) — planned and written from your words, file by
  file. Our tested games are shown to the model as examples, never copied in. A
  game still gets pictures: the model lists them before the first pass, the code
  draws a shape for each until the image engine has drawn it (src/lib/art.ts).
- **Our engine** — a game close to one of ours starts with its tested rules.
- **Our whole game** — a game that clearly matches one of ours starts as that game.

### The model on an 8 GB card

Control → *The coding model* switches between two set-ups, measured on this PC
(RTX 3060 Ti 8 GB, 32 GB RAM):

| | On the card | Loads | Writes |
| --- | --- | --- | --- |
| **qwen2.5-coder:14b, split** | 28 of 49 layers (6.2 GB), the rest from RAM | ~20 s | ~5 tokens/s |
| qwen2.5-coder:7b | all of it | ~5 s | much faster, weaker code |

Both at a 16k window with flash attention and an 8-bit KV cache, one model
loaded at a time (Jarvis included, so neither pushes the other off the card). A
32k window put only 24 layers on the card: 4.4 tokens/s and a 103 s load. Forcing
more layers than fit makes Windows page the card's memory (a load took ten
minutes), so *Layers on the graphics card* stays on Automatic.

### Jarvis

Jarvis can do anything the app can, through his bridge
(`POST /api/agent-builder/bridge`, `metadata.action`): builds from a prompt to a
passing app, carrying on and fixing, the phone and PC apps, drawing sprites,
icons and backgrounds, MediaGen, projects, research, orders, the model and
settings. `GET` on the bridge lists every action and what it takes; the Jarvis
screen shows the same list. Each action is made with his key, so it can do
nothing his key could not; keys and accounts are only changed in the app.

### Keeping track of builds

Every build is saved on the PC in `data/builds.json` as it runs, with each pass,
what every check (install, typecheck, build, tests, lint) said, and a log of what
happened. Refreshing the app, closing the phone, or restarting the builder loses
nothing; the app also keeps its last copy on the device, so it shows straight away
and says when it last heard from the PC.

- **Build** lists every build, filtered by *Building*, *Works* (every check passes)
  and *Needs a look* (failed, interrupted, or finished with a check still failing).
  Tap one for its page — its address (`/build/?id=…`) survives a refresh.
- A build page shows the live stage, each pass's checks, **why it is not passing
  yet** (the end of the failing check's output), the files it wrote, and buttons to
  open its folder in VS Code or Explorer on the PC.
- **Continue building** starts a new build in the same folder from the best code
  the last one left, told what still fails. A build interrupted by a restart comes
  back as *Interrupted* and can be continued the same way.
- A build stops by itself once passes stop getting better (Fast: 3 passes without
  a new best, Balanced: 5, Deep: 8) rather than running to its pass limit.
- The Build tab shows a badge with how many are running, and the app tells you
  when one finishes — even one that finished while it was closed.

### Watching it work

While a build runs, its page shows three bars — where this pass is (writing,
checking, fixing, scoring, improving) and for how long, how many passes it has
used, and its quality against the target — plus **what it is thinking**: its
plan, what each check said (with the error when one fails), why it made each fix
and which files it touched, and when it goes back to its best pass. The same
bars show on the Build list and on orders that are building.

### Previews

- **Templates** (under Orders): pick a template and its live site shows beside
  the list — switch between phone, tablet and desktop, or open it in a tab. The
  first time, the builder builds the template's site (about a minute); after
  that it is instant. **Rebuild** after changing a template's code.
- **Builds**: every build's page has a live preview of what it has made,
  refreshed after each pass. It shows the built site (`dist/`), or the folder
  itself for a plain static page.

Previews are served by the builder on your PC at `/preview/…` behind a link
that only opens that one preview, and they run sandboxed, so a preview's
scripts cannot touch the app. Open the built site from a server like this, not
by double-clicking `index.html`: browsers refuse to run a module script from a
file on disk, which is why that shows a blank page.

### Test, audit and fix

Click through a build's preview: any script error, failed load or
`console.error` on the page shows under it ("⚠ 2 problems on this page").
**Test & audit** (beside the preview) runs the build's checks again and reads
the built site for what a visitor would trip over — no phone layout, images
without alt text, empty buttons, unlabelled fields, dead links, files the page
loads that are not there, heavy scripts. With Chrome or Edge on the PC (or
`CHROME_PATH` set) it renders the page first, so a React app is judged by what
it draws and errors on load are caught. **Fix these in a new pass** carries on
in the same folder with every finding as the instruction.

### Editing a template live

Orders → Templates → pick one → **Customise live**: words, every colour, the
font, and the sections (drag or arrows to reorder, the eye to hide). The site in
the preview changes as you go. Choices are kept per template on the device;
**Use for a customer** starts a customer order with them as exact instructions,
which the build writes into the site.

### What it learns

Research → **What the builder has learned**: every lesson its repairs taught it,
how often each was used and how often it helped; retire one that misleads. A
build also looks up research findings that match what it was asked for (ones
you confirmed, or backed by several sources — never ones you rejected) and says
so in its thinking.

**Settings → Connection check** says which builder this device is talking to,
whether the address makes sense from here (an `127.0.0.1` address on a phone, or an
`http://` address from the https app, never works), and whether the model server
and the other services on that PC are up.

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

- **Anywhere**: **All** → *Install Agent Builder*. Installed, it opens in its own
  window, and a long-press (or right-click) on its icon goes straight to Build,
  Projects, Media, Orders, Control, Jarvis or All.
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
