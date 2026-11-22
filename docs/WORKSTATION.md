# The workstation: resources, Gaming Mode, storage, local AI

Agent Builder manages the PC it runs on as one system: it measures what the PC is doing,
gives the PC to a game with one action and puts everything back with another, knows every
drive and what belongs on it, and runs AI locally only. Code: `src/system/`, routes in
`src/server/system.ts`, the app's **Control → This PC**, and Jarvis's `system.*`, `storage*`
and `game-mode` actions.

## Gaming Mode and Resume All

**Control → This PC → 🎮 Gaming Mode** (or Home, or "Jarvis, activate Gaming Mode"). It:

1. measures the PC (CPU, free memory, GPU, video memory, the busiest drive);
2. marks the mode first, so nothing new starts while the rest winds down;
3. pauses each workload through its own safe mechanism, and records how to undo it;
4. measures again after five seconds, so the report says what was really freed.

| Workload | How it pauses | Balanced | Maximum |
|---|---|---|---|
| Builds | at their next step (a model call or check under way finishes first) | pause | pause |
| Research topics | between reading cycles | pause | pause |
| Continuous sessions, investigations, learning, academy | each finishes its step (checks, checkpoint), then waits | pause | pause |
| Virtual Test Lab VMs | QEMU's own pause (CPU freed; memory stays reserved) | pause | pause |
| The AI model | after the answer in progress (up to 90 s): unloaded from video memory, then the model server stops so nothing reloads it mid-game | stop | stop |
| Image engine (ComfyUI) | waits for the picture being drawn (up to 2 min); never drops queued pictures in Balanced | stop when idle | stop |
| Jarvis's copy on this PC | Host Manager stop | stop | stop |
| SaveState hosting | Host Manager stop | keep | stop |
| qBittorrent, BitTorrent, rclone | lower CPU priority; in Maximum, qBittorrent's active torrents pause through its own Web UI | below normal | pause + lowest |

**Never touched:** the game and its anti-cheat, Windows and its services, Defender and other
security software, drivers, audio, input, networking, the desktop shell, and any program not in
the table. Nothing is killed mid-write: the only process ever ended is the model server, after
its answer.

**Resume All** puts back exactly what was paused, one workload at a time: the model server first
(the model loads when first asked), then Jarvis and SaveState, VMs, builds, research and sessions
(each waiting up to a minute for free memory and an unsaturated disk), the image engine, and
downloads last. The background hold stays on until the end, so the loops do not all start at once.
A step that fails is listed with **Retry**; the rest carry on. A resume cut short by a restart
finishes after the restart.

**Other profiles** (chips under the buttons): *Rendering* (your own Blender or video work: the GPU
is freed but the image engine and Jarvis stay), *Quiet* (nothing new starts, builds and research
pause, the model is unloaded but answers when asked), *AI research* and *Development* (one kind of
work gets the PC). **Hold new background work** stops anything new from starting without pausing
what runs ("Jarvis, stop new background jobs until further notice").

Every switch is in the audit (`data/system/audit.jsonl`, **Who switched what**) and is sent to Jarvis.

## Game detection

A game is a process running from one of this PC's game libraries (every Steam library's
`steamapps\common`, Epic installs, the Games/XboxGames/Ubisoft folders, `GAME_DIRS`), using at
least 150 MB, seen twice in a row (20 s). Launchers, crash reporters, installers and anti-cheat
are never counted, so closing Steam does not end a session. One long-lived PowerShell reads
process names and paths every 10 s; nothing touches the game.

