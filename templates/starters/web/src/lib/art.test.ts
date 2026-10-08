import { afterEach, describe, expect, it, vi } from "vitest";

import { loadPictures } from "./art";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadPictures", () => {
  it("is empty when the pictures have not been drawn yet", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    expect(await loadPictures()).toEqual({});
  });

  it("is empty when nothing can be fetched (opened from a folder)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    expect(await loadPictures()).toEqual({});
  });

  it("skips manifest entries without a file", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ assets: { hero: {} } }), { status: 200 })));
    expect(await loadPictures()).toEqual({});
  });
});
