import { describe, expect, it } from "vitest";

import App from "./App";
import { addToCart, filterProducts, orderSummary, setQuantity, totals, type CartLine, type Product, type ShippingRule } from "./cart";
import { site } from "./content";
import { formatMoney } from "./lib/site";
import { esc, renderAt as renderPage } from "./lib/testing";

const renderAt = (hash: string) => renderPage(<App />, hash);

// The cart is tested on products and delivery rules of its own, not the
// shop's: a shop with two products, other prices or free delivery throughout
// must not fail the rules of a cart.
const soap: Product = { id: "soap", name: "Oat soap", category: "Bath", price: 85, description: "A bar.", emoji: "🧼", stock: 12 };
const faceOil: Product = { id: "oil", name: "Face oil", category: "Skin", price: 420, description: "A bottle.", emoji: "🌿", stock: 5 };
const products = [soap, faceOil];
const shipping: ShippingRule = { flat: 75, freeFrom: 600 };
const [first] = site.products;

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
    const small = totals(addToCart([], soap), products, shipping);
    expect(small.shipping).toBe(shipping.flat);
    expect(small.total).toBe(soap.price + shipping.flat);
    expect(small.toFreeShipping).toBe(shipping.freeFrom - soap.price);

    const big = totals(addToCart([], faceOil, 2), products, shipping);
    expect(big.shipping).toBe(0);
    expect(big.toFreeShipping).toBe(0);
  });

  it("an empty cart costs nothing, delivery included", () => {
    expect(totals([], products, shipping)).toMatchObject({ items: 0, total: 0, shipping: 0 });
  });

  it("writes an order summary the shop can act on", () => {
    const text = orderSummary(addToCart([], soap, 2), products, shipping, "ORD-TEST01");
    expect(text).toContain("Order ORD-TEST01");
    expect(text).toContain(`2 × ${soap.name}`);
    expect(text).toContain(`Total: R${soap.price * 2 + shipping.flat}`);
  });
});

describe("search and categories", () => {
  it("filters by category and by every word typed", () => {
    const category = first.category;
    expect(filterProducts(site.products, "", category).every((product) => product.category === category)).toBe(true);
    const word = first.name.split(/\s+/).find((part) => part.length >= 3) ?? first.name;
    expect(filterProducts(site.products, word.toLowerCase(), "All").length).toBeGreaterThan(0);
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
    const html = renderAt(`#/product/${first.id}`);
    expect(html).toContain(esc(first.description));
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
