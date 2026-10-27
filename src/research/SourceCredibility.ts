/**
 * SourceCredibility — what kind of evidence a source is.
 *
 * The research loop reads whatever the search providers return, and a topic
 * like "pocket dimensions" pulls in arXiv physics, Wikipedia, worldbuilding
 * guides, a game wiki and "are portals real?" pages side by side. Counted
 * together, a fan wiki "corroborates" a ritual as well as a paper corroborates
 * an experiment, and the summary states fiction as fact. Every report, lesson
 * and answer labels its evidence with the tier below and keeps the tiers apart.
 *
 * Classification is from the address and title only — fast, offline, and the
 * same every time — so it can be shown next to every finding.
 */

export type EvidenceTier =
  /** Peer-reviewed papers, preprints, university and research-institute pages. */
  | "academic"
  /** Encyclopedias, official documentation, standards, government sources. */
  | "reference"
  /** Journalism and established science or tech publications. */
  | "news"
  /** Q&A, forums, code hosting, personal and company blogs: practical, unreviewed. */
  | "community"
  /** Paranormal, esoteric, conspiracy or "is it real?" content: claims without evidence. */
  | "speculative"
  /** Novels, games, film, worldbuilding and fan wikis: invented worlds. */
  | "fiction";

export interface Credibility {
  tier: EvidenceTier;
  /** A short label for the reader: "Peer-reviewed / preprint", "Fiction & worldbuilding"… */
  label: string;
  /** Whether a claim from here may be stated as fact about the real world. */
  factual: boolean;
}

export const TIER_LABEL: Record<EvidenceTier, string> = {
  academic: "Academic research",
  reference: "Reference & official docs",
  news: "News & science press",
  community: "Practitioners, companies & forums",
  speculative: "Speculative / unverified",
  fiction: "Fiction & worldbuilding"
};

/** Strongest first: the order reports and lessons present evidence in. */
export const TIER_ORDER: EvidenceTier[] = ["academic", "reference", "news", "community", "speculative", "fiction"];

const ACADEMIC_HOSTS = [
  "arxiv.org", "nature.com", "science.org", "sciencemag.org", "cell.com", "pnas.org", "aps.org", "iop.org", "iopscience.iop.org",
  "springer.com", "link.springer.com", "sciencedirect.com", "elsevier.com", "wiley.com", "onlinelibrary.wiley.com", "tandfonline.com",
  "acm.org", "dl.acm.org", "ieee.org", "ieeexplore.ieee.org", "plos.org", "journals.plos.org", "frontiersin.org", "mdpi.com",
  "biorxiv.org", "medrxiv.org", "ssrn.com", "researchgate.net", "semanticscholar.org", "jstor.org", "ncbi.nlm.nih.gov", "pubmed.ncbi.nlm.nih.gov",
  "nih.gov", "cern.ch", "home.cern", "nasa.gov", "esa.int", "aip.org", "pubs.aip.org", "acs.org", "pubs.acs.org", "royalsocietypublishing.org",
  "annualreviews.org", "openreview.net", "aclanthology.org", "proceedings.mlr.press", "neurips.cc", "jmlr.org", "quantum-journal.org",
  "scholar.google.com", "plato.stanford.edu"
];
const REFERENCE_HOSTS = [
  "wikipedia.org", "wikimedia.org", "wiktionary.org", "britannica.com", "developer.mozilla.org", "w3.org", "whatwg.org", "ietf.org", "rfc-editor.org", "iso.org",
  "docs.python.org", "docs.github.com", "learn.microsoft.com", "docs.microsoft.com", "developer.apple.com", "developer.android.com",
  "cloud.google.com", "docs.aws.amazon.com", "aws.amazon.com", "kubernetes.io", "react.dev", "nodejs.org", "typescriptlang.org",
  "docs.unity3d.com", "docs.unity.com", "create.roblox.com", "docs.blender.org", "who.int", "europa.eu", "un.org", "oecd.org", "nist.gov"
];
const NEWS_HOSTS = [
  "bbc.co.uk", "bbc.com", "reuters.com", "apnews.com", "theguardian.com", "nytimes.com", "washingtonpost.com", "economist.com", "ft.com",
  "scientificamerican.com", "newscientist.com", "quantamagazine.org", "phys.org", "sciencedaily.com", "space.com", "livescience.com",
  "wired.com", "arstechnica.com", "theverge.com", "techcrunch.com", "technologyreview.com", "spectrum.ieee.org", "nationalgeographic.com",
  "smithsonianmag.com", "theconversation.com", "bloomberg.com", "cnbc.com", "forbes.com", "news24.com", "dailymaverick.co.za"
];
const COMMUNITY_HOSTS = [
  "stackoverflow.com", "stackexchange.com", "superuser.com", "serverfault.com", "github.com", "gitlab.com", "news.ycombinator.com",
  "reddit.com", "medium.com", "dev.to", "hashnode.dev", "substack.com", "quora.com", "npmjs.com", "devforum.roblox.com",
  "discussions.unity.com", "forum.unity.com", "blenderartists.org", "youtube.com", "linkedin.com", "freecodecamp.org", "css-tricks.com",
  "smashingmagazine.com", "hackernoon.com", "towardsdatascience.com"
];
const FICTION_HOSTS = [
  "fandom.com", "wikia.com", "wikia.org", "worldanvil.com", "tvtropes.org", "fanfiction.net", "archiveofourown.org", "scp-wiki.net",
  "scpwiki.com", "goodreads.com", "imdb.com", "wattpad.com", "dndbeyond.com", "roll20.net", "ign.com", "gamespot.com", "polygon.com",
  "kotaku.com", "pcgamer.com", "gamerant.com", "screenrant.com", "cbr.com", "marvel.com", "dc.com", "starwars.com"
];
const SPECULATIVE_HOSTS = [
  "gaia.com", "ancient-origins.net", "collective-evolution.com", "thoughtco.com/paranormal", "mysteriousuniverse.org", "coasttocoastam.com",
  "unexplained-mysteries.com", "in5d.com", "spiritualunite.com", "learnreligions.com", "astrology.com", "exemplore.com", "medium.com/@"
];

