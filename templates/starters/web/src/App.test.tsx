import { describe, expect, it } from "vitest";

import App from "./App";
import { renderAt } from "./lib/testing";

describe("the app", () => {
  it("renders", () => {
    expect(renderAt(<App />)).toMatch(/<[a-z]/);
  });
});
