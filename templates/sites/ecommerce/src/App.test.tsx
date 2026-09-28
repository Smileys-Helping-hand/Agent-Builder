import { describe, expect, it } from "vitest";

import App from "./App";
import { addToCart, filterProducts, orderSummary, setQuantity, totals, type CartLine } from "./cart";
import { site } from "./content";
import { formatMoney } from "./lib/site";
import { esc, renderAt as renderPage } from "./lib/testing";

const renderAt = (hash: string) => renderPage(<App />, hash);

const [soap, , faceOil] = site.products;

describe("cart", () => {
  it("adds, increases and caps at what is in stock", () => {
    let cart: CartLine[] = [];
    cart = addToCart(cart, soap);
    cart = addToCart(cart, soap, 2);
    expect(cart).toEqual([{ productId: soap.id, quantity: 3 }]);
    cart = addToCart(cart, soap, 1000);
    expect(cart[0].quantity).toBe(soap.stock);
  });

  it("removes a line when its quantity reaches zero", () => {
    const cart = addToCart([], soap);
    expect(setQuantity(cart, soap, 0)).toEqual([]);
  });

  it("charges delivery below the free-delivery threshold, and not above it", () => {
    const small = totals(addToCart([], soap), site.products, site.shipping);
    expect(small.shipping).toBe(site.shipping.flat);
    expect(small.total).toBe(soap.price + site.shipping.flat);
    expect(small.toFreeShipping).toBe(site.shipping.freeFrom - soap.price);

    const big = totals(addToCart([], faceOil, 2), site.products, site.shipping);
    expect(big.shipping).toBe(0);
    expect(big.toFreeShipping).toBe(0);
  });

  it("an empty cart costs nothing, delivery included", () => {
    expect(totals([], site.products, site.shipping)).toMatchObject({ items: 0, total: 0, shipping: 0 });
  });

  it("writes an order summary the shop can act on", () => {
    const text = orderSummary(addToCart([], soap, 2), site.products, site.shipping, "ORD-TEST01");
    expect(text).toContain("Order ORD-TEST01");
    expect(text).toContain(`2 × ${soap.name}`);
    expect(text).toContain(`Total: R${soap.price * 2 + site.shipping.flat}`);
  });
});

describe("search and categories", () => {
  it("filters by category and by every word typed", () => {
    expect(filterProducts(site.products, "", "Candles").every((product) => product.category === "Candles")).toBe(true);
    expect(filterProducts(site.products, "gift", "All").length).toBeGreaterThan(0);
    expect(filterProducts(site.products, "nothing-like-this", "All")).toEqual([]);
  });
});

describe("pages", () => {
  it("the shop lists every product with its price", () => {
    const html = renderAt("#/");
    for (const product of site.products) {
      expect(html).toContain(esc(product.name));
      expect(html).toContain(formatMoney(product.price));
    }
  });

  it("each product has its own page", () => {
    const html = renderAt(`#/product/${faceOil.id}`);
    expect(html).toContain(esc(faceOil.description));
    expect(html).toContain("Add to cart");
  });

  it("an empty cart says so", () => {
    expect(renderAt("#/cart")).toContain("Your cart is empty");
  });

  it("about and delivery pages render their content", () => {
    expect(renderAt("#/about")).toContain(esc(site.about.title));
    expect(renderAt("#/delivery")).toContain(esc(site.delivery[0].q));
  });
});
