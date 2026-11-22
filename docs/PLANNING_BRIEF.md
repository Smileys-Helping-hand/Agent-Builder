# Agent Builder: a complete briefing for planning the next phase

This brief describes the system as of its last full check on 8 November 2026. Use it to draft a plan for what to do next.
It says what exists, how well each part actually works, the limits, and the goals.

---

## 1. What it is, in one paragraph

Agent Builder is a personal, local-first AI "software company" that runs on one Windows PC at home. It builds apps,
websites and games from a written description, and it keeps improving them for hours or days. It researches topics in
depth from real sources, and it tests what it builds in real virtual machines. It learns lessons from its own successes and
failures. A phone app and a voice/chat assistant called **Jarvis** (running on a separate laptop) control it from
anywhere. All AI work runs on a **local model** (Ollama, Qwen2.5-Coder 14B/7B) on the PC's GPU, so there are no cloud API costs.
Its rule is that work is "done" only when objective checks pass (install, typecheck, build, tests, lint, a real browser,
a real VM boot), not when a model says so.

## 2. The setup it runs on

- **PC:** Windows 10 Home, 12 cores, 32 GB RAM, 8 GB GPU.
  - The project lives on **E:, a 2 TB 5,400 rpm laptop hard drive**. That drive is also shared with torrents and rclone sync,
    and it is the biggest performance bottleneck: boots take 5–20 minutes and there are freezes of up to two minutes.
  - SSDs exist on C:, K: (NVMe) and H:.
- **Backend:** Node/TypeScript (Express) on port 4000, kept alive by a PowerShell launcher with a watchdog. A Host Manager
  service on port 4100 restarts things.
- **Model server:** Ollama/llama-server. The 14B model splits between the GPU and RAM, and only one model fits at a time.
- **Front end:** a Next.js app (static export), served by the builder itself and also hosted on Vercel at
  builder.arpcloudsolutions.co.za. It reaches the PC through a Cloudflare tunnel. Requests over the tunnel die at
  100 s, so long work is asynchronous and polled.
- **Jarvis:** a separate project on a laptop (reached over Tailscale). It has about 130 actions that drive every part of Agent
  Builder, and it keeps a task list that Agent Builder updates.
- **Other local tools:**
  - ComfyUI (SDXL) for images
  - Blender and Unity for 3D levels
  - WSL2 with QEMU for VMs (emulated CPU, no hardware acceleration on Windows 10)
  - headless Chrome for browser tests
- **Code:** GitHub, branch `main`. The owner works by giving prompts and expects features built end to end and kept live.

## 3. Everything it can do

### 3.1 Build apps and websites (Build)
- Describe an app, and it plans, generates, installs, typechecks, builds, tests and lints it.
- It repairs what fails until the checks pass, scores each attempt and keeps the best one.
- You can steer a running build, and pause, resume, preview, download or continue it.
- **Databases for built apps:** you choose Supabase, Firebase, PocketBase, Appwrite, your own API, or browser storage.
  The app ships with the data code and a "Connect a database" panel where the client pastes their own keys.
- A **fix playbook** records each error it learned to fix (why it happens, what fixes it, and its track record).
- **Reinforcement learning** (Thompson sampling) chooses between planning approaches for each kind of app, and the reward is the build score.

### 3.2 Keep building for hours or days (Continuous Builder)
- A "session" takes a goal, writes a roadmap of milestones and works through them step by step. After each step it runs
  the project's checks; failed steps are fixed or set aside.
- Changes to your real project folder only land when **you approve** a delivery.
- **Each step writes a breakdown:**
  - what it did
  - what changed (files and lines, taken from git)
  - the result
  - what it learned
  - one thing to do differently next time

  The next steps are given the last four breakdowns, and corrections become lessons.
- It can **improve itself**: sessions run on Agent Builder's own code, and changes still need approval.
- It can require an OS to actually boot and pass tests in a VM before a milestone counts.
- Safeguards:
  - it pauses heavy work when disk space is low (under 3 GB free)
  - the launcher won't restart a builder that is only waiting on the disk

### 3.3 Make games (Game Studio)
- **Continuous games:** describe a game, and it makes it in studio phases:
  1. pre-production (a design document and an art bible)
  2. a vertical slice at final quality
  3. content, animation, sound, menus and saving
  4. alpha, beta, a release candidate, then live updates
- **Engines and assets:**
  - Real engines: Phaser 3 for 2D, three.js for 3D.
  - Art is drawn locally by ComfyUI/SDXL, and sound is synthesised in code.
  - Strict asset rules: nothing loaded from the internet, only free or original sources, and no names taken from other people's games.
- **Every milestone becomes a playable version.** Each one is QA'd in a real browser: it must load with no script errors and must
  draw, and a screenshot is taken. Versions can be:
  - played in the app (▶ Play on every game card)
  - opened by link
  - downloaded as a zip
  - built into a Windows .exe (Electron)
  - placed on the shelf in SaveState, the owner's game hub
