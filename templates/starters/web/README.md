# __NAME__

Built with Agent Builder.

- `npm install`, then `npm run dev` to work on it.
- `npm test` runs the tests; `npm run build` makes `dist/index.html`, one file that opens anywhere (even straight from a folder).

## How this project is set up (read before changing it)

- React 18 + TypeScript + Vite. The app starts in `src/App.tsx`; `src/main.tsx` mounts it and must stay as it is.
- Put components in `src/` (`src/components/...` as it grows) and pure logic — rules, calculations, state changes —
  in plain `.ts` modules so it can be tested without a browser.
- Styles go in `src/styles.css` (or more `.css` files imported from components).
- Tests: Vitest, in files named `*.test.ts` / `*.test.tsx` next to the code. `describe`, `it`, `test` and `expect`
  are available without importing them. The test environment is jsdom, so `document` and `window` exist, but a
  `<canvas>` has no drawing context there: test the logic, not the drawing.
- To check a component renders, use `renderAt(<Component />)` from `src/lib/testing.tsx`: it returns the HTML string.
- Or test it like a user would with Testing Library (installed and set up): `render`, `screen` and `fireEvent` from
  `@testing-library/react`, `userEvent` from `@testing-library/user-event`, and matchers such as `toBeInTheDocument()`.
- Do not change `vite.config.ts`, `tsconfig.json`, `index.html` or `src/main.tsx`, and do not add build or test
  tools (Jest, Babel, Webpack): the setup already works. Only add npm packages that run in a browser.
- For drawing and games use the browser's own `<canvas>`, `requestAnimationFrame` and keyboard/pointer events.
- Keep data in the browser (`localStorage`) unless a server was asked for.
