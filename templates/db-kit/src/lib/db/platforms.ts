/**
 * The databases this app can use, and the keys each one needs.
 *
 * Every platform here is safe to call straight from the browser: the keys
 * asked for are the PUBLIC ones each platform gives web apps (Supabase's anon
 * key, Firebase's web API key…). Who may read and write what is decided by the
 * rules you set on the platform (the setup steps below), never by hiding a key.
 * Never paste an admin, service-role or secret key into an app: anyone can
 * read it from the page.
 *
 * Agent Builder keeps a copy of these keys in src/database/DbPlatforms.ts —
 * change an env name here, change it there.
 */
export type PlatformId = "local" | "supabase" | "firebase" | "pocketbase" | "appwrite" | "rest";

export interface PlatformField {
  key: string;
  /** The Vite environment variable that sets it permanently (in .env.local). */
  env: string;
  label: string;
  placeholder: string;
  /** Where to find it, in one line. */
  help: string;
  optional?: boolean;
}

export interface Platform {
  id: PlatformId;
  name: string;
  /** One line: what it is and when to choose it. */
  pitch: string;
  /** Whether it can sign users in (auth.signUp / signIn). */
  auth: boolean;
  fields: PlatformField[];
  /** Step by step, in plain words. Code blocks are separate so they can be copied. */
  steps: string[];
  /** SQL, rules or a schema to paste on the platform. */
  snippet?: { label: string; code: string };
  docs: string;
}

