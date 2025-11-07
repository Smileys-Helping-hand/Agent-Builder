import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { fetchCurrentUser, loginUser, registerUser, type AuthUser, type TeamRole } from "../lib/api";

type AuthPanelProps = {
  onAuthChange?: (user: AuthUser | null) => void;
};

const TOKEN_KEY = "agent-builder-token";

const getStoredToken = () => {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(TOKEN_KEY);
};

const rolePriority: Record<TeamRole["role"], number> = {
  owner: 4,
  admin: 3,
  editor: 2,
  viewer: 1
};

const describeRole = (role: TeamRole["role"]) => {
  switch (role) {
    case "owner":
      return "Owner";
    case "admin":
      return "Admin";
    case "editor":
      return "Editor";
    default:
      return "Viewer";
  }
};

export const AuthPanel = ({ onAuthChange }: AuthPanelProps) => {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const highestRole = useMemo(() => {
    if (!user) return null;
    return user.teams.reduce((best, team) => {
      if (!best) return team;
      return rolePriority[team.role] > rolePriority[best.role] ? team : best;
    }, user.teams[0] ?? null);
  }, [user]);

  const syncUser = useCallback(
    (next: AuthUser | null, token?: string | null) => {
      setUser(next);
      if (typeof window !== "undefined") {
        if (token) {
          window.localStorage.setItem(TOKEN_KEY, token);
        } else if (token === null) {
          window.localStorage.removeItem(TOKEN_KEY);
        }
      }
      onAuthChange?.(next);
    },
    [onAuthChange]
  );

  useEffect(() => {
    const bootstrap = async () => {
      const token = getStoredToken();
      if (!token) {
        return;
      }
      try {
        const { user: profile } = await fetchCurrentUser();
        syncUser(profile);
      } catch (err) {
        console.warn("Token invalid, clearing session", err);
        syncUser(null, null);
      }
    };
    void bootstrap();
  }, [syncUser]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!email || !password) {
        setError("Email and password are required");
        return;
      }

      setLoading(true);
      setError(null);

      try {
        if (mode === "login") {
          const { token, user: profile } = await loginUser(email, password);
          syncUser(profile, token);
        } else {
          const { token, user: profile } = await registerUser(email, password);
          syncUser(profile, token);
        }
        setEmail("");
        setPassword("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Authentication failed");
      } finally {
        setLoading(false);
      }
    },
    [email, password, mode, syncUser]
  );

  const logout = useCallback(() => {
    syncUser(null, null);
  }, [syncUser]);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow-lg shadow-black/40">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-100">Workspace Access</h2>
        <button
          className="text-xs uppercase tracking-wide text-sky-400 hover:text-sky-300"
          onClick={() => setMode((current) => (current === "login" ? "register" : "login"))}
          disabled={loading}
        >
          {mode === "login" ? "Need an account?" : "Have an account?"}
        </button>
      </div>

      {user ? (
        <div className="mt-4 space-y-3 text-sm text-slate-200">
          <div>
            <p className="font-semibold text-slate-100">{user.email}</p>
            {highestRole && (
              <p className="text-xs uppercase tracking-wide text-slate-400">
                {describeRole(highestRole.role)} · {highestRole.teamName}
              </p>
            )}
          </div>
          {user.teams.length > 1 && (
            <div className="space-y-1 rounded-md border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-300">
              <p className="font-semibold text-slate-200">Team Roles</p>
              <ul className="space-y-1">
                {user.teams.map((team) => (
                  <li key={`${team.teamId}-${team.role}`} className="flex items-center justify-between">
                    <span>{team.teamName}</span>
                    <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">
                      {describeRole(team.role)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button
            onClick={logout}
            className="inline-flex items-center rounded-md border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800"
          >
            Log out
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div className="space-y-1">
            <label htmlFor="auth-email" className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Email
            </label>
            <input
              id="auth-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              disabled={loading}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="auth-password" className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Password
            </label>
            <input
              id="auth-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              disabled={loading}
            />
          </div>
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="inline-flex w-full items-center justify-center rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700"
          >
            {loading ? "Processing..." : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
      )}
    </div>
  );
};
