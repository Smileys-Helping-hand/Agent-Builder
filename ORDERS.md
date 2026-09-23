# Orders — from "someone wants a website" to a finished one

Agent Builder can take work from your site, build it, and keep improving what it
delivered. This is how that fits together and how you drive it.

## The short version

```
arpcloudsolutions.co.za          your PC                          the app
─────────────────────────        ──────────────────────           ──────────────
customer fills in the form
you accept it in the admin
                          ──▶  builder polls and takes it in  ──▶  shows as New
                                you accept it                       one tap
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
SITE_API_KEY=hub_agentbuilder_<the rest of the key>
```

Make the key in the site's admin → **API keys** → new master key for the app
`agentbuilder`. The key is shown once.

Then restart the builder. **Control → Customer pipeline** should say *site
connected*.

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

Only requests the site has at **in-progress** are handed over — "new" means the
job has not been quoted or agreed, and the builder must not start on it.

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

## The routes, if you are driving it from somewhere else

Everything needs an agent key (`x-agent-key`). Reading needs `read`; anything
that moves an order needs `execute`.

```
GET    /api/orders                  every order, with its build
GET    /api/orders/:id              one order, its notes and its build
GET    /api/orders/status           is the site connected, what is where
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
GET    /api/builder/orders          the queue
PATCH  /api/builder/orders/:id      { status, message, qualityScore, previewUrl }
```
