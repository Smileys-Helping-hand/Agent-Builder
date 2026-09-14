/**
 * SourceProviders - keyless search and page reading for the research loop.
 *
 * Five providers with no API keys: Wikipedia, arXiv, Hacker News (Algolia),
 * GitHub repository search, and general web results via DuckDuckGo's HTML
 * endpoint. Every request is throttled per host, time-bounded, size-capped,
 * and restricted to public http(s) addresses — a loop that never stops must
 * not become something that hammers a site or reaches into the local network.
 */
import crypto from "crypto";
import { contentTokens } from "../knowledge/KnowledgeDb.js";

export type ProviderName = "wikipedia" | "arxiv" | "hackernews" | "github" | "web";

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  provider: ProviderName;
}

export interface FetchedDocument {
  url: string;
  title: string;
  text: string;
  contentHash: string;
}

export const MAX_TEXT_CHARS = 12_000;

const USER_AGENT = process.env.RESEARCH_USER_AGENT ?? "AgentBuilderResearch/1.0 (local research assistant)";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_DOWNLOAD_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;

// arXiv's API terms ask for at least 3 seconds between requests; everyone else
// gets a polite 1 second.
const HOST_MIN_INTERVAL_MS: Record<string, number> = { "export.arxiv.org": 3_000 };
const DEFAULT_HOST_INTERVAL_MS = 1_000;
const nextSlotByHost = new Map<string, number>();

// Per-provider backoff after a rate-limit or block response: 5 min, doubling to 2 h.
const PROVIDER_BASE_COOLDOWN_MS = 5 * 60_000;
const PROVIDER_MAX_COOLDOWN_MS = 2 * 60 * 60_000;
const providerCooldownUntil = new Map<ProviderName, number>();
const providerCooldownMs = new Map<ProviderName, number>();

/** Providers currently backing off, with the time they resume. Exposed for status and tests. */
export const providerCooldowns = (): Partial<Record<ProviderName, string>> => {
  const now = Date.now();
  const active: Partial<Record<ProviderName, string>> = {};
  for (const [name, until] of providerCooldownUntil) {
    if (until > now) active[name] = new Date(until).toISOString();
  }
  return active;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const throttleHost = async (host: string): Promise<void> => {
  const interval = HOST_MIN_INTERVAL_MS[host] ?? DEFAULT_HOST_INTERVAL_MS;
  const now = Date.now();
  const slot = Math.max(now, nextSlotByHost.get(host) ?? 0);
  // Reserve the slot before waiting so concurrent callers queue behind it.
  nextSlotByHost.set(host, slot + interval);
  if (slot > now) await sleep(slot - now);
};

const PRIVATE_HOST =
  /^(localhost|.*\.localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|::1?|f[cd][0-9a-f]{2}:.*|fe80:.*)$/i;

/** Only public http(s) URLs. Hostname-literal check; DNS rebinding is out of scope for a local research tool. */
export const isPublicHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = url.hostname.replace(/^\[|\]$/g, "");
    return host.length > 0 && !PRIVATE_HOST.test(host);
  } catch {
    return false;
  }
};

export const normalizeUrl = (value: string): string => {
  try {
    const url = new URL(value);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_|^(fbclid|gclid|mc_cid|mc_eid|ref_src)$/i.test(key)) url.searchParams.delete(key);
    }
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, -1);
    return url.toString();
  } catch {
    return value;
  }
};

/** Search-engine-friendly keywords: content words only, deduplicated, in original order. */
export const keywordQuery = (text: string, max = 8): string => [...new Set(contentTokens(text))].slice(0, max).join(" ");

const decodeEntities = (text: string): string =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

const stripTags = (html: string): string => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const htmlToText = (html: string): { title: string; text: string } => {
  const title = decodeEntities(stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""));
  let body = html.replace(/<!--[\s\S]*?-->/g, " ");
  body = body.replace(/<(script|style|noscript|svg|nav|footer|header|aside|form|iframe|template|button)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  // Prefer <article> or <main> when present — that's where the substance is.
  const main = body.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ?? body.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (main && main[1].length > 800) body = main[1];
  body = body.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/blockquote|\/pre)[^>]*>/gi, "\n");
  body = decodeEntities(body.replace(/<[^>]+>/g, " "));
  const text = body
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v\r]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  return { title, text };
};

const hashText = (text: string): string =>
  crypto.createHash("sha1").update(text.toLowerCase().replace(/\s+/g, " ").slice(0, 5000)).digest("hex");

const politeFetch = async (url: string, accept: string, extraHeaders: Record<string, string> = {}): Promise<Response> => {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!isPublicHttpUrl(current)) throw new Error(`Refusing non-public URL: ${current}`);
    await throttleHost(new URL(current).hostname);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(current, {
        headers: { "User-Agent": USER_AGENT, Accept: accept, ...extraHeaders },
        redirect: "manual",
        signal: controller.signal
      });
      // Follow redirects by hand so every hop is re-checked — a public URL
      // must not be able to bounce the fetch onto a local address.
      if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
        current = new URL(response.headers.get("location") as string, current).toString();
        continue;
      }
      return response;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`${new URL(current).hostname} timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Too many redirects: ${url}`);
};

