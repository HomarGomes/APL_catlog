/* =========================
   Catalog Loader (no backend)
   - Reads sources.json (optional)
   - Reads URLs from GitHub Issues (share-from-phone friendly)
   - Accepts ?add=<url> to render instantly
   - Pulls Shopify product/collection data via .json
   ========================= */

// ------------ CONFIG ------------
const GITHUB_OWNER = "homargomes"; 
const GITHUB_REPO  = "APL_catlog";         // <-- change me
const GITHUB_LABEL_FILTER = "source";          // optional label to filter issues; set "" to read all open issues

const UI = {
  gridId: "catalog",
  countId: "count",
  inboxNoticeId: "inbox",
  saveStripId: "save-strip"
};

// ------------ DOM helpers ------------
const $ = (id) => document.getElementById(id);
const delay = (ms) => new Promise(r => setTimeout(r, ms));
const fmtPrice = (p) => (p == null || p === "") ? "" : `$${Number(p).toFixed(2)}`;
const getDomain = (u) => { try { return new URL(u).hostname.replace(/^www\./,''); } catch { return ""; } };

// ------------ Render ------------
function ensureScaffold() {
  // if your index.html doesn't already have these elements, we add them
  if (!$("catalog")) {
    const grid = document.createElement("div");
    grid.id = "catalog";
    grid.className = "grid";
    document.body.appendChild(grid);
  }
  if (!$("count")) {
    const h = document.querySelector("h1") || document.body.insertBefore(document.createElement("h1"), document.body.firstChild);
    h.innerHTML = (h.innerHTML || "🛍️ My Shared Catalog") + ' · <span id="count"></span>';
  }
  if (!$("save-strip")) {
    const s = document.createElement("div");
    s.id = "save-strip";
    s.style.cssText = "display:none;margin:8px auto 16px;max-width:720px;padding:10px 12px;border:1px solid #e5e5e5;background:#fff;border-radius:10px;";
    document.body.insertBefore(s, $("catalog") || null);
  }
}

function updateCount(n) {
  const c = $(UI.countId);
  if (c) c.textContent = `${n} items`;
}

function cardHTML(it) {
  const img = it.image ? `<img src="${it.image}" alt="${it.name || ''}" style="width:100%;border-radius:8px;object-fit:cover;">` : "";
  const price = it.price ? ` – ${it.price}` : "";
  const site = it.site || getDomain(it.link);
  return `
    <div class="card">
      ${img}
      <h3 style="margin:.6rem 0 .2rem">${it.name || site || "Item"}</h3>
      <p style="margin:.2rem 0 .6rem;color:#444">${site}${price}</p>
      <a href="${it.link}" target="_blank" rel="noopener">View</a>
    </div>
  `;
}

function render(items) {
  ensureScaffold();
  const grid = $(UI.gridId);
  grid.innerHTML = items.map(cardHTML).join("");
  updateCount(items.length);
}

// ------------ Source: sources.json ------------
async function loadStaticSources() {
  try {
    const res = await fetch("sources.json?ts=" + Date.now());
    if (!res.ok) return [];
    const arr = await res.json();
    return arr.filter(x => x && (x.url || x.link || x.type));
  } catch {
    return [];
  }
}

// ------------ Source: GitHub Issues ------------
function issuesApiUrl(page = 1) {
  const base = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues?state=open&per_page=50&page=${page}`;
  return GITHUB_LABEL_FILTER ? `${base}&labels=${encodeURIComponent(GITHUB_LABEL_FILTER)}` : base;
}

// Extract all URLs from text
function extractUrls(text = "") {
  const re = /(https?:\/\/[^\s)]+[^\s.,)])/gi;
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

async function loadIssueLinks(maxPages = 4) {
  const urls = [];
  for (let page = 1; page <= maxPages; page++) {
    try {
      const res = await fetch(issuesApiUrl(page), { mode: "cors" });
      if (!res.ok) break;
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) break;
      data.forEach(issue => {
        const inTitle = extractUrls(issue.title || "");
        const inBody  = extractUrls(issue.body  || "");
        [...inTitle, ...inBody].forEach(u => urls.push(u));
      });
      await delay(200);
    } catch {
      break;
    }
  }
  return [...new Set(urls)];
}

// ------------ Source: URL param ?add= ------------
function getParamAddedUrl() {
  const u = new URL(location.href);
  const add = u.searchParams.get("add");
  return add && /^https?:\/\//i.test(add) ? add : null;
}

function showSaveStripFor(url) {
  const s = $(UI.saveStripId);
  if (!s) return;
  const issueUrl = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/issues/new?title=${encodeURIComponent(url)}${GITHUB_LABEL_FILTER ? `&labels=${encodeURIComponent(GITHUB_LABEL_FILTER)}` : ""}&body=${encodeURIComponent("Shared from catalog: " + url)}`;
  s.innerHTML = `
    <strong>Captured link:</strong> <code style="word-break:break-all">${url}</code>
    <div style="margin-top:6px">
      <a href="${issueUrl}" target="_blank" rel="noopener" style="text-decoration:none;padding:.5rem .7rem;border-radius:8px;border:1px solid #111">Save to GitHub</a>
      <span style="margin-left:8px;color:#555">Open the link above and press “Submit new issue”.</span>
    </div>
  `;
  s.style.display = "block";
}