/** Unmistakably about an invented world, even on Wikipedia: these override a trusted host. */
const FICTION_STRONG = /(list of .{2,60} characters|\bcharacters? (?:in|of) (?:the )?[A-Z]|\bfictional\b|\((?:video game|film|novel|tv series|comics?|anime|manga|franchise|book series)\)|cinematic universe|\bmarvel comics\b|\bdc comics\b|\bapex legends\b|my little pony|dungeons? (?:&|and) dragons|\bd&d\b|\bstar wars\b|\bstar trek\b|harry potter|doctor who|stranger things|\bscp-\d+\b)/i;
/** Fiction cues that are only trusted on an unknown host ("novel", "film" and "game" are ordinary words in papers). */
const FICTION_WORDS = /\b(fiction|worldbuilding|world-building|lore|fan ?fic(?:tion)?|fandom|anime|manga|comic books?|tabletop|rpg|video ?games?|game mechanics|homebrew|campaign setting|writing prompts?|minecraft|fortnite)\b/i;
const SPECULATIVE_WORDS = /\b(paranormal|supernatural|occult|esoteric|mystic(?:al|ism)?|spirituality|astral|chakras?|ley lines?|energy vortex|ancient aliens?|conspiracy|psychic|telepathy|manifestation|law of attraction|portals? (?:are )?real|real portals?|is it real\??|are .{2,40} real\??|interdimensional beings?|starseeds?|crystal healing|ghosts?|haunted|cryptids?|alien abductions?)\b/i;

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

const onHost = (host: string, list: string[]): boolean => list.some((entry) => host === entry || host.endsWith(`.${entry}`));

/** The evidence tier of a source, from its address and title. */
export const classifySource = (url: string | null | undefined, title?: string | null): Credibility => {
  const host = hostOf(url ?? "");
  const text = `${title ?? ""} ${url ?? ""}`;
  const make = (tier: EvidenceTier): Credibility => ({ tier, label: TIER_LABEL[tier], factual: tier === "academic" || tier === "reference" || tier === "news" });

  // Hosts decide first; words only for hosts we know nothing about.
  if (onHost(host, FICTION_HOSTS)) return make("fiction");
  if (onHost(host, SPECULATIVE_HOSTS)) return make("speculative");
  const academic = onHost(host, ACADEMIC_HOSTS) || /\.(edu|ac\.[a-z]{2})$/.test(host) || /\.edu\./.test(host);
  const reference = onHost(host, REFERENCE_HOSTS) || /\.gov(\.[a-z]{2})?$/.test(host) || /^docs\./.test(host);
  const news = onHost(host, NEWS_HOSTS);
  // An encyclopedia page about a fictional universe describes invented things.
  if ((reference || news) && FICTION_STRONG.test(title ?? "")) return make("fiction");
  if (academic) return make("academic");
  if (reference) return make("reference");
  if (news) return make("news");
  if (FICTION_STRONG.test(text) || FICTION_WORDS.test(text)) return make("fiction");
  if (SPECULATIVE_WORDS.test(text)) return make("speculative");
  return make("community");
};

/** A one-word badge for a finding line: "[academic]". */
export const tierTag = (url: string | null | undefined, title?: string | null): string => `[${classifySource(url, title).tier}]`;