Settings (Control → Game detection, or `system.gaming.set`): when a game starts, **Ask me**
(the default: the app's strip and Jarvis ask), **Switch Gaming Mode on**, or **Do nothing**; the
profile; when it closes, ask or **Resume by itself** after N minutes (3 by default).

## "Why is my computer slow?"

**Control → Right now**, `GET /api/system/why`, or `system.why`. A one-second sample of the
performance counters (CPU, memory, commit, paging, and each physical drive's idle time, queue,
throughput and latency), the processes using the most CPU, memory and disk in that second, and
the GPU. Findings name the drive and what lives on it ("E: is saturated: 0% idle, 14 waiting …
On it: Agent Builder") and the programs responsible. A sampler keeps a short history (every
minute; every five in Gaming Mode).

**Heavy background work waits for sustained pressure**: a continuous step does not start while
the drive Agent Builder works from has been saturated for two samples, or memory is nearly gone,
for at most 20 minutes (`PRESSURE_MAX_WAIT_MS`), then goes ahead and says so.

## Storage

**Control → Storage** (`storage` for Jarvis). Every disk, classified by what it is, not by its
letter: NVMe and SATA SSDs from Windows, and hard drives' speed from the model number (Windows
reports it as unknown; each disk says the speed was inferred). Game libraries and their sizes come
from Steam's and Epic's own manifests, without walking a game folder. It also shows where Agent
Builder's pieces live (code, builds, data, the models, ComfyUI, the Unity project, the WSL disk,
qBittorrent's downloads) and whether the NAS answers.

Recommendations keep SSD space for games: Agent Builder's bulk belongs on the 7,200 rpm drives,
downloads and archives on the slow drives and the NAS. **Nothing is moved or deleted from here.**
Every move is a recommendation marked *needs your approval*. Sizes are measured on request
(gently: a pause every 2,000 files). A drive's write speed can be benchmarked (128 MB, flushed,
then deleted; refused while the drive is busy).

### This PC (inventory of 22 November 2026)

| Drive | Disk | Kind | Free | On it |
|---|---|---|---|---|
| C: | Samsung 870 EVO | SATA SSD | 25 of 465 GB | Windows, WSL's disk, 8 GB of Steam |
| H: | WD SN-series | NVMe SSD | 46 of 466 GB | 372 GB of Steam games, Overcooked 2, ComfyUI's models |
| K: | SK hynix BC711 (portable) | NVMe SSD | 49 of 476 GB | 231 GB Steam, GTA V, Ghostrunner, qBittorrent's downloads |
| D: | Seagate ST1000DM010 | 7,200 rpm | 22 of 932 GB | 649 GB of Steam games, Ubisoft |
| F: | WD Blue WD10EZEX | 7,200 rpm | 46 of 932 GB | 75 GB Steam, the Ollama models |
| G: | Seagate ST1000DM003 | 7,200 rpm | 102 of 931 GB | 279 GB Steam |
| E: | Seagate ST2000LM007 | 5,400 rpm (laptop) | 108 of 1,862 GB | Agent Builder, ComfyUI, Unity levels, Blender, 107 GB Steam |
| J: | Seagate ST500LM030 (USB) | 5,400 rpm (laptop) | 37 of 466 GB | 308 GB Steam |
| N: | QNAP \\192.168.31.201\Multimedia | network | — | answers on SMB; Windows shows the mapping as disconnected |

Every SSD is nearly full of games, so Agent Builder does not belong on one; G: is the 7,200 rpm
drive with the most room. The recommendations it makes (all waiting for your approval):

1. Agent Builder's code and data work from E: (5,400 rpm): G: is the best place with room, once
   its size is measured.
2. qBittorrent downloads to K: (an SSD): J: suits them (not E:, where they would compete with the builder).
3. ComfyUI's models are on H: (an SSD meant for games): G: has room; they load a little slower, once a session.
4. C: has under 30 GB free; D: and F: are nearly full.

## Local AI only

`LOCAL_AI_ONLY` is on unless `.env` says `false` (it cannot be changed from the app or Jarvis).
While it is on, the model router refuses OpenAI, Anthropic and Gemini with an error that says so,
and a provider named anywhere (Settings, a role, customer orders) gets the local model instead.
Vector memory's OpenAI embeddings are skipped. Nothing falls back to the cloud silently.

**Research offline** (Settings, `RESEARCH_OFFLINE=true`): research searches and fetches nothing,
so nothing leaves the PC. `GET /api/system/ai-policy` (`ai.policy`) states what runs where.

## Tests

`npm run test:system` (14 checks: drive classes, recommendations, findings, pressure, game
detection, profiles, the hold, local-only, offline research, the NAS check, and two live reads of
this PC) and `npm run test:game-mode` (a real pause and resume against a throwaway model server
and a stand-in Host Manager).
