# Storage migration plan (for approval; nothing here has been done)

Three moves the storage inventory recommends (docs/WORKSTATION.md). Each keeps SSD space for games. None is executed
without the owner's approval; each has a backup and a rollback. Sizes measured 22 November 2026 unless marked.

## 1. qBittorrent's downloads: K: (NVMe SSD) → J: (USB 5,400 rpm hard drive)

| | |
|---|---|
| Source | `K:\SaveState\downloads` — **61.9 GB** (measured) |
| Destination | `J:\SaveState\downloads` (J: has 36.5 GB free) — **does not fit whole.** Alternatives: E: (108 GB free, but it is the drive Agent Builder works from and downloads there are what froze it), or move only finished downloads to the NAS and point new downloads at J:. |
| Gain | 61.9 GB of SSD back for games; constant download writes off the SSD. Downloads are network-bound, so a hard drive costs them nothing. |
| How | Pause all torrents in qBittorrent; Options → Downloads → Default Save Path → `J:\SaveState\downloads`; for existing torrents, select them → Set location (qBittorrent moves the files and keeps seeding); resume. Copy-then-delete is done by qBittorrent per torrent. |
| Backup | None needed beyond the files themselves; qBittorrent only removes a source after the copy completes. |
| Rollback | Set location back to `K:\SaveState\downloads`. |
| Recommended | **New downloads to J: now; existing finished ones to the NAS** (`N:` once the mapping is reconnected), since J: cannot hold all 62 GB. |

## 2. ComfyUI's models: H: (NVMe SSD) → G: (7,200 rpm hard drive)

| | |
|---|---|
| Source | `H:\ComfyUI-Models` — **15.4 GB** (measured) |
| Destination | `G:\ComfyUI-Models` (G: has 101.8 GB free) |
| Gain | 15.4 GB of SSD back for games. |
| Cost | A model loads more slowly the first time in a session (about 15 s instead of a few, at ~150 MB/s); generation speed is unchanged once loaded (it runs on the GPU). |
| How | Stop the image engine (Control → it stops with Gaming Mode, or the Host Manager); `robocopy H:\ComfyUI-Models G:\ComfyUI-Models /E /COPY:DAT /R:1 /W:1`; compare file counts and total size; point ComfyUI at G: (its `extra_model_paths.yaml`, and `COMFY_MODELS_PATH` in Agent Builder's `.env`); draw one picture to confirm; then delete `H:\ComfyUI-Models`. |
| Backup | The H: copy is kept until a picture has been drawn from G:. |
| Rollback | Point the paths back at `H:\ComfyUI-Models` (still there until the last step). |

## 3. Agent Builder: E: (5,400 rpm laptop drive) → G: (7,200 rpm)

| | |
|---|---|
| Source | `E:\Projects\Agent-Builder` — size being measured (`storage.measure repo`); the code itself is ~5 MB, git ~11 MB; `builds/` (every build and session work copy, with their node_modules) and `data/` are the bulk. |
| Destination | `G:\Projects\Agent-Builder` (G: has 101.8 GB free). Must leave G: at least 20 GB free after the copy. |
| Gain | The builder's disk freezes (5–20 minute boots, 2-minute stalls) came from E: being a laptop drive shared with downloads. A 7,200 rpm desktop drive roughly doubles random-access throughput; boots and installs should be markedly faster. Not an SSD: SSD space stays for games. |
| Order | Move only the active parts first: the repository and `data/`. Leave `builds/` older than 30 days on E: (or archive them to the NAS), linking `builds/` with a junction if needed. |
| How | Stop Agent Builder (Stop shortcut) and the Host Manager's restarts; `robocopy E:\Projects\Agent-Builder G:\Projects\Agent-Builder /E /COPY:DAT /XD node_modules` (node_modules are reinstalled, faster than copying 100,000 files); `npm ci` in the new place and in `remote/`; update the launcher, the Host Manager's service path, the desktop shortcuts and the autostart task to G:; start; run `npm run test:system` and the UI check. |
| Backup | `E:\Projects\Agent-Builder` is left untouched until a week of normal running from G:. |
| Rollback | Point the launcher, Host Manager and shortcuts back at E:, which is unchanged. |

## Also found while measuring

- **The Ollama models live on F:** (a 7,200 rpm drive that also holds a Steam library). On 22 November an rclone sync
  read F: at 119 MB/s and saturated it, and the 14B model, half of which runs from RAM mapped from F:, slowed to a
  crawl. Either keep rclone off F: while the builder works, or the Quiet/Gaming profiles could pause rclone (it has no
  pause API; lowering its priority does not throttle its disk use).
- **Windows shows the NAS mapping `N:` as disconnected** although the NAS answers; reconnect it in File Explorer before
  any archive to it.
