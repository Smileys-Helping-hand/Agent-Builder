/**
 * Posts: reading time, search, tags, and a small Markdown reader.
 *
 * The reader handles what a post actually needs — headings, paragraphs,
 * lists, quotes, **bold**, *italic*, `code` and [links](https://…) — and turns
 * them into data the page renders as React elements. It never produces raw
 * HTML, so nothing written in a post can run as script on the page.
 */
export interface Post {
  slug: string;
  title: string;
  date: string;
  author: string;
  tags: string[];
  excerpt: string;
  /** The post in Markdown. */
  body: string;
  cover: string;
}

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "heading"; level: 2 | 3; content: Inline[] }
  | { kind: "paragraph"; content: Inline[] }
  | { kind: "quote"; content: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] };

const WORDS_PER_MINUTE = 220;

export function readingMinutes(markdown: string): number {
  const words = markdown.replace(/[#>*_`[\]()-]/g, " ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/** Only web and mail links; anything else (javascript:, data:) is shown as text. */
const safeHref = (href: string): string | null => (/^(https?:\/\/|mailto:|#)/i.test(href.trim()) ? href.trim() : null);

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const pattern = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > last) out.push({ kind: "text", text: text.slice(last, match.index) });
    if (match[1] !== undefined) out.push({ kind: "bold", text: match[1] });
    else if (match[2] !== undefined) out.push({ kind: "italic", text: match[2] });
    else if (match[3] !== undefined) out.push({ kind: "code", text: match[3] });
    else {
      const href = safeHref(match[5]);
      out.push(href ? { kind: "link", text: match[4], href } : { kind: "text", text: match[4] });
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

export function parseMarkdown(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: Inline[][] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", content: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ kind: "list", ...list });
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const numbered = /^\d+\.\s+(.*)$/.exec(line);

    if (!line) {
      flushParagraph();
      flushList();
    } else if (line.startsWith("### ")) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "heading", level: 3, content: parseInline(line.slice(4)) });
    } else if (line.startsWith("## ")) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "heading", level: 2, content: parseInline(line.slice(3)) });
    } else if (line.startsWith("> ")) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "quote", content: parseInline(line.slice(2)) });
    } else if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push(parseInline((bullet ?? numbered)![1]));
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** Posts matching every word in the query and, if given, the tag. Newest first. */
export function findPosts(posts: Post[], query = "", tag = ""): Post[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return posts
    .filter((post) => !tag || post.tags.includes(tag))
    .filter((post) => {
      const haystack = `${post.title} ${post.excerpt} ${post.body} ${post.tags.join(" ")}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function tagsOf(posts: Post[]): string[] {
  return [...new Set(posts.flatMap((post) => post.tags))].sort();
}

export function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
}