const readCapped = async (response: Response): Promise<string> => {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    total += value.byteLength;
    if (total > MAX_DOWNLOAD_BYTES) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8").decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
};

const githubHeaders = (): Record<string, string> =>
  process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};

// --- providers ---------------------------------------------------------------

export const searchWikipedia = async (query: string, limit: number): Promise<SearchResult[]> => {
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=${limit}&srsearch=${encodeURIComponent(query)}`;
  const response = await politeFetch(url, "application/json");
  if (!response.ok) throw new Error(`Wikipedia HTTP ${response.status}`);
  const data = (await response.json()) as { query?: { search?: Array<{ title: string; snippet: string }> } };
  return (data.query?.search ?? []).map((item) => ({
    provider: "wikipedia" as const,
    title: item.title,
    snippet: decodeEntities(stripTags(item.snippet)),
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, "_"))}`
  }));
};

export const searchArxiv = async (keywords: string, limit: number): Promise<SearchResult[]> => {
  const terms = keywords.split(" ").filter(Boolean).slice(0, 4);
  if (terms.length === 0) return [];
  const query = terms.map((term) => `all:${term}`).join(" AND ");
  const url = `https://export.arxiv.org/api/query?start=0&sortBy=relevance&max_results=${limit}&search_query=${encodeURIComponent(query)}`;
  const response = await politeFetch(url, "application/atom+xml");
  if (!response.ok) throw new Error(`arXiv HTTP ${response.status}`);
  const xml = await response.text();
  const field = (entry: string, name: string) =>
    decodeEntities(entry.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? "").replace(/\s+/g, " ").trim();
  return xml
    .split("<entry>")
    .slice(1)
    .map((entry) => ({
      provider: "arxiv" as const,
      title: field(entry, "title"),
      snippet: field(entry, "summary").slice(0, 2500),
      url: field(entry, "id").replace(/^http:/, "https:").replace(/v\d+$/, "")
    }))
    .filter((result) => result.url.startsWith("https://arxiv.org/abs/"));
};