- **Online multiplayer kit:** rooms with join codes, a host-run shared state, host hand-over, and reconnects. Agent
  Builder hosts the relay, so a link shared through the tunnel is already an online game.
- **Unity Level Studio:** describe a level and get a Unity scene (terrain, water, sky, props, enemies, a HUD), built through
  Blender models and Unity batch mode, with an optional Windows build.
- **Roblox tools:** Lua game scaffolds, NPC scripts, a terrain generator, and Studio sync.
- **Games in production now:** *Lanternfall* (a 2D action-platformer) and *Driftworks* (a 3D hover-racer with online races).
  On 8 November they had not yet produced a version: repeated watchdog restarts on the slow disk kept sending them back to
  planning. That has been fixed.

### 3.4 Research (Research)
- **Topics:** continuous research on any subject. Its sources include:
  - Wikipedia and the web
  - arXiv, OpenAlex (about 250M papers) and Europe PMC
  - GitHub and Hacker News
- **Grounded findings:** each finding is checked against its source text and labelled by credibility (academic, reference,
  news, practitioner, speculative, fiction).
- **It writes study documents and courses:** lessons, quizzes, flashcards on spaced repetition, and study packs.
- **Deep investigations** take an objective (for example "how do plants communicate?") and work through it:
  1. It plans specialists (each with questions and the evidence they need), variables and hypotheses.
  2. The specialists research. When they find little, they re-plan with new searches.
  3. Sandboxed computed experiments run, but only when grounded in cited findings.
  4. It lists contradictions side by side.
  5. Each question and hypothesis gets an answer with a verdict (supported, refuted, contested, not answered) and a
     confidence that is computed from the evidence, not asked of the model.
  6. It writes a synthesis in which every claim cites its findings. With too little evidence, it honestly says it couldn't answer.
- Investigations running: "How do plants communicate?" and "the best-tasting coffee".

### 3.5 Learn and measure (Agent tab)
- **Lessons** go from candidate to verified (proven by use) to deprecated, and you can verify or reject them.
- **Learning Centre:** all knowledge, by status and source, and who used what.
- **Evaluations:** fixed benchmarks with code graders, run with and without the learned knowledge. One runs every day.
- **Reconstructor:** it studies an existing app (your project, a public Git repo, or a live website), rebuilds it from a blueprint
  without seeing the code, measures feature coverage, and turns what it missed into lessons. It repeats until it covers 85%.
- **Supporting views:**
  - Iteration Explorer: every step's diff, checks and breakdown, with two-way comparison
  - evidence ledger and Knowledge Graph
  - Agent Activity
  - Simulation Lab: experiments plus an optimiser
- **Template Academy:** it practises new site templates until they graduate, then lists them for sale.
- **RL training data export:** SFT and DPO JSONL files, for fine-tuning the model later.

### 3.6 Test in real VMs (Lab)
- QEMU VMs in WSL. You can:
  - create, start, stop, snapshot and clone them
  - open a live console with keyboard and mouse
  - take screenshots and read the screen with OCR ("What does it say?")
  - record video and use the serial terminal
- **Agent-run test profiles:** 14 profiles plus custom ones, covering boot, login, commands, keys, clicking by on-screen
  label, evidence for each step, and reproducing a failure.
- **Limits:** emulated CPU, so a desktop takes about 4 minutes to boot. WSL sometimes can't start when memory is committed
  elsewhere; a `.wslconfig` memory cap is needed.

### 3.7 NexusOS (its own Linux distribution, a separate repo)
- A real bootable live ISO (Debian base, XFCE) with an installer, built by debootstrap and squashfs scripts.
- **Version 0.3.0 has its own look:**
  - the Arc-Dark theme, Papirus icons and the Inter font
  - a slim translucent top bar and a Plank dock
  - a custom wallpaper, login screen and dark terminal
  - a design system document
- A continuous session keeps building it (30 of 48 milestones), and the VM Lab boots and tests each ISO.
- **Weak spots:**
  - The visual identity is still mostly a themed XFCE.
  - Its own apps (Control Center, safety layer, updater) are early.
  - 0.3.0 has not yet been booted in the VM because WSL couldn't start.

### 3.8 Customer orders (Orders)
- It connects to the owner's business site (arpcloudsolutions.co.za) and publishes what the PC can build.
- Customers order or pay there, and the PC polls and picks up the order. It builds, checks and repairs it; the owner hands
  it over with one tap. It then keeps improving what it delivered.
- **Nothing reaches a customer without the owner pressing a button.**

### 3.9 Media (Media / Studio)
- **Images:** generated, edited and enhanced through ComfyUI. It also produces art packs for games, and an art library.
- **Other assets:** 3D asset generation through Blender, and sound generation.
- **Prompting help:** a prompt-crafting helper and a "super prompter".

### 3.10 The whole machine (Projects, Ecosystem)
- It keeps a live picture of every project on the drives: git state, uncommitted work, GitHub issues, PRs and CI, open
  problems, and lessons.
