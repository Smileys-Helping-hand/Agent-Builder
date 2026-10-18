/**
 * A website asked for in a sentence starts as our closest finished site.
 *
 * The Template Academy and customer orders start from a site template that
 * already passes every check (templates/sites: restaurant, booking, shop,
 * event, portfolio, saas, blog, landing), keep its kit locked, and have the
 * model tailor the page. That path reaches 100: Law Firm passed in one pass.
 * A prompt that started from the bare web starter had the model write a whole
 * site from nothing, and sat at 55 with type errors for hours.
 *
 * So a request for a website (a business, a page, a presence — not an app, a
 * game or a tool) is set up the same way: the closest site copied into a new
 * build folder, and a brief that says to tailor it. What is not a website
 * keeps the web starter.
 */
import fs from "fs";
import path from "path";

const TEMPLATES = () => path.resolve(process.env.TEMPLATES_DIR ?? "templates/sites");

/** Words that pick a starter, checked against the name first, then the brief. */
const STARTERS: Array<{ id: string; words: RegExp }> = [
  // Listings with prices, filters and a detail each: a shop's catalogue is the closest page (its cart is what goes).
  // Before this, a real estate agency started from the solar company's landing page and went round in type errors.
  { id: "ecommerce", words: /\b(real[- ]?estate|propert(y|ies)|estate agen|realtor|rentals?\b|lettings?\b|listings?\b|car (dealer|sales)|dealership)/i },
  { id: "booking", words: /\b(book|appointment|clinic|dental|dentist|doctor|physio|therap|salon|spa\b|barber|beauty|nail|vet|tutor|lesson|yoga|pilates|gym|fitness|trainer|consult|law\b|lawyer|attorney|legal|accountant|accounting|bookkeep|coach|counsel)/i },
  { id: "restaurant", words: /\b(restaurant|caf[eé]|coffee|bakery|bistro|food|menu|takeaway|pizza|bar\b|pub\b|catering|braai)/i },
  { id: "ecommerce", words: /\b(shop|store|boutique|retail|products?\b|merch|cart\b)/i },
  { id: "event", words: /\b(event|wedding|conference|festival|concert|party|ticket|invitation)/i },
  { id: "portfolio", words: /\b(portfolio|photograph|designer|artist|architect|creative|freelanc)/i },
  { id: "saas", words: /\b(saas|software|platform|startup|subscription|dashboard)/i },
  { id: "blog", words: /\b(blog|magazine|news|journal|writer|publication|podcast)/i }
];

export function starterFor(idea: { name: string; category?: string; brief: string }): string {
  const named = `${idea.name} ${idea.category ?? ""}`;
  const pick = STARTERS.find((starter) => starter.words.test(named)) ?? STARTERS.find((starter) => starter.words.test(idea.brief));
  const id = pick?.id ?? "landing";
  return fs.existsSync(path.join(TEMPLATES(), id, "src", "content.ts")) ? id : "landing";
}

/** The invented business a starter template is written for ("Studio Nova Hair"). */
export const sampleBusiness = (starter: string): string | null => {
  try {
    const content = fs.readFileSync(path.join(TEMPLATES(), starter, "src", "content.ts"), "utf8");
    return content.match(/^\s+name:\s*"([^"]+)"/m)?.[1] ?? null;
  } catch {
    return null;
  }
};

/** Asked for a website: a site, a page, an online presence. */
const SITE = /\b(web\s?sites?|sites?\b|landing\s?pages?|home\s?pages?|web\s?pages?|online\s+presence|one[- ]pager)\b/i;
/**
 * Something a site template is not: an app with its own data and screens, a
 * game, a tool. "A website for my gym with a booking form" is a site; "a
 * workout tracker" is an app.
 */
const NOT_A_SITE =
  /\b(apps?\b|application|tracker|tracking|dashboard|calculator|games?\b|tool\b|todo|to-do|planner|editor|chat\b|messenger|quiz|timer|converter|generator|crm\b|inventory|budget(?:ing)?\b|spreadsheet|kanban|whiteboard|admin panel|login system|social network|marketplace platform|extension|bot\b|api\b)/i;

/** True when the words ask for a website that one of our site templates can become. */
export function isWebsiteRequest(projectName: string, description: string): boolean {
  const text = `${projectName} ${description}`;
  return SITE.test(text) && !NOT_A_SITE.test(text);
}

/** The business's name, when the words give one: quoted, "called …", or "my bakery Sweet Crumbs". */
export function businessName(projectName: string, description: string): string | null {
  const quoted = /["“']([A-Z][^"”'\n]{1,48})["”']/.exec(description)?.[1];
  if (quoted) return quoted.trim();
  const called = /\b(?:called|named)\s+([A-Z][\w'&.-]*(?:\s+(?:[A-Z][\w'&.-]*|&|of|and|the))*)/.exec(description)?.[1];
  if (called) return called.trim();
  const mine = /\bmy\s+[a-z]+(?:\s+[a-z]+)?\s+([A-Z][\w'&.-]*(?:\s+[A-Z][\w'&.-]*){0,4})/.exec(description)?.[1];
  if (mine) return mine.trim();
  const name = projectName.trim();
  return name && !/^(?:my\s+)?(?:new\s+)?(?:web\s?site|site|page|project|business|app)$/i.test(name) && !/^jarvis request$/i.test(name) ? name : null;
}

