# Collaboration Sessions

The Agent Builder dashboard includes a dedicated **Collaborate** tab that allows multiple teammates to join the same editing session and watch one another's cursors in real time.

## Starting a Session

1. Ensure the backend is running with `COLLAB_PORT` configured (defaults to `35000`).
2. Visit the Collaborate tab and click **Create Session**. This requests `/api/collab/create` and provisions a new room on the collaboration server.
3. Copy the invite link that appears in the sidebar and share it with your teammates.

## Joining a Session

- Paste an invite link or manually enter a session ID, then press **Join**. The dashboard connects to the collaboration WebSocket bridge and synchronises updates using Yjs.
- Participant avatars illuminate whenever someone is typing or moving their cursor.

## Snapshots

The **Save Snapshot** button captures the current project state by calling `/api/collab/snapshot`. Snapshots are lightweight JSON summaries that can be restored later.

## Troubleshooting

- Verify `ROBLOX_SYNC_ENABLED` and `COLLAB_PORT` are both accessible from the dashboard host.
- If the dashboard cannot connect, restart the backend to reinitialise the `CollaborationServer` and confirm no firewalls are blocking port `35000`.
