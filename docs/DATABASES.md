# Databases for the apps it builds

Agent Builder doesn't run databases for the people it builds for. Instead, they choose the platform they plan to use, the app comes with its data code ready for it, and they paste their own keys into simple boxes. The data lives on their platform, under their account.

## Choosing

- **App → Prompt → step 5, "Where it saves data"**: Nothing to save · Decide later · Supabase · Firebase · PocketBase · Appwrite · My own API.
- **Jarvis**: the `build` action takes `database`.
- **API**: `POST /api/autonomous/start { …, database: "supabase" }`.
- **An existing build**: its page → **Database**. This adds the data layer if it has none; continue the build afterwards so the app uses it.

| Platform | Sign-in | Notes |
|---|---|---|
| Decide later (`local`) | on this device | Saves in the browser. Works with no setup; connect a real database any time. |
| Supabase | yes | Postgres; the best all-round choice. |
| Firebase (Firestore) | yes | Google's document database. |
| PocketBase | yes | One file you run yourself; free forever. |
| Appwrite | data only | Open source, cloud or self-hosted. |
| My own API | your own | Plain REST. This is the safe way to use MySQL, SQL Server or MongoDB, whose keys must never be in a web page. |

Only platforms whose keys are safe in a browser are offered. What each person may read and write is set by the rules on the platform (the setup steps include the SQL or rules to paste), never by hiding a key.

## What the build gets

`templates/db-kit` is copied into the build:

- `src/lib/db/`: `collection()`, `useCollection()`, `auth`, `useUser()`, one adapter per platform (plain `fetch`, no SDKs), and its own tests
- `src/lib/db/DbSetup.tsx`: the **Connect a database** panel (pick a platform, follow its steps, paste keys, Test connection, Save) and `<DbStatusBar />`, the pill that opens it
- `.env.example`: the platform's `VITE_*` keys, empty
- `.env.local`: `VITE_DB_PROVIDER` (and the keys, once given); git-ignored
- `DATABASE.md`: setup steps for the person who receives the app

Every platform stores records the same way (one `ab_records` table/collection with `collection` + `data`), so any app's collections work without a schema per app.

The build's model is told to keep all saved data in `src/lib/db` and render `<DbStatusBar />` (`DbKit.preamble`).

## Apps ordered on the ARP site (and through VerifiedBizLink)

The same choice and the same keys, without the customer touching code:

1. **Ordering**: every way to order (Buy, the project builder, VerifiedBizLink's Build Studio) asks *Where should it keep its data?* The build job carries the choice; the app is built around it.
2. **Connecting**: once the first version is ready, the customer's dashboard has **Connect your database** (on VerifiedBizLink: the project page). They pick the platform, follow its steps and paste its public keys; secret keys are refused there and again at the hub.
3. **Applying**: the keys reach Agent Builder as a site edit on its next poll. It writes them into the delivered site's `.env.local` and rebuilds it in place, so every visitor's data goes to their database (a failed rebuild puts the old keys back). A site built before it had a data layer gets one on a copy, through the same quality gates as any change to a delivered site.

In a built app the **Connect a database** pill is for the owner only: it shows while developing, and on the live app only when it is opened with `?admin` (remembered for that visit). Keys saved there connect that browser; for everyone they go in `.env.local`, which is what the dashboard does.

## Keys

There are two places to put them:

1. **In the Agent Builder app** (build → Database): written to the build's `.env.local` on the PC; the site is rebuilt so the preview uses them. Saved keys are never sent back to the app, which only shows "saved".
2. **In the finished app itself** (the pill → Connect a database): saved in that browser, for trying a platform at once. The panel shows the `.env.local` lines that make it permanent for every visitor.

Secret keys are refused in both places (Supabase `service_role` and `sb_secret_` keys, `sk_live_`, private keys).

## API

```
GET  /api/databases/platforms
GET  /api/autonomous/:buildId/database          { state: { installed, platform, set, missing } }
POST /api/autonomous/:buildId/database          { platform, values?, rebuild? }
POST /api/autonomous/:buildId/database/test     { platform, values? }   (empty values use the saved keys)
```

Tests: `npm run test:db-kit` (installs into a starter copy, checks key safety and that the builder and kit agree). The kit's own tests (`src/lib/db/db.test.ts`) run inside every build.
