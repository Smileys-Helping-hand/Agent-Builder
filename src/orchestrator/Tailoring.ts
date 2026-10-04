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
