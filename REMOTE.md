# Remote app — run your builder from anywhere

A small web app that talks to the Agent Builder on your PC. Host it on Vercel,
install it on your phone and desktop, and you can check on everything, switch the
services on, and start work from wherever you are.

It is in `remote/`.

## What it does

- **Home** — a power button that switches everything on, a troubleshoot button
  that tells you what is wrong in plain language, live service status, GPU and
  disk, and the latest activity.
- **Projects** — every project on your machine with its branch, uncommitted and
  unpushed counts. Tap one for a full briefing, or run Diagnose / Repair.
- **Research** — start a topic, see findings as they accumulate, pause or resume.
- **Feed** — everything the builder has been doing, newest first.
- **Settings** — where your machine lives and the key to reach it.

## The one thing to understand

Your PC's API listens on `127.0.0.1` — only that machine can reach it. Hosting the
page on Vercel does not change that: the page runs in *your phone's* browser and
talks straight to *your PC*. So the phone needs a path to the PC. Pick one:

| Option | How it works | Trade-off |
| --- | --- | --- |
| **Tailscale** (recommended) | Install on PC and phone, same account. Use the PC's tailnet address, e.g. `http://100.x.y.z:4000`. | Nothing is exposed to the internet. Needs the app on both devices. |
| **Cloudflare Tunnel** | `cloudflared tunnel --url http://127.0.0.1:4000` prints an `https://…trycloudflare.com` address. | Works on any network with no client app, but the address is public — your agent key is the only thing protecting it. |
| **Home Wi-Fi** | The PC's LAN address, e.g. `http://192.168.1.20:4000`. Start the API with `HOST=0.0.0.0`. | Only works at home. |

Whichever you choose, you paste that address plus a key into Settings once, and
the device remembers it.

## Deploy to Vercel

The app is a static export — there is no server side, so no secret ever reaches
Vercel.

1. Push this repository to GitHub.
2. In Vercel: **New Project** → pick the repo.
3. Set **Root Directory** to `remote`.
4. Framework preset: Next.js. Leave the build command and output directory alone.
5. Deploy.

Nothing else to configure: the app asks for your machine's address on first run.

Locally: `npm --prefix remote run dev -- -p 3003`.

## Get a key

On the PC, in the Agent Builder folder:

```
npm run key:agent -- --name phone --scopes read,write,execute
```

It prints the key once. Paste it into Settings. Rerun the command to rotate it,
which stops the old one working immediately. `--list` shows what exists,
`--revoke` kills one.

Scopes: `read` sees everything, `write` reports issues and rescans, `execute`
runs diagnoses and repairs. A phone that should only look gets `read`.

## Install it as an app

- **Android / desktop Chrome or Edge**: menu → *Install app*.
- **iPhone**: Share → *Add to Home Screen*.
- **Android APK**: `remote/android` is a Capacitor wrapper around the same build.
  `cd remote/android && ./gradlew assembleDebug` produces
  `app/build/outputs/apk/debug/app-debug.apk`. Copy it to the phone and open it
  (allow installing from unknown sources). It is unsigned debug output — fine for
  your own device, not for distribution.

Installed, it runs full screen with its own icon, and the interface still loads
without a signal (the data needs your machine, of course).

## Security

- **The key is the credential.** It is sent as an `x-agent-key` header and stored
  only in that device's browser storage.
- **CORS** allows any origin *for key-authenticated requests*, which is what lets
  a page hosted on Vercel talk to your machine. A page without the key can do
  nothing, and no cookies are involved, so there is nothing to ride on.
- **Over a tunnel, the address is public.** Treat the key like an SSH key: rotate
  it if you paste it somewhere you should not have.
- The API still binds loopback by default. Only `HOST=0.0.0.0` changes that, and
  then only inside your LAN.

## Limits worth knowing

- **The PC has to be awake and the API running.** A phone cannot start a sleeping
  machine. Keep the desktop app running, or set the API to start with Windows.
- **The power button starts what surrounds the API** — the model server, research,
  the project sweep. It cannot start the API itself; the API is what answers the
  request.
- **Repairs take minutes** and run on the PC. You can leave the screen; come back
  to the Feed.
- **iPhone home-screen apps** get no background notifications here — you check the
  app, it does not ping you.
