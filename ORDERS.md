# Orders — from "someone wants a website" to a finished one

Agent Builder can take work from your site, build it, and keep improving what it
delivered. This is how that fits together and how you drive it.

## The short version

```
arpcloudsolutions.co.za          your PC                          the app
─────────────────────────        ──────────────────────           ──────────────
shows what the PC can build ◀── builder publishes its catalogue
customer orders / pays, or
you accept their quote
                          ──▶  builder polls and takes it in  ──▶  shows as New
                                paid? queued straight away          or one tap
                                it builds, checks, repairs    ──▶  live progress
                                                                    you can steer it
                                it finishes                   ──▶  Ready to check
                                you hand it over                   one tap
                          ◀──  site marked completed
                                it keeps improving it         ──▶  Delivered · improving
```

Nothing reaches a customer without you pressing a button. The pipeline builds,
scores and prepares; handing over is always a person's decision.

## Why it polls instead of being called

The builder runs on a machine at home, behind a tunnel or a tailnet whose address
changes. A webhook pointed at it breaks every time that happens. Polling goes
outward from the builder, works from behind any NAT, and needs nothing configured
on the site's side beyond a key.

## Setting it up

On the PC, in `.env`:

```bash
SITE_URL=https://arpcloudsolutions.co.za
SITE_API_KEY=mak_agentbuilder_<the rest of the key>
```

Make the key in the site's admin → **API keys** → new master key for the app
`agentbuilder`. The key is shown once.

Then restart the builder. **Control → Customer pipeline** should say *site
connected*. Within a minute the site's admin → **Agent Builder** tab shows the PC
as online, and the home page grows a **Ready to build** section listing the
catalogue.

## What the site shows: the catalogue

Every time the builder checks the site for orders (every 5 minutes, and 10
seconds after it starts) it also posts its catalogue there. That post is the
site's "PC online" signal too. The site shows the catalogue under **Ready to
build**, with an *Order this* button on each item, and uses it to work out
which template a payment was for.

Manage it in the app: **Orders → Templates**. **New template**, **Edit**,
**Hide** and **Delete** change what the site sells, and each change is sent to
the site straight away (a built-in template is hidden rather than deleted, so it
can come back).

A template can have a **source folder**: its actual code on the PC. Then a
customer's build starts from a copy of that code and tailors it to their brief,
instead of generating everything from nothing.

- **Build the code** (no source folder yet) builds the template from its
  description; when it finishes, that build becomes its source folder.
- **Change the code** works on a copy of the source folder, the same way as
  carrying on with a project: look at the changes, then apply them.
- **Build for a customer** makes an order from the template and starts it.

A rebuild or an improvement pass on an order starts from what was built last
time, not from scratch.

Behind the app, the built-in list is in `src/orders/Catalog.ts` and your
changes are kept in `data/catalog.json`, an array merged by `id`:

```json
[
  { "id": "invitation", "name": "Digital Invitation", "kind": "template", "category": "Events",
    "description": "An online invitation with RSVPs.", "price": 1500, "timeframe": "3-5 days",
    "features": ["RSVP tracking", "Map and schedule"], "keywords": ["wedding", "invite", "rsvp"] },
  { "id": "blog", "price": 8000 },
  { "id": "restaurant", "hidden": true }
]
```

`kind` is `website`, `app` or `template`. `buildNotes` is extra direction for
the build and is never sent to the site. A price only shows on the site when the
currency is ZAR. **Orders → Check now** in the app publishes straight away.

When an order names a catalogue item, the build prompt carries that item's
description and features after the customer's own words, and the customer's
words win where they disagree.

## The states an order goes through

| State | What it means | What you do |
| --- | --- | --- |
| **New** | Came in, nobody has looked | Accept, or cancel |
| **Queued** | Accepted, waiting its turn | Nothing — or "Build it now" to jump the queue |
| **Building** | Being built right now | Watch it; send instructions while it works |
| **Ready to check** | Finished. **Nothing sent to the customer** | Look at it, then "Hand it over" |
| **Delivered** | Handed over, not being improved | — |
| **Delivered · improving** | Handed over, still getting better | Turn improving off if you want it frozen |
| **Needs you** | Three builds failed | Read the brief; it may be too vague |

What the site hands over:

- **A quote you accepted** (moved to *in-progress*, which "Convert to project"
  does). It arrives as **New**, for you to accept.
- **Anything paid for through PayFast.** It arrives already **Queued**. If the
  builder already had it from the accepted quote, the payment reaches it on the
  next check and moves it from New to Queued.
- **A test build** from the site's admin → Agent Builder tab.

A configurator order that is neither paid nor accepted waits on the site as
*Awaiting payment*: "new" means nothing has been agreed, and the builder must not
start on it. One purchase is one build: the quote, the deposit and the final
payment all find the same one.

## Steering a build

Two ways in, same effect:

- **Orders** → a building order → *"Something the customer changed their mind about?"*
- **Build** → the build → *"Tell it something while it works"*

An instruction joins the prompt from the **next pass** onward and stays there for
the rest of the build — it is standing direction, not a one-off command. The pass
already running finishes on the old prompt.

Good instructions read like something you would say to a developer:

> Use the practice green (#1f7a5a) as the accent colour, not blue.
> They want the booking form on the home page, not a separate page.
> Drop the pricing table — they will not publish prices.

## What keeps happening after delivery

Every six hours the pipeline looks for a delivered product that is

- enrolled for improvement (on by default),
- scoring under 97,
- not built in the last twelve hours,

and puts the lowest-scoring one through another pass. It never runs while a
customer build is waiting — new work comes first.

Turn it off for one order with **Stop improving** on that order, or for
everything with `ORDER_AUTO_IMPROVE=false`.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `ORDER_AUTO_START` | `true` | Accepted orders start building on their own |
| `ORDER_AUTO_IMPROVE` | `true` | Delivered products keep being improved |
| `ORDER_MAX_CONCURRENT_BUILDS` | `1` | One GPU, one build — raise only if you have room |
| `ORDER_AUTO_ACCEPT_PAID` | `true` | Orders paid for on the site skip New and are queued |

## The routes, if you are driving it from somewhere else

Everything needs an agent key (`x-agent-key`). Reading needs `read`; anything
that moves an order needs `execute`.

```
GET    /api/orders                  every order, with its build
GET    /api/orders/:id              one order, its notes and its build
GET    /api/orders/status           is the site connected, what is where
GET    /api/orders/templates        the catalogue
POST   /api/orders/templates/publish   send the catalogue to the site now
POST   /api/orders/templates/:id/build start a build from a catalogue item
POST   /api/orders                  add one by hand (or let the site push)
POST   /api/orders/intake           check the site now
POST   /api/orders/:id/accept       queue it
POST   /api/orders/:id/build        build it now
POST   /api/orders/:id/instruct     { text } — steer the build behind it
POST   /api/orders/:id/deliver      { url? } — hand it over
POST   /api/orders/:id/cancel       { reason }
PATCH  /api/orders/:id              { autoImprove }
POST   /api/orders/improve          run an improvement pass now
```

And on the site, for the builder only (master key, `Authorization: Bearer`):

```
GET    /api/builder/orders          the queue (queued jobs, plus paid ones not yet acknowledged)
PATCH  /api/builder/orders/:id      { status, message, qualityScore, previewUrl }
POST   /api/builder/catalog         { items, version, machine, queueLength, building }
GET    /api/catalog                 the published catalogue (public, no key)
```
