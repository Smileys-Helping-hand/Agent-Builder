/**
 * SiteClient — talking to the ordering site (arpcloudsolutions.co.za).
 *
 * This pulls rather than waits to be pushed. The builder runs on a home machine
 * behind a tunnel or a tailnet whose address has a habit of changing, while the
 * site is on hosting that is always up; a webhook pointed at the builder breaks
 * every time the tunnel restarts, whereas a poll from the builder outward works
 * from behind any NAT and needs nothing configured on the customer's side.
 *
 * The site authenticates the builder with a master key of the ecosystem's usual
 * shape (`hub_agentbuilder_<hex>`), sent as a bearer token.
 */
import { Logger } from "../utils/Logger.js";

/** One order as the site describes it, before it becomes an Order here. */
export interface SiteOrder {
  id: string;
  name?: string;
  customerName?: string;
  email?: string;
  customerEmail?: string;
  serviceType?: string;
  productType?: string;
  title?: string;
  projectDescription?: string;
  brief?: string;
  budget?: string;
  timeline?: string;
  status?: string;
  createdAt?: number | string;
  /** The catalogue item the customer picked, when they picked one. */
  templateId?: string;
  features?: string[];
  /** The customer has paid on the site. */
  paid?: boolean;
  /** The reference the customer was given, e.g. ARP-1A2B3C. */
  orderRef?: string;
}

/** What the builder tells the site each time it checks in. */
export interface CheckIn {
  items: unknown[];
  version: string;
  machine: string;
  queueLength: number;
  building: number;
  /**
   * Where this machine's app can reach it (https only), so the site's
   * "Open Agent Builder" can send an admin straight here, signed in.
   */
  address?: string | null;
}

const TIMEOUT_MS = 20_000;

const base = (): string | null => {
  const url = process.env.SITE_URL?.trim().replace(/\/+$/, "");
  return url || null;
};

const key = (): string | null => process.env.SITE_API_KEY?.trim() || null;

const headers = (): Record<string, string> => ({
  Authorization: `Bearer ${key() ?? ""}`,
  "Content-Type": "application/json"
});

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const SiteClient = {
  isConfigured(): boolean {
    return base() !== null && key() !== null;
  },

  describe(): { configured: boolean; site: string | null } {
    return { configured: this.isConfigured(), site: base() };
  },

  /**
   * Orders the site is waiting on us for. Returns an empty list rather than
   * throwing when the site is unreachable — intake runs on a timer and a
   * flat internet connection is not an error worth waking anyone for.
   */
  async pendingOrders(): Promise<SiteOrder[]> {
    const url = base();
    if (!url || !key()) return [];
    try {
      const response = await fetch(`${url}/api/builder/orders`, {
        headers: headers(),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
      if (!response.ok) {
        Logger.log("Order intake: site refused", { status: response.status });
        return [];
      }
      const body = (await response.json()) as { orders?: SiteOrder[]; requests?: SiteOrder[] };
      return body.orders ?? body.requests ?? [];
    } catch (error) {
      Logger.log("Order intake: site unreachable", { detail: errorMessage(error) });
      return [];
    }
  },

  /**
   * Tell the site where an order stands. Best-effort: a failure here must never
   * stop the build, and the next status change will carry the state anyway.
   */
  async reportProgress(
    externalId: string,
    update: { status: string; message?: string; qualityScore?: number; previewUrl?: string | null; downloadUrl?: string | null; progress?: number }
  ): Promise<boolean> {
    const url = base();
    if (!url || !key()) return false;
    try {
      const response = await fetch(`${url}/api/builder/orders/${encodeURIComponent(externalId)}`, {
        method: "PATCH",
        headers: headers(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        body: JSON.stringify(update)
      });
      return response.ok;
    } catch (error) {
      Logger.log("Order progress not reported", { externalId, detail: errorMessage(error) });
      return false;
    }
  },

  /**
   * Send the site the catalogue and how busy we are. The site shows the
   * catalogue to customers and reads the check-in as "the PC is on".
   */
  async checkIn(payload: CheckIn): Promise<{ ok: boolean; status: number; message: string }> {
    const url = base();
    if (!url || !key()) return { ok: false, status: 0, message: "SITE_URL or SITE_API_KEY is not configured." };
    try {
      const response = await fetch(`${url}/api/builder/catalog`, {
        method: "POST",
        headers: headers(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        body: JSON.stringify(payload)
      });
      if (response.ok) return { ok: true, status: response.status, message: `Published ${payload.items.length} items to ${url}` };
      // 404 means the site is running a version without the builder routes.
      return { ok: false, status: response.status, message: `Site returned HTTP ${response.status}` };
    } catch (error) {
      return { ok: false, status: 0, message: errorMessage(error) };
    }
  },

  /**
   * Ask the site whether a sign-in token an admin brought from "Open Agent
   * Builder" is genuine. The site checks it once and then forgets it, so a
   * token that passes here can never pass again.
   */
  async redeemSso(token: string): Promise<{ ok: true; admin: string } | { ok: false; reason: string }> {
    const url = base();
    if (!url || !key()) return { ok: false, reason: "This machine is not connected to the site (SITE_URL / SITE_API_KEY)." };
    try {
      const response = await fetch(`${url}/api/builder/sso`, {
        method: "POST",
        headers: headers(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        body: JSON.stringify({ token })
      });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; admin?: string; error?: string };
      if (response.ok && body.ok && body.admin) return { ok: true, admin: body.admin };
      return { ok: false, reason: body.error ?? `The site answered ${response.status}.` };
    } catch (error) {
      return { ok: false, reason: `Could not reach the site: ${errorMessage(error)}` };
    }
  },

  /** Ping the site to test authorization and responsiveness. */
  async testConnection(): Promise<{ ok: boolean; status: number; message: string }> {
    const url = base();
    if (!url || !key()) return { ok: false, status: 0, message: "SITE_URL or SITE_API_KEY is not configured." };
    try {
      const response = await fetch(`${url}/api/builder/orders`, {
        headers: headers(),
        signal: AbortSignal.timeout(8000)
      });
      if (response.ok) {
        return { ok: true, status: response.status, message: `Connected to ${url} (HTTP ${response.status})` };
      }
      return { ok: false, status: response.status, message: `Site returned HTTP ${response.status}` };
    } catch (error) {
      return { ok: false, status: 0, message: errorMessage(error) };
    }
  }
};
