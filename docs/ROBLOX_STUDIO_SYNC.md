# Roblox Studio Live-Sync Bridge

The live-sync bridge keeps your generated Lua assets in sync with Roblox Studio so you can iterate without leaving Agent Builder.

## Prerequisites

- A successful Agent Builder Ultra v11.5 or later installation
- Roblox Studio installed locally
- The AgentBridge Roblox plugin copied to your Studio plugins directory

## Install the AgentBridge Plugin

1. Copy the contents of `plugins/AgentBridge/` into `Documents/Roblox/Plugins/AgentBridge/` (create the folder if it does not exist).
2. Launch Roblox Studio and navigate to **Plugins → Manage Plugins**.
3. Enable the **AgentBridge** plugin and restart Studio if prompted.

When the plugin loads you should see a console message similar to:

```
[AgentBridge] Listening for Agent Builder on ws://localhost:34872
```

## Configure the Bridge

The bridge runs automatically when `ROBLOX_SYNC_ENABLED=true` in your environment. You can customise the port with `ROBLOX_SYNC_PORT` (default `34872`).

Ensure the `games/roblox/` directory exists and is writable—the bridge writes all generated assets to that location before synchronising them with Studio.

## Using Live-Sync

1. Generate or update a Roblox experience from the **Game** tab in the dashboard.
2. Toggle **Live-Sync** on. The indicator will pulse green once the dashboard connects to the Studio plugin.
3. Each generated or edited file under `games/roblox/` is pushed to Studio automatically. Check the **Live-Sync** log panel for confirmation.
4. Press **Playtest in Studio** to trigger `PlaySolo()` directly from the dashboard.

If Studio closes or the plugin disconnects you will see the status revert to **Live-Sync idle**. Re-open Studio and toggle the connection again to reconnect.

## Troubleshooting

- **No connection:** Verify Roblox Studio is open and the AgentBridge plugin is enabled. The dashboard status will remain on *Connecting* until Studio accepts the WebSocket connection.
- **Port in use:** Set a different `ROBLOX_SYNC_PORT` value in both Agent Builder (`.env`) and the plugin (update `PORT` inside `plugins/AgentBridge/init.lua`).
- **Files not appearing:** Ensure the dashboard shows recent sync events and that the Studio output does not list readfile errors. The bridge requires Roblox Studio to have file system permissions.

For additional logging, check the Agent Builder server logs—every sync, connection change, and playtest request is emitted there and mirrored to the dashboard event stream.