// ------------ Shopify detection + mapping ------------
function productJsonUrl(productUrl) {
  if (!productUrl || !/\/products\//i.test(productUrl)) return null;
  if (productUrl.endsWith("/")) productUrl = productUrl.slice(0, -1);
  return productUrl + ".json";
}

function collectionPager(collectionUrl, limit = 50) {
  try {
    const u = new URL(collectionUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    const idx = parts.findIndex(p => p === "collections");
    if (idx === -1 || !parts[idx + 1]) return null;
    const handle = parts[idx + 1];
    const base = `${u.origin}/collections/${handle}/products.json?limit=${limit}`;
    return (page) => `${base}&page=${page}`;
  } catch {
    return null;
  }
}

function mapShopifyProduct(p, originLink) {
  const img = (p?.images && p.images[0]?.src) || p?.image?.src || "";
  const raw = p?.variants?.[0]?.price ?? p?.price;
  return {
    name: p?.title || "",
    image: img,
    price: raw ? fmtPrice(raw) : "",
    site: p?.vendor || getDomain(originLink),
    link: originLink
  };
}

async function loadShopifyProduct(url) {
  const jsonUrl = productJsonUrl(url);
  if (!jsonUrl) return [];
  try {
    const res = await fetch(jsonUrl, { mode: "cors" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const p = data.product || data;
    return [mapShopifyProduct(p, url)];
  } catch (e) {
    console.warn("Shopify product fetch failed:", url, e);
    return [];
  }
}

async function loadShopifyCollection(url, maxPages = 6) {
  const makeUrl = collectionPager(url);
  if (!makeUrl) return [];
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    try {
      const res = await fetch(makeUrl(page), { mode: "cors" });
      if (!res.ok) break;
      const data = await res.json();
      const products = data?.products || [];
      if (!products.length) break;
      const origin = new URL(url).origin;
      products.forEach(p => out.push(mapShopifyProduct(p, `${origin}/products/${p.handle}`)));
      await delay(250);
    } catch (e) {
      console.warn("Shopify collection page failed:", url, e);
      break;
    }
  }
  return out;
}

// Best effort classifier: decide how to treat a URL
function classifyUrl(u) {
  if (!u) return { type: "unknown" };
  if (/\/products\//i.test(u)) return { type: "shopify_product" };
  if (/\/collections\//i.test(u)) return { type: "shopify_collection" };
  return { type: "unknown" };
}

// ------------ Manual/Unknown fallback ------------
function minimalItemFor(url) {
  return {
    name: "",
    image: "",
    price: "",
    site: getDomain(url),
    link: url
  };
}

// ------------ Loader for arbitrary input entries ------------
async function expandEntry(entry) {
  // supports:
  //  - {type:"shopify_product", url:"..."}
  //  - {type:"shopify_collection", url:"..."}
  //  - {type:"manual", name,image,price,site,link}
  //  - raw URL string
  try {
    if (!entry) return [];
    if (typeof entry === "string") {
      const cls = classifyUrl(entry);
      if (cls.type === "shopify_product") return loadShopifyProduct(entry);
      if (cls.type === "shopify_collection") return loadShopifyCollection(entry);
      return [minimalItemFor(entry)];
    }
    if (entry.type === "manual") {
      return [{
        name: entry.name || "",
        image: entry.image || "",
        price: entry.price || "",
        site: entry.site || getDomain(entry.link),
        link: entry.link
      }];
    }
    if (entry.type === "shopify_product") return loadShopifyProduct(entry.url || entry.link);
    if (entry.type === "shopify_collection") return loadShopifyCollection(entry.url || entry.link);
    // Fallback: try to classify by URL field
    const url = entry.url || entry.link;
    if (url) return expandEntry(url);
    return [];
  } catch {
    return [];
  }
}

// ------------ MAIN ------------
(async function main() {
  ensureScaffold();

  // 1) Collect sources from sources.json (optional)
  const staticSources = await loadStaticSources();

  // 2) Collect URLs from GitHub Issues (share-from-phone flow)
  const issueLinks = await loadIssueLinks();

  // 3) Accept ?add=<url> for instant display and provide a save-to-GitHub hint
  const paramUrl = getParamAddedUrl();
  if (paramUrl) {
    showSaveStripFor(paramUrl);
  }

  // Merge inputs: static entries + issue URLs + param URL
  const merged = [
    ...staticSources,
    ...issueLinks,
    ...(paramUrl ? [paramUrl] : [])
  ];

  // Expand and dedupe by final link
  const results = [];
  const seen = new Set();

  for (const src of merged) {
    const items = await expandEntry(src);
    for (const it of items) {
      const key = it.link || (it.name + "|" + it.site);
      if (key && !seen.has(key)) {
        seen.add(key);
        results.push(it);
      }
    }
    // be polite to stores
    await delay(120);
  }

  render(results);
})();
