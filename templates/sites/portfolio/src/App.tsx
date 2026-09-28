import { useState } from "react";

import { site } from "./content";
import { DemoBanner, Footer, Header, Section, SmartForm, WhatsAppButton, brandStyle, useHashRoute } from "./lib/site";
import { allTags, period, projectsTagged, timeline } from "./work";

function Work() {
  const [tag, setTag] = useState("All");
  const shown = projectsTagged(site.projects, tag);
  return (
    <>
      <section className="hero portfolio-hero">
        <div className="container">
          <p className="eyebrow">{site.hero.greeting}</p>
          <h1>{site.hero.title}</h1>
          <p className="lead muted">{site.business.description}</p>
          <p className="availability">
            <span className="pulse" aria-hidden="true" /> {site.hero.availability}
          </p>
          <div className="btn-row">
            <a className="btn" href="#/contact">
              Start a project
            </a>
            <a className="btn btn-ghost" href="#/about">
              About me
            </a>
          </div>
        </div>
      </section>
      <Section title="Selected work" eyebrow={`${shown.length} projects`}>
        <div className="chip-row tag-filter" role="group" aria-label="Filter by type">
          {["All", ...allTags(site.projects)].map((name) => (
            <button key={name} className={`tag ${tag === name ? "tag-on" : ""}`} aria-pressed={tag === name} onClick={() => setTag(name)}>
              {name}
            </button>
          ))}
        </div>
        <div className="grid grid-2">
          {shown.map((project) => (
            <a key={project.id} href={`#/work/${project.id}`} className="card project-card">
              <div className="project-art" aria-hidden="true">
                {project.emoji}
              </div>
              <div className="chip-row">
                {project.tags.map((name) => (
                  <span key={name} className="chip">
                    {name}
                  </span>
                ))}
              </div>
              <h3>{project.title}</h3>
              <p className="muted">{project.summary}</p>
              <p className="project-meta muted">
                {project.client} · {project.year}
              </p>
            </a>
          ))}
        </div>
      </Section>
    </>
  );
}

export default function App() {
  const route = useHashRoute();
  const [, section, param] = route.split("/");
  const { business } = site;

  let page: JSX.Element;
  const project = section === "work" ? site.projects.find((entry) => entry.id === param) : undefined;

  if (project) {
    page = (
      <Section eyebrow={`${project.client} · ${project.year}`} title={project.title} intro={project.summary}>
        <div className="project-art project-art-large" aria-hidden="true">
          {project.emoji}
        </div>
        <div className="project-story">
          {project.story.map((paragraph) => (
            <p key={paragraph} className="lead">
              {paragraph}
            </p>
          ))}
          <p className="outcome">
            <strong>Outcome:</strong> {project.outcome}
          </p>
          <div className="btn-row">
            <a className="btn btn-ghost" href="#/">
              ← All work
            </a>
            <a className="btn" href="#/contact">
              Work with me
            </a>
          </div>
        </div>
      </Section>
    );
  } else if (section === "about") {
    page = (
      <Section eyebrow="About" title={business.name} intro={business.tagline}>
        <div className="grid grid-2">
          <div>
            {site.about.map((paragraph) => (
              <p key={paragraph} className="lead">
                {paragraph}
              </p>
            ))}
            <h3 style={{ marginTop: 28 }}>What I do</h3>
            <div className="chip-row">
              {site.skills.map((skill) => (
                <span key={skill} className="chip">
                  {skill}
                </span>
              ))}
            </div>
          </div>
          <ol className="timeline">
            {timeline(site.experience).map((role) => (
              <li key={`${role.title}-${role.start}`}>
                <p className="muted timeline-when">{period(role)}</p>
                <h3>{role.title}</h3>
                <p className="muted">
                  {role.place} — {role.text}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </Section>
    );
  } else if (section === "contact") {
    page = (
      <Section eyebrow="Contact" title="Let's make something" intro="Tell me about the project and when you need it. I reply within two working days.">
        <SmartForm
          subject={`Project enquiry for ${business.name}`}
          settings={site.forms}
          fallbackEmail={business.email}
          submitLabel="Send enquiry"
          fields={[
            { name: "name", label: "Your name", required: true },
            { name: "email", label: "Email", type: "email", required: true },
            { name: "company", label: "Company" },
            { name: "budget", label: "Budget", type: "select", options: ["Under R20 000", "R20 000 – R60 000", "R60 000 – R150 000", "Over R150 000"] },
            { name: "timing", label: "When do you need it?" },
            { name: "project", label: "About the project", type: "textarea", required: true }
          ]}
        />
      </Section>
    );
  } else {
    page = <Work />;
  }

  return (
    <div className="site" style={brandStyle(site.brand)}>
      <DemoBanner show={site.demo} label="Portfolio / Personal Site" />
      <Header business={business} nav={site.nav} cta={{ label: "Hire me", href: "#/contact" }} />
      <main>{page}</main>
      <Footer business={business} />
      <WhatsAppButton number={business.whatsapp} />
    </div>
  );
}
