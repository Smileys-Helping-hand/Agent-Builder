# Open World City Game

A branded top-down open-world city game in the style of GTA: walk the streets,
take and drive cars, run delivery missions against the clock, and escape the
police when your wanted level rises, with a prize form that turns players into
leads.

## The game

- **`src/game.ts`** is the whole game with no drawing: the city map, walking,
  driving and crashes, traffic and pedestrians, the wanted level and police
  chases, missions and cash. Change `DEFAULT_SETTINGS` (or `site.game` in
  `src/content.ts`) for a bigger city, more traffic or tougher police. Its
  tests are in `src/game.test.ts`.
- **`src/play.tsx`** draws it with a camera that follows the player, a mini
  map and an arrow to the next job, and handles keys and touch.
- **Pictures:** put PNGs in `public/assets/` and list them in
  `public/assets/manifest.json` (`{"assets": {"car": {"file": "assets/car.png"}}}`).
  Names: `car`, `police`, `player` (the player's car) and `person`. Anything
  without a picture is drawn as a shape.

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
