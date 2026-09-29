import { useState, type ReactNode } from "react";

import { site } from "./content";
import { DemoBanner, Footer, Header, Section, SmartForm, brandStyle, useHashRoute } from "./lib/site";
import { findPosts, formatDate, parseMarkdown, readingMinutes, tagsOf, type Block, type Inline, type Post } from "./posts";

function renderInline(parts: Inline[]): ReactNode[] {
  return parts.map((part, index) => {
    switch (part.kind) {
      case "bold":
        return <strong key={index}>{part.text}</strong>;
      case "italic":
        return <em key={index}>{part.text}</em>;
      case "code":
        return <code key={index}>{part.text}</code>;
      case "link":
        return (
          <a key={index} href={part.href} target={part.href.startsWith("#") ? undefined : "_blank"} rel="noreferrer">
            {part.text}
          </a>
        );
      default:
        return part.text;
    }
  });
}

function Article({ blocks }: { blocks: Block[] }) {
  return (
    <div className="prose">
      {blocks.map((block, index) => {
        if (block.kind === "heading") return block.level === 2 ? <h2 key={index}>{renderInline(block.content)}</h2> : <h3 key={index}>{renderInline(block.content)}</h3>;
        if (block.kind === "quote") return <blockquote key={index}>{renderInline(block.content)}</blockquote>;
        if (block.kind === "list") {
          const items = block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>);
          return block.ordered ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>;
        }
        return <p key={index}>{renderInline(block.content)}</p>;
      })}
    </div>
  );
}

function PostCard({ post }: { post: Post }) {
  return (
    <a href={`#/post/${post.slug}`} className="card post-card">
      <span className="post-cover" aria-hidden="true">
        {post.cover}
      </span>
      <div>
        <p className="post-meta muted">
          {formatDate(post.date)} · {readingMinutes(post.body)} min read
        </p>
        <h3>{post.title}</h3>
        <p className="muted">{post.excerpt}</p>
        <div className="chip-row">
          {post.tags.map((tag) => (
            <span key={tag} className="chip">
              {tag}
            </span>
          ))}
        </div>
      </div>
    </a>
  );
}

function Newsletter() {
  return (
    <section id="newsletter" className="section section-tinted">
      <div className="container newsletter">
        <div>
          <p className="eyebrow">Newsletter</p>
          <h2>One useful email a week.</h2>
          <p className="muted">The new article every Tuesday, nothing else. Unsubscribe in one click.</p>
        </div>
        <SmartForm
          subject={`Newsletter sign-up — ${site.business.name}`}
          settings={site.forms}
          fallbackEmail={site.business.email}
          submitLabel="Subscribe"
          successMessage="You're on the list. Look out for Tuesday's email."
          fields={[
            { name: "name", label: "First name" },
            { name: "email", label: "Email", type: "email", required: true }
          ]}
        />
      </div>
    </section>
  );
}

export default function App() {
  const route = useHashRoute();
  const [, section, param] = route.split("/");
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const { business } = site;

  let page: ReactNode;
  const post = section === "post" ? site.posts.find((entry) => entry.slug === param) : undefined;

  if (post) {
    const related = findPosts(site.posts.filter((entry) => entry.slug !== post.slug), "", post.tags[0]).slice(0, 2);
    page = (
      <article className="section">
        <div className="container article">
          <a className="muted back" href="#/">
            ← All articles
          </a>
          <p className="post-meta muted">
            {formatDate(post.date)} · {post.author} · {readingMinutes(post.body)} min read
          </p>
          <h1>{post.title}</h1>
          <p className="lead muted">{post.excerpt}</p>
          <Article blocks={parseMarkdown(post.body)} />
          {related.length > 0 ? (
            <aside className="related">
              <h3>Read next</h3>
              <div className="grid grid-2">
                {related.map((entry) => (
                  <PostCard key={entry.slug} post={entry} />
                ))}
              </div>
            </aside>
          ) : null}
        </div>
      </article>
    );
  } else if (section === "about") {
    page = (
      <Section eyebrow="About" title={business.name} intro={business.tagline}>
        <div className="article">
          {site.about.map((paragraph) => (
            <p key={paragraph} className="lead">
              {paragraph}
            </p>
          ))}
        </div>
      </Section>
    );
  } else {
    const shown = findPosts(site.posts, query, tag);
    page = (
      <>
        <section className="hero blog-hero">
          <div className="container">
            <p className="eyebrow">{site.hero.eyebrow}</p>
            <h1>{site.hero.title}</h1>
            <p className="lead muted">{site.hero.subtitle}</p>
          </div>
        </section>
        <Section title="Latest articles" eyebrow={`${shown.length} of ${site.posts.length}`}>
          <div className="blog-tools">
            <input
              className="search"
              type="search"
              placeholder="Search articles"
              aria-label="Search articles"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="chip-row">
              {["", ...tagsOf(site.posts)].map((name) => (
                <button key={name || "all"} className={`tag ${tag === name ? "tag-on" : ""}`} aria-pressed={tag === name} onClick={() => setTag(name)}>
                  {name || "All"}
                </button>
              ))}
            </div>
          </div>
          {shown.length === 0 ? <p className="muted">No articles match that yet.</p> : null}
          <div className="grid post-list">
            {shown.map((entry) => (
              <PostCard key={entry.slug} post={entry} />
            ))}
          </div>
        </Section>
      </>
    );
  }

  return (
    <div className="site" style={brandStyle(site.brand)}>
      <DemoBanner show={site.demo} label="Blog / Content Platform" />
      <Header business={business} nav={site.nav} cta={{ label: "Subscribe", href: "#newsletter" }} />
      <main>
        {page}
        <Newsletter />
      </main>
      <Footer business={business} />
    </div>
  );
}