/** What the template is called in its own template.json. */
const templateName = (starter: string): string => {
  try {
    return (JSON.parse(fs.readFileSync(path.join(TEMPLATES(), starter, "template.json"), "utf8")) as { name?: string }).name ?? starter;
  } catch {
    return starter;
  }
};

/**
 * What the words list for the site to show: "show our menu with prices,
 * opening hours, a photo gallery and an order form" → four items. Only a list
 * after a word that introduces one (show, with, include, need…), so a sentence
 * that names no parts adds nothing. The build's completeness check grades
 * each one (Completeness.unshownItems).
 */
export function askedItems(description: string): string[] {
  const out: string[] = [];
  const lead = /\b(?:show(?:s|ing)?|with|includ(?:e|es|ing)|ha(?:s|ve)|need(?:s)?|featur(?:e|es|ing)|plus|offer(?:s|ing)?)\b\s*:?\s*(.+)$/i;
  for (const sentence of description.replace(/\r?\n/g, ". ").split(/[.!?]\s+/)) {
    const tail = lead.exec(sentence)?.[1];
    if (!tail || !/,|\band\b|&/.test(tail)) continue;
    for (const part of tail.split(/,|;|\band\b|&/)) {
      const item = part
        .trim()
        .replace(/^(?:also|then|a|an|the|our|my|some|their)\s+/i, "")
        .replace(/[.:]+$/, "")
        .trim();
      if (item.length >= 3 && item.length <= 60 && !out.includes(item)) out.push(item);
    }
  }
  return out.slice(0, 10);
}

/** The brief a website built from a template is given: the person's words first, then how to tailor it. */
export function siteBrief(description: string, starter: string, business: string | null): string {
  const was = sampleBusiness(starter);
  const items = askedItems(description);
  return [
    `The project is our "${templateName(starter)}" site template (a ${starter} site), which already works. Tailor it into the website asked for below. Do not start again.`,
    "",
    business ? `Business: ${business}` : "",
    "What was asked for, in their words:",
    description.trim(),
    "",
    ...(items.length ? ["The site must show:", ...items.map((item) => `- ${item}`), ""] : []),
    "How to build it:",
    "- Everything asked for above, visible on the page: in the section it belongs to, or as a feature, an FAQ answer or a line in a list when no section fits",
    "- Every word on the site in src/content.ts, about this business; where the words above give details (names, items, prices, hours), those exact details",
    "- Never invent contact details: a phone, WhatsApp number, email or street address not given above is left out, not made up",
    "- The kit in src/lib (site.tsx, customize.ts, pro.tsx, hours.ts) kept as it is and used: Section, SmartForm, Header, Footer, WhatsAppButton, brandStyle",
    `- Nothing left from ${was ? `${was}, the sample business` : "the template"} this started as: its name, wording, prices and features that do not fit replaced or removed`,
    "- Forms validate what is typed and say what went wrong",
    "- Works on phones first, and looks finished: no placeholder text, no lorem ipsum, no TODO",
    "",
    "Look and feel:",
    "- Premium: the signature components in src/lib/pro.tsx (Aurora, SplitHeadline, Tilt, CountUp, Marquee, ScrollProgress) and cards with the spotlight and lift classes",
    "- Brand colours in src/content.ts that suit this business"
  ]
    .filter((line, index, all) => line !== "" || all[index - 1] !== "")
    .join("\n");
}

/**
 * Copy the closest site template into a new build folder (its template.json
 * kept, so the kit stays locked and the page is tailored, as for an order).
 * Null when there is no such template on this machine.
 */
export function prepareSite(projectName: string, description: string): { dir: string; starter: string; brief: string } | null {
  const starter = starterFor({ name: projectName, brief: description });
  const source = path.join(TEMPLATES(), starter);
  if (!fs.existsSync(path.join(source, "package.json")) || !fs.existsSync(path.join(source, "template.json"))) return null;
  const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "site";
  const dir = path.resolve("builds", `site_${slug}_${Date.now()}`);
  fs.cpSync(source, dir, { recursive: true, filter: (from) => !/[\\/](node_modules|dist|\.git)([\\/]|$)/.test(from.slice(source.length)) });
  const ignore = path.join(dir, ".gitignore");
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, "node_modules/\ndist/\n.env\n", "utf8");
  return { dir, starter, brief: siteBrief(description, starter, businessName(projectName, description)) };
}
