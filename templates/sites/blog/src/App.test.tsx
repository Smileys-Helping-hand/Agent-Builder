import { describe, expect, it } from "vitest";

import App from "./App";
import { site } from "./content";
import { esc, renderAt } from "./lib/testing";
import { findPosts, parseInline, parseMarkdown, readingMinutes, tagsOf } from "./posts";

describe("markdown", () => {
  it("reads headings, paragraphs, lists and quotes", () => {
    const blocks = parseMarkdown("## Title\n\nOne\ntwo\n\n- a\n- b\n\n1. x\n2. y\n\n> said");
    expect(blocks.map((block) => block.kind)).toEqual(["heading", "paragraph", "list", "list", "quote"]);
    expect(blocks[1]).toEqual({ kind: "paragraph", content: [{ kind: "text", text: "One two" }] });
    expect(blocks[2]).toMatchObject({ ordered: false });
    expect(blocks[3]).toMatchObject({ ordered: true });
  });

  it("reads bold, italic, code and links", () => {
    expect(parseInline("a **b** *c* `d` [e](https://f.example)")).toEqual([
      { kind: "text", text: "a " },
      { kind: "bold", text: "b" },
      { kind: "text", text: " " },
      { kind: "italic", text: "c" },
      { kind: "text", text: " " },
      { kind: "code", text: "d" },
      { kind: "text", text: " " },
      { kind: "link", text: "e", href: "https://f.example" }
    ]);
  });

  it("never turns a script link into a link", () => {
    expect(parseInline("[click](javascript:alert(1))")).toEqual([{ kind: "text", text: "click" }, { kind: "text", text: ")" }]);
    const html = renderAt(<App />, "#/post/nope");
    expect(html).not.toContain("javascript:");
  });
});

describe("posts", () => {
  it("estimates at least a minute of reading", () => {
    expect(readingMinutes("short")).toBe(1);
    expect(readingMinutes("word ".repeat(1100))).toBe(5);
  });

  it("searches every word, filters by tag and sorts newest first", () => {
    expect(findPosts(site.posts, "provisional tax")).toHaveLength(1);
    expect(findPosts(site.posts, "", "Getting started").every((post) => post.tags.includes("Getting started"))).toBe(true);
    const all = findPosts(site.posts);
    expect(all[0].date >= all[all.length - 1].date).toBe(true);
    expect(tagsOf(site.posts)).toContain("Pricing");
  });
});

describe("pages", () => {
  it("the home page lists every post", () => {
    const html = renderAt(<App />);
    for (const post of site.posts) expect(html).toContain(esc(post.title));
    expect(html).toContain('id="newsletter"');
  });

  it("a post page renders its Markdown as real elements", () => {
    const [post] = site.posts;
    const html = renderAt(<App />, `#/post/${post.slug}`);
    expect(html).toContain("<h2>Who has to pay it</h2>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain('href="https://www.sars.gov.za"');
  });

  it("an unknown post falls back to the list", () => {
    expect(renderAt(<App />, "#/post/nope")).toContain("Latest articles");
  });
});