export const searchHackerNews = async (query: string, limit: number): Promise<SearchResult[]> => {
  const url = `https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=${limit}&query=${encodeURIComponent(query)}`;
  const response = await politeFetch(url, "application/json");
  if (!response.ok) throw new Error(`Hacker News HTTP ${response.status}`);
  const data = (await response.json()) as {
    hits?: Array<{ title?: string; url?: string | null; objectID: string; story_text?: string | null }>;
  };
  return (data.hits ?? [])
    .filter((hit) => hit.title)
    .map((hit) => ({
      provider: "hackernews" as const,
      title: hit.title as string,
      snippet: decodeEntities(stripTags(hit.story_text ?? "")).slice(0, 2500),
      url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`
    }));
};

export const searchGitHub = async (keywords: string, limit: number): Promise<SearchResult[]> => {
  if (!keywords.trim()) return [];
  const url = `https://api.github.com/search/repositories?per_page=${limit}&q=${encodeURIComponent(keywords)}`;
  const response = await politeFetch(url, "application/vnd.github+json", githubHeaders());
  if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
  const data = (await response.json()) as {
    items?: Array<{ full_name: string; html_url: string; description: string | null; stargazers_count: number }>;
  };
  return (data.items ?? []).map((item) => ({
    provider: "github" as const,
    title: item.full_name,
    snippet: `${item.description ?? ""} (${item.stargazers_count} stars)`.trim(),
    url: item.html_url
  }));
};

export const searchWeb = async (query: string, limit: number): Promise<SearchResult[]> => {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await politeFetch(url, "text/html", { "User-Agent": "Mozilla/5.0 (compatible; AgentBuilderResearch/1.0)" });
  if (!response.ok) throw new Error(`DuckDuckGo HTTP ${response.status}`);
  const html = await response.text();
  const links = [...html.matchAll(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  const snippets = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)];
  const results: SearchResult[] = [];
  links.forEach((match, index) => {
    const rawHref = decodeEntities(match[1]);
    const redirected = rawHref.match(/[?&]uddg=([^&]+)/);
    const target = redirected ? decodeURIComponent(redirected[1]) : rawHref.startsWith("//") ? `https:${rawHref}` : rawHref;
    if (!/^https?:\/\//.test(target) || /duckduckgo\.com/.test(new URL(target).hostname)) return;
    results.push({
      provider: "web",
      title: decodeEntities(stripTags(match[2])),
      snippet: decodeEntities(stripTags(snippets[index]?.[1] ?? "")),
      url: target
    });
  });
  return results.slice(0, limit);
};

/**
 * Query every provider in parallel. A provider that is down, rate-limited, or
 * blocking automated requests is reported in `errors` rather than failing the
 * search — the loop keeps working with whatever is reachable.
 */
export const searchAll = async (
  query: string,
  perProvider: number
): Promise<{ results: SearchResult[]; errors: Partial<Record<ProviderName, string>> }> => {
  const keywords = keywordQuery(query);
  const providers: Array<[ProviderName, () => Promise<SearchResult[]>]> = [
    // Wikipedia's full-text search matches loosely on long natural-language
    // questions (a WebAssembly question returned "Creativity" and "Autonomic
    // computing"), so it gets the keyword form like arXiv and GitHub do.
    ["wikipedia", () => searchWikipedia(keywords || query, perProvider)],
    ["web", () => searchWeb(query, perProvider)],
    ["arxiv", () => searchArxiv(keywords, perProvider)],
    ["github", () => searchGitHub(keywords, perProvider)],
    ["hackernews", () => searchHackerNews(query, perProvider)]
  ];
  const errors: Partial<Record<ProviderName, string>> = {};
  const now = Date.now();
  const settled = await Promise.allSettled(
    providers.map(([name, run]) => {
      const coolingUntil = providerCooldownUntil.get(name) ?? 0;
      if (coolingUntil > now) {
        return Promise.reject(new Error(`rate-limited, cooling down for ${Math.ceil((coolingUntil - now) / 1000)}s`));
      }
      return run();
    })
  );
  const lists: SearchResult[][] = settled.map((outcome, index) => {
    if (outcome.status === "fulfilled") return outcome.value;
    const name = providers[index][0];
    const message = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
    errors[name] = message;
    // A provider that answered 429/403 is asking us to stop, and one that hangs
    // past the timeout is no healthier — arXiv, when throttling, takes ~15s just
    // to return its 429. A loop that never ends would otherwise hit it again every
    // cycle; back off, doubling on repeats.
    if (/HTTP (429|403)\b|timed out after/.test(message)) {
      const previous = providerCooldownMs.get(name) ?? 0;
      const next = Math.min(PROVIDER_MAX_COOLDOWN_MS, previous > 0 ? previous * 2 : PROVIDER_BASE_COOLDOWN_MS);
      providerCooldownMs.set(name, next);
      providerCooldownUntil.set(name, now + next);
    }
    return [];
  });
  // A provider that answers again resets its backoff.
  settled.forEach((outcome, index) => {
    if (outcome.status === "fulfilled") providerCooldownMs.delete(providers[index][0]);
  });

  // Interleave providers so the first few sources read in a cycle aren't all
  // from one place.
  const seen = new Set<string>();
  const results: SearchResult[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let rank = 0; rank < longest; rank += 1) {
    for (const list of lists) {
      const result = list[rank];
      if (!result || !isPublicHttpUrl(result.url)) continue;
      const key = normalizeUrl(result.url);
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ ...result, url: key });
    }
  }
  return { results, errors };
};

// --- reading -----------------------------------------------------------------

const finish = (url: string, title: string, text: string): FetchedDocument => {
  const trimmed = text.slice(0, MAX_TEXT_CHARS);
  return { url, title, text: trimmed, contentHash: hashText(trimmed) };
};

const fetchWebPage = async (url: string): Promise<FetchedDocument | null> => {
  const response = await politeFetch(url, "text/html,application/xhtml+xml,text/plain;q=0.8");
  if (!response.ok) return null;
  const type = response.headers.get("content-type") ?? "";
  if (!/text\/html|application\/xhtml|text\/plain/i.test(type)) return null;
  const body = await readCapped(response);
  if (/text\/plain/i.test(type)) return finish(url, url, body);
  const { title, text } = htmlToText(body);
  return finish(url, title || url, text);
};

export const fetchDocument = async (result: SearchResult): Promise<FetchedDocument | null> => {
  switch (result.provider) {
    case "wikipedia": {
      const api = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exsectionformat=plain&format=json&titles=${encodeURIComponent(result.title)}`;
      const response = await politeFetch(api, "application/json");
      if (!response.ok) return null;
      const data = (await response.json()) as { query?: { pages?: Record<string, { title?: string; extract?: string }> } };
      const page = Object.values(data.query?.pages ?? {})[0];
      return page?.extract ? finish(result.url, page.title ?? result.title, page.extract) : null;
    }
    case "arxiv":
      // The abstract is the authoritative summary; full PDFs are too large and noisy for a local model.
      return finish(result.url, result.title, `${result.title}\n\n${result.snippet}`);
    case "github": {
      const repo = result.url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)/)?.[1];
      if (!repo) return null;
      const response = await politeFetch(`https://api.github.com/repos/${repo}/readme`, "application/vnd.github.raw", githubHeaders());
      if (!response.ok) return null;
      const readme = await readCapped(response);
      return finish(result.url, result.title, `${result.title}: ${result.snippet}\n\n${readme}`);
    }
    case "hackernews":
      if (/news\.ycombinator\.com\/item/.test(result.url)) {
        return result.snippet ? finish(result.url, result.title, `${result.title}\n\n${result.snippet}`) : null;
      }
      return fetchWebPage(result.url);
    case "web":
    default:
      return fetchWebPage(result.url);
  }
};
