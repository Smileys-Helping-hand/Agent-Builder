/**
 * The starter's own placeholder must be gone: until src/App.tsx is the app
 * that was asked for, this fails, so "every check passes" means something was
 * built. It lives in src/lib, which a build cannot change.
 */
import App from "../App";
import { renderAt } from "./testing";

describe("the starter", () => {
  it("has been replaced by the real app (rewrite src/App.tsx to build what was asked for)", () => {
    expect(renderAt(<App />)).not.toContain("Getting ready…");
  });
});
