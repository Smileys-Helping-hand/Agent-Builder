/**
 * Helpers for the page tests. Pages render to an HTML string, which is fast,
 * needs no browser, and is enough to prove every piece of content made it on
 * to the page.
 */
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";

/**
 * Text as it appears in rendered HTML. Compare against this, not the raw
 * text, or a business called "Smith & Sons" fails every test.
 */
export const esc = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

/**
 * Render the page as it looks at a #/ address. `stored` stands in for what the
 * browser remembered between visits (a cart, a signed-in session), as the
 * JSON strings usePersistentState would have saved.
 */
export function renderAt(element: ReactElement, hash = "#/", stored: Record<string, unknown> = {}): string {
  const holder = globalThis as { window?: unknown };
  const had = "window" in holder;
  const previous = holder.window;
  const localStorage = {
    getItem: (key: string) => (key in stored ? JSON.stringify(stored[key]) : null),
    setItem: () => undefined
  };
  holder.window = { location: { hash }, localStorage };
  try {
    return renderToString(element);
  } finally {
    if (had) holder.window = previous;
    else delete holder.window;
  }
}