export const PLATFORMS: Platform[] = [
  {
    id: "local",
    name: "This browser only",
    pitch: "No setup. Data is saved in this browser on this device — perfect for trying the app; nothing is shared between devices or people.",
    auth: true,
    fields: [],
    steps: ["Nothing to do: it works as it is. Pick a real database below when people should share data or keep it across devices."],
    docs: "https://developer.mozilla.org/docs/Web/API/Window/localStorage"
  },
  {
    id: "supabase",
    name: "Supabase",
    pitch: "Postgres with sign-in, free to start. The best all-round choice for most apps.",
    auth: true,
    fields: [
      { key: "url", env: "VITE_SUPABASE_URL", label: "Project URL", placeholder: "https://abcd1234.supabase.co", help: "Supabase → Project Settings → API → Project URL" },
      { key: "anonKey", env: "VITE_SUPABASE_ANON_KEY", label: "anon public key", placeholder: "eyJhbGciOi…", help: "Supabase → Project Settings → API → Project API keys → anon public (NOT service_role)" }
    ],
    steps: [
      "Create a free project at supabase.com.",
      "Open SQL Editor → New query, paste the SQL below and press Run. It makes one table, ab_records, that holds every kind of record this app saves.",
      "Copy the Project URL and the anon public key into the boxes here (or into .env.local).",
      "If the app has sign-in, turn on Email under Authentication → Providers."
    ],
    snippet: {
      label: "SQL (run once in the SQL Editor)",
      code: `create table if not exists public.ab_records (
  id uuid primary key default gen_random_uuid(),
  collection text not null,
  data jsonb not null default '{}'::jsonb,
  owner uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ab_records_collection on public.ab_records (collection, created_at desc);
alter table public.ab_records enable row level security;

-- Signed-in people see and change only their own records.
create policy "own records" on public.ab_records for all
  using (owner = auth.uid()) with check (owner = auth.uid());

-- For an app WITHOUT sign-in (anyone may read and add), use this instead of the policy above:
-- create policy "public app" on public.ab_records for all using (true) with check (true);`
    },
    docs: "https://supabase.com/docs/guides/api"
  },
  {
    id: "firebase",
    name: "Firebase (Firestore)",
    pitch: "Google's document database with sign-in. Good if you already use Google Cloud or Firebase.",
    auth: true,
    fields: [
      { key: "apiKey", env: "VITE_FIREBASE_API_KEY", label: "Web API key", placeholder: "AIzaSy…", help: "Firebase console → Project settings → General → Your apps → Web app → apiKey" },
      { key: "projectId", env: "VITE_FIREBASE_PROJECT_ID", label: "Project ID", placeholder: "my-app-12345", help: "Firebase console → Project settings → General → Project ID" }
    ],
    steps: [
      "Create a project at console.firebase.google.com and add a Web app to it.",
      "Build → Firestore Database → Create database (production mode).",
      "Firestore → Rules: paste the rules below and Publish.",
      "If the app has sign-in: Build → Authentication → Get started → Email/Password → Enable.",
      "Copy the Web API key and Project ID into the boxes here (or into .env.local)."
    ],
    snippet: {
      label: "Firestore rules",
      code: `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Signed-in people see and change only their own records.
    match /{collection}/{id} {
      allow read, update, delete: if request.auth != null && resource.data.owner == request.auth.uid;
      allow create: if request.auth != null && request.resource.data.owner == request.auth.uid;
    }
    // For an app WITHOUT sign-in, use this instead:
    // match /{collection}/{id} { allow read, write: if true; }
  }
}`
    },
    docs: "https://firebase.google.com/docs/firestore/use-rest-api"
  },
  {
    id: "pocketbase",
    name: "PocketBase",
    pitch: "One small file you run yourself (or on a cheap server). Free forever, you own everything.",
    auth: true,
    fields: [{ key: "url", env: "VITE_POCKETBASE_URL", label: "PocketBase URL", placeholder: "https://pb.example.com", help: "The address your PocketBase runs at (http://127.0.0.1:8090 on your own PC)" }],
    steps: [
      "Download PocketBase from pocketbase.io and start it (./pocketbase serve).",
      "Open its Admin UI (/_/) → New collection → name it ab_records, type Base.",
      "Add fields: collection (Plain text, required), data (JSON), owner (Plain text).",
      "API Rules: for sign-in apps set each rule to  owner = @request.auth.id ; for an open app leave them empty (anyone).",
      "Put the PocketBase address in the box here (or into .env.local)."
    ],
    docs: "https://pocketbase.io/docs/api-records/"
  },
  {
    id: "appwrite",
    name: "Appwrite",
    pitch: "Open-source backend, cloud or self-hosted. Data only here (sign-in is not wired in).",
    auth: false,
    fields: [
      { key: "endpoint", env: "VITE_APPWRITE_ENDPOINT", label: "API endpoint", placeholder: "https://cloud.appwrite.io/v1", help: "Appwrite console → Project → Settings → API endpoint" },
      { key: "projectId", env: "VITE_APPWRITE_PROJECT_ID", label: "Project ID", placeholder: "65f0c…", help: "Appwrite console → Project → Settings → Project ID" },
      { key: "databaseId", env: "VITE_APPWRITE_DATABASE_ID", label: "Database ID", placeholder: "main", help: "Databases → your database → its ID" },
      { key: "collectionId", env: "VITE_APPWRITE_COLLECTION_ID", label: "Collection ID", placeholder: "ab_records", help: "The collection you made in step 3 → its ID" }
    ],
    steps: [
      "Create a project at cloud.appwrite.io and add a Web platform with this site's address.",
      "Databases → Create database.",
      "Create a collection; add attributes collection (String, 64, required) and data (String, 100000).",
      "Collection → Settings → Permissions: Role Any → Create, Read, Update, Delete (anyone can use the app).",
      "Copy the endpoint and the three IDs into the boxes here (or into .env.local)."
    ],
    docs: "https://appwrite.io/docs/references/cloud/client-rest/databases"
  },
  {
    id: "rest",
    name: "My own API",
    pitch: "Your own server (Node, Laravel, .NET…) — and the way to use MySQL, SQL Server or MongoDB, whose keys must never be in a web page.",
    auth: false,
    fields: [
      { key: "baseUrl", env: "VITE_API_URL", label: "API base URL", placeholder: "https://api.example.com/v1", help: "Where your API is. It must allow this site (CORS)." },
      { key: "publicKey", env: "VITE_API_PUBLIC_KEY", label: "Public API key", placeholder: "optional", help: "Sent as the x-api-key header. Only a key meant to be public.", optional: true }
    ],
    steps: [
      "Your API answers these, with JSON records that have an id:",
      "GET /{collection} → list · GET /{collection}/{id} → one · POST /{collection} → create",
      "PATCH /{collection}/{id} → update · DELETE /{collection}/{id} → delete",
      "Put its base URL here (or into .env.local)."
    ],
    docs: "https://developer.mozilla.org/docs/Web/HTTP/CORS"
  }
];

export const platform = (id: string): Platform => PLATFORMS.find((p) => p.id === id) ?? PLATFORMS[0];
