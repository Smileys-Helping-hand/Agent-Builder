# Collaboration Rooms & Context Memory

The Collaboration Hub now supports human + AI pair programming with shared context, presence tracking, and role delegation. Use this guide to configure sessions and broadcast build updates.

## Key Features

- **Rooms & Roles** — Sessions can live under `default`, `sandbox`, or `team`. Participants declare roles (`Builder`, `UX`, `QA`, `Ops`) and presence (active/idle).
- **Context Memory** — Each session maintains a `CollaborationRoomContext` containing summaries, linked repositories, active agents, and the last command. Updates are synchronized through `/api/collab/context`.
- **Event Stream** — Collaboration events (`type: "collaboration"`) now include the current context, enabling dashboards or external tools to render shared goals.
- **Build Broadcasts** — When a build runs with a `sessionId`, the BuildEngine streams progress into that room, merging agent participation into the context memory automatically.

## REST Endpoints

```http
POST /api/collab/create        # -> { snapshot }
POST /api/collab/join          # -> { session }
GET  /api/collab/snapshot      # -> { snapshot }
GET  /api/collab/list          # -> { sessions }
POST /api/collab/context       # -> { context }
```

Snapshots contain:

```ts
type CollaborationSnapshot = {
  id: string;
  room: "default" | "sandbox" | "team";
  participants: Array<{ id: string; name: string; role: string; presence?: "active" | "idle"; isAI?: boolean }>;
  files: Record<string, string>;
  updatedAt: string;
  context?: {
    summary: string;
    repos?: string[];
    activeAgents: string[];
    lastCommand?: string;
    updatedAt: string;
  } | null;
};
```

## Dashboard Workflow

1. Open the **Collaborate** tab and create or join a session.
2. Update the room summary and repository list in the *Room Context* panel.
3. Invite teammates via the generated URL or load the latest session with the new shortcut.
4. Start a build (or attach via the Build tab). Status updates will appear in both the Build and Collaborate tabs.

## Pair Programming with Agents

- AI participants can be injected by calling `CollaborationHub.joinSession` with `isAI: true`.
- Cursor updates and diff records are still handled via `recordDiff` and `updateCursor`.
- Idle detection can be implemented by periodically toggling `presence` to `idle`; the dashboard will surface dormant collaborators.

## Tips

- Store session IDs in environment variables or project metadata when automating merges.
- Combine context memory with `VectorMemory.searchByText` to recall prior design decisions during build planning.
- Subscribe to websocket events via the dashboard SDK to render real-time cursors or annotate shared Monaco editors.
