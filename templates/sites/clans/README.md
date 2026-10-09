# Clan Village Strategy Game

A branded village strategy game in the style of Clash of Clans: grow and upgrade
a village against timers, mine gold and elixir, train barbarians, archers and
giants, and raid rival clans for loot and stars, with a prize form that turns
players into leads.

## The game

- **`src/game.ts`** is the whole game with no drawing: buildings, levels and
  costs, builders and timers, production, training, raids and stars. Change
  `DEFAULT_SETTINGS` (or `site.game` in `src/content.ts`) to add levels, make
  things cheaper or raids harder. Its tests are in `src/game.test.ts`.
- **`src/play.tsx`** draws it and handles taps, clicks and keys. The village is
  saved in the browser and keeps producing while the player is away.
- **Pictures:** put PNGs in `public/assets/` and list them in
  `public/assets/manifest.json` (`{"assets": {"townhall": {"file": "assets/townhall.png"}}}`).
  Names: `townhall`, `goldmine`, `collector`, `barracks`, `camp`, `cannon`,
  `wall`, `barbarian`, `archer`, `giant`, and `ground` for the grass. Anything
  without a picture is drawn as a coloured block.

## Changing what it says

Almost everything a visitor sees — the business name, colours, text, prices,
opening hours, contact details — is in **`src/content.ts`**. Edit that file and
the whole site follows. You should not need to touch any other file to re-brand
it for a new business.

- **Colours:** `brand.primary` and `brand.accent`. Any CSS colour works.
- **Contact details:** `business.phone`, `business.email`, `business.address`.
- **WhatsApp button:** set `business.whatsapp`; leave it out to hide the button.

## Forms

Forms work with no server. By default a submission opens the visitor's email
app with the message filled in, addressed to `business.email`.

To receive submissions directly instead, set `forms.endpoint` in
`src/content.ts` to any URL that accepts a JSON `POST` — a Formspree form, a
Vercel or Netlify function, or your own API.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # checks the pages and the logic
npm run build      # the finished site, in dist/
```

## Putting it online

`dist/` is plain static files. Upload it anywhere: Vercel, Netlify, Amplify,
cPanel, or an S3 bucket. Pages use `#/` addresses, so no server configuration
is needed, and assets use relative paths, so it also works from a subfolder.

```bash
npx vercel deploy dist --prod
```
