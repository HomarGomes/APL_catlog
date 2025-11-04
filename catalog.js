// -------------------- helpers --------------------
const byId = (id) => document.getElementById(id);

function render(items) {
  const grid = byId("catalog");
  grid.innerHTML = "";
  items.forEach(it => {
    grid.innerHTML += `
      <div class="card">
        <img src="${it.image || ''}" alt="${it.name || ''}">
        <h3>${it.name || ''}</h3>
        <p>${it.site || ''} ${it.price ? "– " + it.price : ""}</p>
        <a href="${it.link}" target="_blank" rel="noopener">View</a>
      </div>
    `;
  });
}

function getDomain(u) { try { return new URL(u).hostname.replace(/^www\./,''); } catch { return ""; } }

// Basic rate limiter so we don't hammer stores
const delay = ms => new Promise(r => setTimeout(r, ms));

// -------------------- Shopify adapters --------------------
// Detect if a URL looks like a Shopify product or collection and build the corresponding JSON endpoint(s).

function productJsonUrl(productUrl) {
  // Shopify supports adding .json to product URLs
  if (!productUrl) return null;
  if (!productUrl.includes("/products/")) return null;
  // Normalize trailing slash
  if (productUrl.endsWith("/")) productUrl = productUrl.slice(0, -1);
  return productUrl + ".json";
}

function collectionProductsJsonUrls(collectionUrl, limit=50) {
  // Try to map collection URL -> /collections/<handle>/products.json?page=1&limit=...
  try {
    const u = new URL(collectionUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    const idx = parts.findIndex(p => p === "collections");
    if (idx === -1 || !parts[idx+1]) return [];
    const handle = parts[idx+1];
    const base = `${u.origin}/collections/${handle}/products.json?limit=${limit}`;
    // We'll fetch pages until empty
    return (page) => `${base}&page=${page}`;
  } catch {
    return [];
  }
}

// Map Shopify product JSON -> our item shape
function mapShopifyProduct(p, sourceLink) {
  const img = (p?.images && p.images[0]?.src) || p?.image?.src || "";
  const price = p?.variants?.[0]?.price ? `$${Number(p.variants[0].price).toFixed(2)}` : "";
  return {
    name: p?.title || "",
    image: img,
    price,
    site: (p?.vendor || getDomain(sourceLink)),
    link: sourceLink
  };
}

// -------------------- loaders --------------------

async function loadShopifyProduct(link) {
  const jsonUrl = productJsonUrl(link);
  if (!jsonUrl) return [];
  try {
    const res = await fetch(jsonUrl, { mode: "cors" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const p = data.product || data; // some stores return {product:{...}}
    return [mapShopifyProduct(p, link)];
  } catch (e) {
    console.warn("product fetch failed", link, e);
    return []; // fallback silently
  }
}

async function loadShopifyCollection(link, maxPages = 5) {
  const makeUrl = collectionProductsJsonUrls(link);
  if (!makeUrl) return [];
  let page = 1, out = [];
  while (page <= maxPages) {
    const url = makeUrl(page);
    try {
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) break;
      const data = await res.json();
      const products = data?.products || [];
      if (!products.length) break;
      products.forEach(p => out.push(mapShopifyProduct(p, `${new URL(link).origin}/products/${p.handle}`)));
      page++;
      await delay(250); // be polite
    } catch (e) {
      console.warn("collection fetch failed", url, e);
      break;
    }
  }
  return out;
}

// -------------------- main --------------------
async function loadSources() {
  const res = await fetch("sources.json?ts=" + Date.now());
  const sources = await res.json();

  const results = [];
  for (const s of sources) {
    if (s.type === "shopify_product") {
      results.push(...await loadShopifyProduct(s.url));
    } else if (s.type === "shopify_collection") {
      results.push(...await loadShopifyCollection(s.url));
    } else if (s.type === "manual") {
      // trust user-provided fields
      results.push({
        name: s.name || "",
        image: s.image || "",
        price: s.price || "",
        site: s.site || getDomain(s.link),
        link: s.link
      });
    }
  }
  return results;
}

(async () => {
  const items = await loadSources();
  render(items);
})();
