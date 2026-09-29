/**
 * The shopping cart, as plain functions so it can be tested without a browser.
 * The page keeps the cart in localStorage through usePersistentState.
 */
export interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  /** A was-price shown struck through. */
  compareAt?: number;
  description: string;
  emoji: string;
  stock: number;
  tags?: string[];
}

export interface CartLine {
  productId: string;
  quantity: number;
}

export interface ShippingRule {
  flat: number;
  /** Orders at or above this subtotal ship free. */
  freeFrom: number;
}

export function addToCart(cart: CartLine[], product: Product, quantity = 1): CartLine[] {
  const existing = cart.find((line) => line.productId === product.id);
  const wanted = (existing?.quantity ?? 0) + quantity;
  const capped = Math.min(wanted, product.stock);
  if (capped <= 0) return cart.filter((line) => line.productId !== product.id);
  if (existing) return cart.map((line) => (line.productId === product.id ? { ...line, quantity: capped } : line));
  return [...cart, { productId: product.id, quantity: capped }];
}

export function setQuantity(cart: CartLine[], product: Product, quantity: number): CartLine[] {
  if (quantity <= 0) return cart.filter((line) => line.productId !== product.id);
  const capped = Math.min(Math.floor(quantity), product.stock);
  return cart.map((line) => (line.productId === product.id ? { ...line, quantity: capped } : line));
}

export interface CartTotals {
  items: number;
  subtotal: number;
  shipping: number;
  total: number;
  /** How much more to spend for free shipping; 0 once it applies. */
  toFreeShipping: number;
}

export function totals(cart: CartLine[], products: Product[], shipping: ShippingRule): CartTotals {
  let items = 0;
  let subtotal = 0;
  for (const line of cart) {
    const product = products.find((entry) => entry.id === line.productId);
    if (!product) continue;
    items += line.quantity;
    subtotal += product.price * line.quantity;
  }
  const free = subtotal >= shipping.freeFrom;
  const shippingCost = items === 0 || free ? 0 : shipping.flat;
  return {
    items,
    subtotal,
    shipping: shippingCost,
    total: subtotal + shippingCost,
    toFreeShipping: items === 0 || free ? 0 : shipping.freeFrom - subtotal
  };
}

export function filterProducts(products: Product[], query: string, category: string): Product[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return products.filter((product) => {
    if (category !== "All" && product.category !== category) return false;
    const haystack = `${product.name} ${product.description} ${(product.tags ?? []).join(" ")}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** A reference the customer can quote, e.g. ORD-7K2Q9M. */
export function orderReference(now = Date.now()): string {
  return `ORD-${now.toString(36).toUpperCase().slice(-6)}`;
}

/** The order as text, for an email or a WhatsApp message to the shop. */
export function orderSummary(cart: CartLine[], products: Product[], shipping: ShippingRule, reference: string): string {
  const sum = totals(cart, products, shipping);
  const lines = cart
    .map((line) => {
      const product = products.find((entry) => entry.id === line.productId);
      return product ? `${line.quantity} × ${product.name} @ R${product.price}` : null;
    })
    .filter(Boolean);
  return [
    `Order ${reference}`,
    ...lines,
    `Subtotal: R${sum.subtotal}`,
    `Shipping: ${sum.shipping === 0 ? "free" : `R${sum.shipping}`}`,
    `Total: R${sum.total}`
  ].join("\n");
}
