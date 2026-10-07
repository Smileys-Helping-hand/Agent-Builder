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
  const cleaned = block[0].replace(/\b(email|phone|whatsapp|address)\s*:\s*(["'`])([^"'`]*)\2/g, (whole, key: string, quote: string, value: string) => {
    if (given(key, value)) return whole;
    removed.push(key);
    return `${key}: ${quote}${quote}`;
  });
  return { source: source.replace(block[0], cleaned), removed };
};
