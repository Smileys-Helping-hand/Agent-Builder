import { useState } from "react";

import { addToCart, filterProducts, orderReference, orderSummary, setQuantity, totals, type CartLine, type Product } from "./cart";
import { site } from "./content";
import {
  DemoBanner,
  Footer,
  Header,
  Section,
  SmartForm,
  WhatsAppButton,
  brandStyle,
  formatMoney,
  usePersistentState,
  useHashRoute
} from "./lib/site";

const find = (id: string): Product | undefined => site.products.find((product) => product.id === id);

function ProductCard({ product, onAdd }: { product: Product; onAdd: (product: Product) => void }) {
  return (
    <article className="card product-card">
      <a href={`#/product/${product.id}`} className="product-art" aria-label={product.name}>
        <span aria-hidden="true">{product.emoji}</span>
      </a>
      <p className="chip">{product.category}</p>
      <h3>
        <a href={`#/product/${product.id}`}>{product.name}</a>
      </h3>
      <p className="muted product-text">{product.description}</p>
      <div className="product-foot">
        <span className="product-price">
          {formatMoney(product.price)}
          {product.compareAt ? <s className="muted">{formatMoney(product.compareAt)}</s> : null}
        </span>
        <button className="btn btn-small" onClick={() => onAdd(product)} disabled={product.stock === 0}>
          {product.stock === 0 ? "Sold out" : "Add"}
        </button>
      </div>
    </article>
  );
}

export default function App() {
  const route = useHashRoute();
  const [cart, setCart] = usePersistentState<CartLine[]>("cart", []);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [added, setAdded] = useState<string | null>(null);

  const sum = totals(cart, site.products, site.shipping);

  const add = (product: Product) => {
    setCart(addToCart(cart, product));
    setAdded(product.name);
    setTimeout(() => setAdded(null), 2200);
  };

  const [, section, param] = route.split("/");
  let page: JSX.Element;

  if (section === "product" && find(param)) {
    const product = find(param)!;
    page = (
      <Section title={product.name} eyebrow={product.category}>
        <div className="grid grid-2">
          <div className="product-art product-art-large" aria-hidden="true">
            {product.emoji}
          </div>
          <div>
            <p className="price">
              {formatMoney(product.price)} {product.compareAt ? <s className="muted">{formatMoney(product.compareAt)}</s> : null}
            </p>
            <p className="lead">{product.description}</p>
            <p className="muted">{product.stock > 0 ? `${product.stock} in stock` : "Sold out"}</p>
            <div className="btn-row">
              <button className="btn" onClick={() => add(product)} disabled={product.stock === 0}>
                Add to cart
              </button>
              <a className="btn btn-ghost" href="#/">
                Keep shopping
              </a>
            </div>
          </div>
        </div>
      </Section>
    );
  } else if (section === "cart") {
    page = (
      <Section title="Your cart" eyebrow={`${sum.items} item${sum.items === 1 ? "" : "s"}`}>
        {sum.items === 0 ? (
          <div className="card">
            <p>Your cart is empty.</p>
            <a className="btn" href="#/">
              Browse the shop
            </a>
          </div>
        ) : (
          <div className="cart-layout">
            <div className="card">
              {cart.map((line) => {
                const product = find(line.productId);
                if (!product) return null;
                return (
                  <div key={line.productId} className="cart-line">
                    <span className="cart-emoji" aria-hidden="true">
                      {product.emoji}
                    </span>
                    <div className="cart-name">
                      <strong>{product.name}</strong>
                      <span className="muted">{formatMoney(product.price)} each</span>
                    </div>
                    <div className="qty">
                      <button aria-label={`One fewer ${product.name}`} onClick={() => setCart(setQuantity(cart, product, line.quantity - 1))}>
                        −
                      </button>
                      <span>{line.quantity}</span>
                      <button aria-label={`One more ${product.name}`} onClick={() => setCart(setQuantity(cart, product, line.quantity + 1))}>
                        +
                      </button>
                    </div>
                    <strong>{formatMoney(product.price * line.quantity)}</strong>
                  </div>
                );
              })}
            </div>
            <aside className="card">
              <h3>Summary</h3>
              <p className="summary-row">
                <span>Subtotal</span>
                <span>{formatMoney(sum.subtotal)}</span>
              </p>
              <p className="summary-row">
                <span>Delivery</span>
                <span>{sum.shipping === 0 ? "Free" : formatMoney(sum.shipping)}</span>
              </p>
              {sum.toFreeShipping > 0 ? (
                <p className="muted">Add {formatMoney(sum.toFreeShipping)} more for free delivery.</p>
              ) : null}
              <p className="summary-row summary-total">
                <span>Total</span>
                <span>{formatMoney(sum.total)}</span>
              </p>
              <Checkout cart={cart} onDone={() => setCart([])} />
            </aside>
          </div>
        )}
      </Section>
    );
  } else if (section === "about") {
    page = (
      <Section title={site.about.title} eyebrow="Our story">
        {site.about.paragraphs.map((paragraph) => (
          <p key={paragraph} className="lead">
            {paragraph}
          </p>
        ))}
      </Section>
    );
  } else if (section === "delivery") {
    page = (
      <Section title="Delivery & returns" eyebrow="Help">
        <div className="faq">
          {site.delivery.map((item) => (
            <details key={item.q} open>
              <summary>{item.q}</summary>
              <p className="muted">{item.a}</p>
            </details>
          ))}
        </div>
      </Section>
    );
  } else {
    const shown = filterProducts(site.products, query, category);
    page = (
      <>
        <section className="hero hero-compact">
          <div className="container">
            <p className="eyebrow">{site.hero.eyebrow}</p>
            <h1>{site.hero.title}</h1>
            <p className="lead muted">{site.hero.subtitle}</p>
          </div>
        </section>
        <Section title="Shop" eyebrow={`${shown.length} products`}>
          <div className="shop-tools">
            <input
              className="search"
              type="search"
              placeholder="Search the shop"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search products"
            />
            <div className="chip-row">
              {site.categories.map((name) => (
                <button key={name} className={`chip chip-button ${category === name ? "chip-active" : ""}`} onClick={() => setCategory(name)}>
                  {name}
                </button>
              ))}
            </div>
          </div>
          {shown.length === 0 ? (
            <p className="muted">Nothing matches that. Try another word or category.</p>
          ) : (
            <div className="grid grid-4">
              {shown.map((product) => (
                <ProductCard key={product.id} product={product} onAdd={add} />
              ))}
            </div>
          )}
        </Section>
      </>
    );
  }

  return (
    <div className="site" style={brandStyle(site.brand)}>
      <DemoBanner show={site.demo} label="E-Commerce Store" />
      <Header business={site.business} nav={site.nav} cta={{ label: `Cart (${sum.items})`, href: "#/cart" }} />
      <main>{page}</main>
      {added ? (
        <div className="toast" role="status">
          Added {added} · <a href="#/cart">View cart</a>
        </div>
      ) : null}
      <Footer business={site.business} />
      <WhatsAppButton number={site.business.whatsapp} message="Hi, I have a question about an order." />
    </div>
  );
}

