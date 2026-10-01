/**
 * The live editor's hands inside a preview. Injected by the preview server
 * into every page it serves (templates, builds, project previews), so editing
 * works on any site, not only templates that carry their own customiser.
 *
 * It does nothing until the frame's parent says hello, and then only changes
 * how this copy of the page looks in the frame: colours, fonts, text size,
 * section order and visibility, and text typed over in place. Nothing is
 * saved here; the app turns the changes into instructions for a build.
 *
 * Messages (all { type: "ab-edit-…" }):
 *   parent → page  hello                → page answers ready { vars, blocks, fonts, slots }
 *   parent → page  apply { … }          → restyle and re-text the page
 *   parent → page  mode { text, pick }  → type over text / click to pick an element
 *   page → parent  alive (a new page loaded), text { path, before, text }, picked { path, tag, text }
 */
const source = String.raw`(function () {
  if (window.parent === window || window.__abEditor) return;
  window.__abEditor = true;
  var style = null, mode = { text: false, pick: false }, originals = {}, hoverEl = null, lastApply = null;
  var TEXT_TAGS = "h1,h2,h3,h4,h5,h6,p,li,a,button,label,figcaption,blockquote,td,th,small,strong,em,span,dt,dd";
  var FONTS = [
    { label: "Modern sans", value: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
    { label: "Classic serif", value: "Georgia, 'Times New Roman', serif" },
    { label: "Book serif", value: "Charter, 'Iowan Old Style', Georgia, serif" },
    { label: "Rounded", value: "'Trebuchet MS', 'Segoe UI', sans-serif" },
    { label: "Condensed", value: "'Arial Narrow', 'Roboto Condensed', sans-serif" },
    { label: "Mono", value: "ui-monospace, Consolas, monospace" }
  ];
  function send(message) { try { parent.postMessage(message, "*"); } catch (e) {} }
  /** A whole, well-formed colour and nothing else: what goes into the injected stylesheet must not break out of it. */
  function isColor(v) { return /^(#[0-9a-f]{3,8}|(rgba?|hsla?|oklch|oklab|lab|lch)\([0-9.,%\s\/+-]*(deg|turn|rad)?[0-9.,%\s\/+-]*\))$/i.test(String(v).trim()); }
  function toHex(v) {
    var c = document.createElement("canvas").getContext("2d");
    if (!c) return v;
    c.fillStyle = "#000"; c.fillStyle = v; var out = c.fillStyle;
    return /^#[0-9a-f]{6}$/i.test(out) ? out : v;
  }
  /** Colour custom properties the site defines on :root / html / body. */
  function colorVars() {
    var found = {};
    var sheets = Array.prototype.slice.call(document.styleSheets);
    sheets.forEach(function (sheet) {
      var rules; try { rules = sheet.cssRules; } catch (e) { return; }
      Array.prototype.forEach.call(rules || [], function (rule) {
        if (!rule.style || !/^(:root|html|body)(\s*,\s*(:root|html|body))*$/.test((rule.selectorText || "").trim())) return;
        for (var i = 0; i < rule.style.length; i++) {
          var name = rule.style[i];
          if (name.indexOf("--") !== 0) continue;
          var value = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || rule.style.getPropertyValue(name).trim();
          if (isColor(value) && !found[name]) found[name] = toHex(value);
        }
      });
    });
    // The frame has no origin of its own, so a linked stylesheet's rules cannot be
    // read (what every built site uses). The computed style still lists the
    // custom properties in effect, whichever sheet set them.
    // Many sites set their palette inline on a wrapper (style="--primary: …"),
    // not on :root. Look down the spine to the page's blocks, and mark where a
    // colour is declared so the editor's value can win there too.
    var spine = [];
    for (var node = blockParent(); node && node.nodeType === 1; node = node.parentElement) spine.unshift(node);
    spine.forEach(function (el) {
      for (var j = 0; j < el.style.length; j++) if (el.style[j].indexOf("--") === 0) { el.setAttribute("data-ab-vars", ""); break; }
    });
    spine.forEach(function (el) {
      var cs = getComputedStyle(el);
      for (var i = 0; i < cs.length; i++) {
        var name = cs[i];
        if (name.indexOf("--") !== 0 || found[name]) continue;
        var value = cs.getPropertyValue(name).trim();
        if (isColor(value)) found[name] = toHex(value);
      }
    });
    return Object.keys(found).slice(0, 24).map(function (name) { return { name: name, value: found[name] }; });
  }
  /** The page's top-level blocks: what main (or body) is made of. */
  function blockParent() {
    var main = document.querySelector("main");
    if (main && main.children.length > 1) return main;
    var root = document.getElementById("root") || document.getElementById("__next") || document.body;
    var node = root;
    while (node && node.children.length === 1) node = node.children[0];
    return node || document.body;
  }
  function blocks() {
    var host = blockParent(); host.setAttribute("data-ab-host", "");
    return Array.prototype.slice.call(host.children).filter(function (el) {
      // A block the editor has hidden has no height, but must stay in the list to be shown again.
      return !/^(SCRIPT|STYLE|LINK|TEMPLATE)$/.test(el.tagName) && (el.hasAttribute("data-ab-block") || el.getBoundingClientRect().height > 8);
    }).slice(0, 30).map(function (el, i) {
      var id = el.getAttribute("data-ab-block") || ("b" + i);
      el.setAttribute("data-ab-block", id);
      var heading = el.querySelector("h1,h2,h3");
      var title = (heading && heading.textContent.trim()) || el.id || el.getAttribute("aria-label") || el.tagName.toLowerCase();
      return { id: id, title: title.slice(0, 60), tag: el.tagName.toLowerCase() };
    });
  }
  function computed(sel, prop) { var el = document.querySelector(sel); return el ? toHex(getComputedStyle(el)[prop]) : null; }
  function slots() {
    var accentEl = document.querySelector("a[class*=btn], button:not([disabled]), .btn, [class*=button]");
    return {
      background: toHex(getComputedStyle(document.body).backgroundColor),
      text: toHex(getComputedStyle(document.body).color),
      heading: computed("h1, h2", "color"),
      accent: accentEl ? toHex(getComputedStyle(accentEl).backgroundColor) : null
    };
  }
  /** A stable address for an element, from body down. */
  function pathOf(el) {
    var parts = [];
    while (el && el !== document.body && el.nodeType === 1) {
      var tag = el.tagName.toLowerCase(), i = 1, sib = el;
      while ((sib = sib.previousElementSibling)) if (sib.tagName === el.tagName) i++;
      parts.unshift(tag + ":nth-of-type(" + i + ")");
      el = el.parentElement;
    }
    return "body > " + parts.join(" > ");
  }
  function css(a) {
    var r = [];
    Object.keys(a.vars || {}).forEach(function (n) { if (/^--[\w-]+$/.test(n) && isColor(a.vars[n])) r.push(":root,[data-ab-vars]{" + n + ":" + a.vars[n] + " !important}"); });
    var s = a.slots || {};
    if (isColor(s.background)) r.push("html,body{background:" + s.background + " !important}");
    if (isColor(s.text)) r.push("body{color:" + s.text + " !important}");
    if (isColor(s.heading)) r.push("h1,h2,h3,h4{color:" + s.heading + " !important}");
    if (isColor(s.accent)) r.push("a[class*=btn],button:not([disabled]),.btn,[class*=button]{background-color:" + s.accent + " !important;border-color:" + s.accent + " !important}a:not([class*=btn]){color:" + s.accent + " !important}");
    var f = a.fonts || {};
    if (f.body && !/[;{}]/.test(f.body)) r.push("body,button,input,textarea,select{font-family:" + f.body + " !important}");
    if (f.heading && !/[;{}]/.test(f.heading)) r.push("h1,h2,h3,h4,h5,h6{font-family:" + f.heading + " !important}");
    if (a.scale && a.scale >= 70 && a.scale <= 150) r.push("html{font-size:" + a.scale + "% !important}");
    if (a.radius !== undefined && a.radius !== null && a.radius >= 0 && a.radius <= 40) r.push("button,a[class*=btn],.btn,input,textarea,select,img,[class*=card]{border-radius:" + a.radius + "px !important}");
    if ((a.order && a.order.length) || (a.hidden && a.hidden.length)) {
      r.push("[data-ab-host]{display:flex !important;flex-direction:column !important}");
      (a.order || []).forEach(function (id, i) { if (/^b\d+$/.test(id)) r.push('[data-ab-block="' + id + '"]{order:' + (i + 1) + "}"); });
      (a.hidden || []).forEach(function (id) { if (/^b\d+$/.test(id)) r.push('[data-ab-block="' + id + '"]{display:none !important}'); });
    }
    return r.join("\n");
  }
  function apply(a) {
    lastApply = a;
    if (!style) { style = document.createElement("style"); style.id = "ab-edit"; document.head.appendChild(style); }
    style.textContent = css(a);
    (a.texts || []).forEach(function (t) {
      var el; try { el = document.querySelector(t.path); } catch (e) { return; }
      if (el && el.innerText !== t.text && document.activeElement !== el) el.innerText = t.text;
    });
  }
  function onInput(e) {
    var el = e.target.closest ? e.target.closest("[data-ab-editable]") : null;
    if (!el) return;
    var path = pathOf(el);
    if (!(path in originals)) originals[path] = el.getAttribute("data-ab-before") || "";
    send({ type: "ab-edit-text", path: path, before: originals[path], text: el.innerText.slice(0, 1000) });
  }
  function setText(on) {
    Array.prototype.forEach.call(document.querySelectorAll(TEXT_TAGS), function (el) {
      if (el.closest("[data-ab-editable]") && !el.hasAttribute("data-ab-editable")) return;
      if (!el.innerText || !el.innerText.trim()) return;
      if (on) {
        if (!el.hasAttribute("data-ab-before")) el.setAttribute("data-ab-before", el.innerText.slice(0, 1000));
        el.setAttribute("data-ab-editable", ""); el.contentEditable = "true";
      } else { el.removeAttribute("data-ab-editable"); el.removeAttribute("contenteditable"); }
    });
  }
  var outline = document.createElement("style");
  outline.textContent = "[data-ab-editable]:hover,[data-ab-editable]:focus{outline:2px dashed #4cc4ff !important;outline-offset:2px;cursor:text}.ab-hover{outline:2px solid #ff9f1c !important;outline-offset:2px;cursor:crosshair !important}";
  function onMove(e) {
    if (!mode.pick) return;
    if (hoverEl) hoverEl.classList.remove("ab-hover");
    hoverEl = e.target; if (hoverEl && hoverEl.classList) hoverEl.classList.add("ab-hover");
  }
  function onClick(e) {
    if (mode.text && e.target.closest && e.target.closest("[data-ab-editable]")) { e.preventDefault(); return; }
    if (!mode.pick) return;
    e.preventDefault(); e.stopPropagation();
    var el = e.target;
    if (hoverEl) hoverEl.classList.remove("ab-hover");
    send({ type: "ab-edit-picked", path: pathOf(el), tag: el.tagName.toLowerCase(), text: (el.innerText || el.getAttribute("alt") || el.getAttribute("aria-label") || "").trim().slice(0, 140) });
  }
  /** A site's own scripts draw the page after this runs: answer once there is something to edit. */
  var answering = false;
  function answerWhenDrawn(tries) {
    if (answering && tries === 0) return;
    answering = true;
    var list = document.readyState === "complete" ? blocks() : [];
    if (!list.length && tries < 15) { setTimeout(function () { answerWhenDrawn(tries + 1); }, 300); return; }
    answering = false;
    send({ type: "ab-edit-ready", vars: colorVars(), blocks: list.length ? list : blocks(), fonts: FONTS, slots: slots(), title: document.title });
    if (lastApply) apply(lastApply);
  }
  window.addEventListener("message", function (e) {
    if (e.source !== window.parent) return;
    var m = e.data || {};
    if (m.type === "ab-edit-hello") {
      if (!outline.parentNode) document.head.appendChild(outline);
      answerWhenDrawn(0);
    } else if (m.type === "ab-edit-apply") {
      apply(m);
    } else if (m.type === "ab-edit-mode") {
      mode = { text: !!m.text, pick: !!m.pick };
      setText(mode.text);
      if (!mode.pick && hoverEl) hoverEl.classList.remove("ab-hover");
    }
  });
  // A new page in the same frame (a reload, a link followed): say so, so the
  // editor connects again and puts its changes and mode back on it.
  if (document.readyState === "complete") send({ type: "ab-edit-alive" });
  else window.addEventListener("load", function () { send({ type: "ab-edit-alive" }); });
  document.addEventListener("input", onInput, true);
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
})();`;

export const EDITOR_SCRIPT = `<script data-agent-builder-editor>${source}</script>`;