- **For agents:**
  - a "handoff" briefing so any agent (Jarvis, Claude, others) can pick up where work stopped
  - a context pack per project
  - Diagnose and Repair for a project
  - AI-session awareness: it reads past Claude and Gemini session histories
- **Screens:** see and control the PC's and the laptop's screens from the phone.
- **Invites studio:** it monitors and requests templates for the owner's event-invitations platform.

### 3.11 Control and operations (Control, Home)
- Service status, and model load and restart (showing the GPU/RAM split).
- **Game Mode:** pauses everything (builds, research, the model) so the owner can play games, then resumes it all.
- Restart, logs, self-update, and a low-disk banner.
- Install the app on a phone like a native app, and sign in with a QR code.
- **Security:** agent keys with scopes (read, write, execute), stored hashed. The API listens only on the PC itself by default.

## 4. How the parts connect

```
Owner (phone app, Jarvis voice/chat, business site orders)
        │ goals, notes, approvals
        ▼
Research & Investigations ──findings──► Builders (apps, continuous sessions, games, NexusOS)
        ▲                                        │ every step: checks, browser QA, VM tests
        │                                        ▼
  Learning loop ◄── lessons, breakdowns, fixes ── Iterations / evidence ledger
        │
        └──► Evaluations (does the knowledge actually help?) · Reconstructor (learn by rebuilding)
```

## 5. Honest status: what works, what doesn't

**Proven by tests:**
- The machinery all works:
  - the full typecheck is clean
  - research tests pass (48/48), as do the investigation, iteration, game director and acceptance suites
  - the browser UI check passes 13 of 14; the one failure was a 45 s disk timeout
- Games load and play in the app, VMs boot and run tests, and NexusOS builds a bootable ISO.

**Weak or unproven:**
- **The local model's quality is the main ceiling.** The machinery works, but what a 14B coding model produces is often weak:
  - The first self-improvement session finished 0 of 12 milestones.
  - Continuous sessions frequently get stuck on syntax errors.
- **The learned knowledge currently hurts:** evaluations score 0.6 with it and 0.8 without it. Lesson retrieval and quality need work.
- **The games have produced no versions yet.** They were blocked by restart loops and are now progressing.
- **Research** worked only after relevance bugs were fixed on 8 November. Its first coffee report had invented conclusions from zero
  evidence; that report was withdrawn, and the engine now refuses to conclude on thin evidence.
- **The PC is the bottleneck:**
  - E: is a slow laptop hard drive shared with downloads.
  - Memory pressure (ComfyUI SDXL plus the model plus WSL) blocks WSL.
  - Only one model fits in the GPU at a time.
  - VMs are CPU-emulated.
- **The UI is functional but dense.** The owner wants much stronger visual design, both in the app and in NexusOS.
- **Not done:**
  - native game engines (Godot, Unity export) for continuous games
  - a signed installer
  - vision: agents read text on a screen but can't judge whether something looks right
  - private memory per agent

## 6. What the owner wants (in their words, condensed)

- **Finished work:** everything finished, live, optimised and error-free, without having to babysit it.
- **Games:** it should "genuinely pump out full, company-made games with proper processes": real studio quality, not demos.
- **Research:** it should research and "crack" real questions with proper evidence, and learn from them.
- **Learning:** it should learn from every run and visibly apply what it learned.
- **Visuals:** a major visual upgrade, for NexusOS ("plain and bland") and the visual builder.
- **Jarvis:** Jarvis gets every feature and can drive everything by voice or chat.
- **Building style:** build from prompts, not templates.
- **Business:** earn through the business site (orders, template sales, the invites platform).

## 7. Questions the plan should answer

1. **Hardware first?** Should Agent Builder move to an SSD (K:/H:), with WSL memory capped and torrents/rclone moved off E:?
   This probably matters more than any code change.
2. **Model strategy:** stay fully local (bigger model, better quantisation, a second GPU), or allow a cloud model for
   planning, review and hard fixes while keeping bulk work local? What is the cost and quality trade-off?
3. **Make learning help:** how should lessons be retrieved, filtered and evaluated so that knowledge raises evaluation scores instead
   of lowering them?
4. **Game quality bar:** what does "company-made" mean in measurable terms (a playtest checklist, a visual review, retention-style
   metrics)? Should continuous games add Godot or Unity?
5. **Visual capability:** how should it gain design judgement? Options include screenshot review by a vision model, a design system the
   builders must follow, and reference boards.
6. **Focus:** which few areas deserve the next month: games, the orders business, research, NexusOS or Jarvis?
   What should be paused?
7. **Reliability:** what monitoring and guarantees are needed so it runs unattended for days without stalls or bad output?
8. **Revenue:** how should finished apps, templates and games turn into income through arpcloudsolutions.co.za and SaveState?

Please produce a phased plan (next 2 weeks, next 1–2 months, after that), with priorities, concrete deliverables,
success metrics for each phase, risks, and what to stop doing.