function Checkout({ cart, onDone }: { cart: CartLine[]; onDone: () => void }) {
  const [reference] = useState(() => orderReference());
  const summary = orderSummary(cart, site.products, site.shipping, reference);
  const [placed, setPlaced] = useState(false);

  if (placed) {
    return (
      <div className="notice notice-ok" role="status">
        <p>
          Order <strong>{reference}</strong> placed. {site.checkout.paymentUrl ? "Complete payment on the next page." : "Pay by EFT using:"}
        </p>
        {!site.checkout.paymentUrl ? <p>{site.checkout.eftDetails}</p> : null}
      </div>
    );
  }

  return (
    <>
      <h3 style={{ marginTop: 20 }}>Checkout</h3>
      <SmartForm
        subject={`New order ${reference}`}
        settings={site.forms}
        fallbackEmail={site.business.email}
        submitLabel={`Place order ${reference}`}
        successMessage=""
        extra={summary}
        onSubmitted={() => {
          setPlaced(true);
          onDone();
          if (site.checkout.paymentUrl) window.location.href = site.checkout.paymentUrl;
        }}
        fields={[
          { name: "name", label: "Full name", required: true },
          { name: "email", label: "Email", type: "email", required: true },
          { name: "phone", label: "Phone", type: "tel", required: true },
          { name: "address", label: "Delivery address", type: "textarea", required: true }
        ]}
      />
      <p className="muted order-preview">{summary}</p>
    </>
  );
}
