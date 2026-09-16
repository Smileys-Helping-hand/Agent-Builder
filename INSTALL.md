# Agent Builder — install and run

A desktop app that builds, tests and repairs small apps on your own hardware, and
researches topics continuously. Everything runs locally; no cloud account.

## 1. Install Ollama and a model (once)

The app thinks with a local model, so Ollama must be installed and running.

```
winget install Ollama.Ollama
ollama pull qwen2.5-coder:7b
```

Ollama runs in the background once installed (its app starts at login). On an
8 GB card `qwen2.5-coder:7b` is the right default; `qwen2.5-coder:1.5b` is
faster, `qwen2.5-coder:14b` is slower but sharper.

## 2. Install the app

Double-click **`release\Agent Builder 1.0.0 Setup.msi`**.

It installs for all users, so Windows asks for admin rights. The installer is not
code-signed, so SmartScreen shows "Windows protected your PC" — choose
**More info → Run anyway**.

## 3. First run

Launch **Agent Builder** from the Start menu. The window stays hidden for a few
seconds while its API starts, then opens on the setup screen, which asks for:

- **Workspace name** — anything, e.g. "Home".
- **Admin email and password** — your owner account. Stored locally in
  `%APPDATA%\com.agent.builder\data\users.db`; nothing is sent anywhere.
- **AI provider** — leave it on **Ollama (local, default)**.
- **API key** — leave blank. It is only for cloud providers.

After that you land on Mission Control. The app runs its own API in the
background and stops it when you close the window.

## 4. What to do with it

- **Autonomous Build** — describe an app and it generates, installs, typechecks,
  tests and repairs it until the checks pass, keeping the best-scoring attempt.
  Profiles: fast, balanced, deep (deep uses a bigger model to critique).
- **Research** — enter a topic. It keeps reading Wikipedia, arXiv, GitHub, Hacker
  News and the web, checks every finding against the page it came from, and
  rewrites its summary, study guide and report as it learns. It never stops on
  its own; pause or stop it from the same screen.
- **Search everything learned** — full-text search across every finding,
  document and lesson.

## Where things live

| What | Where |
| --- | --- |
| Accounts, research, lessons | `%APPDATA%\com.agent.builder\data` |
| The app itself | `C:\Program Files\Agent Builder` |
| Generated projects | `builds/` under the app's working directory |

Uninstall from **Settings → Apps**. That leaves the data folder; delete it by hand
to remove accounts and research.

## Ports

The API uses **4000**. Metrics (9464) and collaboration (35000) move to the next
free port if something else holds them. If port 4000 itself is taken — usually a
dev server from this repo — close that first, or the app's API cannot start and
the window opens with every panel reporting an error.

## Running from source instead

```
npm install
npm run dev:server
npm --prefix dashboard run dev -- -p 3002
```

Then open http://localhost:3002. The dev setup keeps its data in the repo's
`data/` folder, separate from the installed app.

Rebuild the installer with `npm run tauri:build` (stop the dev dashboard first —
the build rewrites `dashboard/.next`).
