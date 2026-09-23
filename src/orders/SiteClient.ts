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
    update: { status: string; message?: string; qualityScore?: number; previewUrl?: string | null }
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
  }
};
