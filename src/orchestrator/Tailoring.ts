/**
 * Tailoring — the customer's own details, read from their brief and put into a
 * template's content module without asking the model. A wrong phone number on
 * a client's site is the worst kind of mistake, and these are facts the
 * customer already gave: the model is good at wording, not at copying digits.
 *
 * Reads "Business: …" (orders from the site carry it), an email address, and
 * phone/WhatsApp numbers from the brief; writes them over the template's
 * sample values for the matching keys (name, email, phone, whatsapp).
 */

export interface CustomerFacts {
  business: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
}

/** A South African (or any international-looking) phone number: +27 82 555 0199, 011 555 0199. */
const PHONE = /(\+?\d[\d\s-]{7,15}\d)/;

export const readFacts = (brief: string): CustomerFacts => {
  const business = /(?:^|\n)\s*Business:\s*([^\n]{2,80})/i.exec(brief)?.[1]?.trim().replace(/[."]+$/, "") ?? null;
  const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/.exec(brief)?.[0] ?? null;
  // A number that comes after the word WhatsApp is the WhatsApp number; one after Phone/Tel/Call is the phone.
  const after = (words: RegExp): string | null => {
    const match = new RegExp(`(?:${words.source})[^\\d+\\n]{0,40}${PHONE.source}`, "i").exec(brief);
    return match ? match[1].replace(/\s+/g, " ").trim() : null;
  };
  const whatsapp = after(/whats\s?app/);
  let phone = after(/phone|tel(?:ephone)?|call|cell|mobile/);
  if (!phone) {
    // Any other number in the brief that is not the WhatsApp one.
    const all = Array.from(brief.matchAll(new RegExp(PHONE.source, "g"))).map((m) => m[1].replace(/\s+/g, " ").trim());
    phone = all.find((number) => number !== whatsapp && number.replace(/\D/g, "").length >= 9) ?? null;
  }
  return { business, email, phone, whatsapp: whatsapp ?? null };
};

/** The string value of `key: "..."` inside the business block, if there is one. */
const sampleValue = (source: string, key: string): string | null =>
  new RegExp(`business\\s*:\\s*\\{[\\s\\S]*?\\b${key}\\s*:\\s*(["'\`])([^"'\`]+)\\1`).exec(source)?.[2] ?? null;

const clean = (value: string) => value.replace(/["`\\]/g, "");

/** The content module with the customer's facts in place of the sample's. */
export const applyFacts = (source: string, facts: CustomerFacts): { source: string; changed: string[] } => {
  let out = source;
  const changed: string[] = [];
  const swap = (key: string, value: string | null, everywhere = false) => {
    if (!value) return;
    const sample = sampleValue(source, key);
    if (!sample || sample === value) return;
    out = everywhere ? out.split(sample).join(clean(value)) : out.replace(sample, clean(value));
    changed.push(key);
  };
  swap("name", facts.business, true);
  swap("email", facts.email);
  swap("phone", facts.phone);
  swap("whatsapp", facts.whatsapp ?? facts.phone);
  return { source: out, changed };
};

/** Sample contact details still there although the customer gave their own. */
export const sampleFactsLeft = (original: string, now: string, facts: CustomerFacts): string[] => {
  const left: string[] = [];
  for (const [key, given] of [
    ["email", facts.email],
    ["phone", facts.phone],
    ["whatsapp", facts.whatsapp ?? facts.phone]
  ] as const) {
    const sample = sampleValue(original, key);
    if (given && sample && now.includes(sample)) left.push(`${key} is still the sample's ${sample} (the customer gave ${given})`);
  }
  // The sample's invented brand also turns up in handles and links ("@saltandember", "saltandember.example").
  const brand = /@([a-z0-9-]{5,})\./i.exec(sampleValue(original, "email") ?? "")?.[1];
  const theirs = facts.email ? /@([a-z0-9-]+)\./i.exec(facts.email)?.[1] : null;
  if (brand && facts.business && brand !== theirs && now.toLowerCase().includes(brand.toLowerCase())) {
    left.push(`the sample's invented brand "${brand}" is still in it (social handles, links or addresses)`);
  }
  return left;
};

/**
 * Contact details the customer never gave, emptied. A tailored RPG for a comic
 * shop came back with an email, a WhatsApp number and a street address the
 * model made up: on a live site a made-up number rings a stranger. A value
 * stays when the brief has it (digits for numbers, the words of an address);
 * anything else becomes "" and the template hides it. Returns what went.
 */
export const stripInventedContact = (source: string, brief: string): { source: string; removed: string[] } => {
  const block = /business\s*:\s*\{[\s\S]*?\n\s*\}/.exec(source);
  if (!block) return { source, removed: [] };
  const digits = (value: string) => value.replace(/\D/g, "").replace(/^27/, "0");
  const briefNumbers = Array.from(brief.matchAll(new RegExp(PHONE.source, "g"))).map((m) => digits(m[1]));
  const briefText = brief.toLowerCase();
  const given = (key: string, value: string): boolean => {
    if (!value.trim()) return true;
    if (key === "email") return briefText.includes(value.toLowerCase());
    if (key === "phone" || key === "whatsapp") return briefNumbers.includes(digits(value));
    // An address is given when every word and number of it is in the brief ("Cape Town" yes, "429 Kalk Street" no).
    const parts = (value.toLowerCase().match(/[a-z]{3,}|\d+/g) ?? []).filter((word) => !/^(street|road|avenue|drive|lane|south|africa)$/.test(word));
    return parts.length > 0 && parts.every((part) => briefText.includes(part));
  };
  const removed: string[] = [];
  let cleaned = block[0].replace(/\b(email|phone|whatsapp|address)\s*:\s*(["'`])([^"'`]*)\2/g, (whole, key: string, quote: string, value: string) => {
    if (given(key, value)) return whole;
    removed.push(key);
    return `${key}: ${quote}${quote}`;
  });
  // A social account they did not name (instagram.com/comicvault) may be someone else's.
  let socialGone = false;
  cleaned = cleaned.replace(/\{\s*label\s*:\s*(["'`])[^"'`]*\1\s*,\s*url\s*:\s*(["'`])([^"'`]*)\2\s*\}\s*,?\s*/g, (whole, _q1: string, _q2: string, url: string) => {
    const handle = url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "").toLowerCase();
    const tail = handle.split("/").pop() ?? handle;
    // A handle they wrote ("@comicvault"), not the start of an email address (thabo@comicvault.co.za).
    const named = tail.length > 2 && new RegExp(`(^|[^\\w.])@${tail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w.])`).test(briefText);
    if (briefText.includes(handle) || named) return whole;
    socialGone = true;
    return "";
  });
  if (socialGone) removed.push("social links");
  return { source: source.replace(block[0], cleaned), removed };
};

const MEAT = /\b(meat|meats|beef|steak|sirloin|rump|chicken|lamb|mutton|pork|bacon|ham|sausage|boerewors|biltong|fish|prawns?|shrimp|calamari|squid|tuna|salmon|hake|seafood|oxtail|tripe|liver|duck|venison|anchov(y|ies)|gelatine?)\b/i;
const ANIMAL = /\b(cheese|cheesecake|cream|creamy|butter|buttermilk|milk|yoghurt|yogurt|custard|egg|eggs|honey|mayo|mayonnaise|labneh|feta|halloumi|ghee|whey)\b/i;
/** Wheat and what is made from it. */
const GLUTEN = /\b(bread|breads|bun|buns|roll|rolls|roti|naan|pita|pitta|wrap|wraps|tortillas?|pastry|pastries|pie|pies|cake|cakes|sponge|biscuits?|cookies?|scones?|pasta|spaghetti|noodles?|lasagne|lasagna|couscous|bulgur|flour|wheat|barley|rye|semolina|batter|battered|crumbed|breaded|crumbs|dumplings?|pancakes?|waffles?|pizza|bunny chow|samoosas?|samosas?|vetkoek|koeksisters?|croutons?|crust|beer)\b/i;
/** What a dish can be made with instead: rice noodles, almond flour, a gluten-free bun. */
const GLUTEN_FREE_KIND = /\bgluten[- ]free\s+\w+|\b(rice|corn|maize|chickpea|almond|buckwheat|cassava|coconut|potato|sorghum)\s+(flour|noodles?|pasta|wraps?|bread|cakes?|crust|pancakes?|batter)\b|\b(cauliflower|polenta)\s+crust\b/gi;

/**
 * Diet tags a dish's own description contradicts, taken off: a tailored menu
 * had "Bunny Chow — filled with various meats · Vegetarian" and a vegan
 * cheesecake. Someone choosing by these tags may have a reason to. Meat or
 * fish rules out vegetarian and vegan; dairy, egg or honey rules out vegan;
 * bread, pastry or pasta rules out gluten-free.
 * Returns the source and the dishes changed.
 */
export const fixDietTags = (source: string): { source: string; fixed: string[] } => {
  const fixed: string[] = [];
  const out = source.replace(
    /\{\s*name\s*:\s*(["'`])([^"'`]+)\1\s*,\s*description\s*:\s*(["'`])([^"'`]*)\3([^{}]*?)diet\s*:\s*\[([^\]]*)\]/g,
    (whole, _q: string, name: string, _q2: string, description: string, middle: string, tags: string) => {
      const text = `${name} ${description}`;
      const list = Array.from(tags.matchAll(/(["'`])([^"'`]+)\1/g)).map((m) => m[2]);
      const keep = list.filter((tag) => {
        const t = tag.toLowerCase();
        if ((t === "vegetarian" || t === "vegan") && MEAT.test(text)) return false;
        // Coconut cream, almond milk and peanut butter are plants.
        const plantless = text.replace(/\b(coconut|oat|soy|soya|almond|cashew|rice|peanut|nut|vegan|plant[- ]based|cocoa|shea)\s+(cream|milk|butter|cheese|mayo|mayonnaise|yoghurt|yogurt)\b/gi, "");
        if (t === "vegan" && ANIMAL.test(plantless)) return false;
        // Bread, pastry or pasta rules out gluten-free: a tailored menu had
        // "steamed bread filled with a savory curry · Gluten-free".
        if (t === "gluten-free" && GLUTEN.test(text.replace(GLUTEN_FREE_KIND, ""))) return false;
        return true;
      });
      if (keep.length === list.length) return whole;
      fixed.push(name);
      return whole.replace(/diet\s*:\s*\[[^\]]*\]/, `diet: [${keep.map((tag) => JSON.stringify(tag)).join(", ")}]`);
    }
  );
  return { source: out, fixed };
};

/** A string literal in a source file: where it is, its quote and its text as written. */
interface Literal {
  start: number;
  end: number;
  quote: string;
  text: string;
}

/** The single- and double-quoted strings of a source file, in order, skipping comments and template strings. */
const literals = (source: string): Literal[] => {
  const found: Literal[] = [];
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "/" && source[i + 1] === "/") {
      i = source.indexOf("\n", i);
      if (i === -1) break;
    } else if (ch === "/" && source[i + 1] === "*") {
      i = source.indexOf("*/", i + 2);
      if (i === -1) break;
      i++;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < source.length && source[j] !== ch && !(ch !== "`" && source[j] === "\n")) j += source[j] === "\\" ? 2 : 1;
      if (ch !== "`") found.push({ start: i, end: j + 1, quote: ch, text: source.slice(i + 1, j) });
      i = j;
    }
  }
  return found;
};

/** Whether a string is wording a visitor reads, not a path, link, colour, key or type name. */
const isWording = (text: string): boolean =>
  text.length >= 4 && /[A-Za-z]{3}/.test(text) && /\s/.test(text) && !/^(\.|\/|#|https?:|mailto:|tel:)/.test(text) && !/@/.test(text);

/**
 * The visitor-facing wording of a content module, in order and without
 * repeats: what a reword asks the model to replace, line by line.
 */
export const sampleWording = (source: string): string[] =>
  Array.from(
    new Set(
      literals(source)
        // A record's name in sample data (a dashboard's customers: { id, name, plan, status }) is data, not wording:
        // reworded, a customer came out called "Enhance your business operations with PayPilot".
        .filter((l) => {
          if (!/\bname\s*:\s*$/.test(source.slice(Math.max(0, l.start - 20), l.start))) return true;
          const open = source.lastIndexOf("{", l.start);
          const close = source.indexOf("}", l.end);
          return !/\b(id|plan|status|joined|mrr|role|amount|date)\s*:/.test(source.slice(open, close));
        })
        .map((l) => l.text)
        .filter(isWording)
    )
  );

/**
 * The prompt for a reword: the customer's brief and the sample wording,
 * numbered, answered as JSON. A small model asked to rewrite a whole content
 * module dropped its exports or left it unparseable five repairs running;
 * asked for new sentences only, it cannot touch the shape at all.
 */
export const rewordPrompt = (brief: string, wording: string[]): string => `You are tailoring a website template for a paying customer.

What the customer asked for:
${brief.split(/\nThey chose /)[0].slice(0, 3000)}

Below is the template's sample wording, numbered. It describes an invented business. Write a replacement for each
line that fits the customer's business instead: the same kind of text, about the same length, specific to them.
Never invent a phone number, email, street address or social account.

${wording.map((text, i) => `${i + 1}. ${text}`).join("\n")}

Answer with JSON only: {"1": "new text for line 1", "2": "new text for line 2", ...}`;

/** The reworded lines in place of the sample's, exactly where they were. Returns the source and how many lines changed. */
export const applyRewording = (source: string, wording: string[], answer: string): { source: string; changed: number } => {
  let replies: Record<string, unknown> = {};
  try {
    replies = JSON.parse(/\{[\s\S]*\}/.exec(answer)?.[0] ?? "{}");
  } catch {
    return { source, changed: 0 };
  }
  const next = new Map<string, string>();
  wording.forEach((old, i) => {
    const reply = replies[String(i + 1)];
    if (typeof reply !== "string") return;
    const clean = reply.trim().replace(/[\r\n]+/g, " ");
    if (clean && clean !== old && clean.length <= old.length * 3 + 80) next.set(old, clean);
  });
  let out = source;
  let changed = 0;
  for (const literal of literals(source).reverse()) {
    const reply = next.get(literal.text);
    if (reply === undefined) continue;
    const escaped = reply.replace(/\\/g, "\\\\").split(literal.quote).join(`\\${literal.quote}`);
    out = out.slice(0, literal.start) + literal.quote + escaped + literal.quote + out.slice(literal.end);
    changed++;
  }
  return { source: out, changed };
};

