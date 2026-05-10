const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || "/data";
const DATA_FILE = path.join(DATA_DIR, "nutritrack-state.json");
const INDEX_FILE = path.join(__dirname, "index.html");
const BEDCA_FILE = path.join(__dirname, "bedca-foods.json");

const defaultState = {
  history: {},
  profile: null,
  savedFoods: [],
  savedPlates: []
};

const fallbackFoods = [
  { name: "Pechuga de pollo", brands: "Generico", proteins: 31, carbs: 0, unitName: "filete", servingGrams: 125 },
  { name: "Arroz blanco cocido", brands: "Generico", proteins: 2.7, carbs: 28 },
  { name: "Arroz integral cocido", brands: "Generico", proteins: 2.6, carbs: 23 },
  { name: "Pasta cocida", brands: "Generico", proteins: 5.8, carbs: 30.9 },
  { name: "Pan blanco", brands: "Generico", proteins: 8.9, carbs: 49 },
  { name: "Pan integral", brands: "Generico", proteins: 13, carbs: 41 },
  { name: "Patata cocida", brands: "Generico", proteins: 1.9, carbs: 20 },
  { name: "Avena", brands: "Generico", proteins: 16.9, carbs: 66.3 },
  { name: "Platano", brands: "Generico", proteins: 1.1, carbs: 22.8, unitName: "unidad", servingGrams: 120 },
  { name: "Manzana", brands: "Generico", proteins: 0.3, carbs: 13.8, unitName: "unidad", servingGrams: 180 },
  { name: "Yogur griego natural", brands: "Generico", proteins: 10, carbs: 3.6 },
  { name: "Leche semidesnatada", brands: "Generico", proteins: 3.4, carbs: 4.8 },
  { name: "Atun al natural", brands: "Generico", proteins: 24, carbs: 0, unitName: "lata", servingGrams: 80 },
  { name: "Salmon", brands: "Generico", proteins: 20, carbs: 0, unitName: "filete", servingGrams: 150 },
  { name: "Ternera magra", brands: "Generico", proteins: 26, carbs: 0 },
  { name: "Huevo", brands: "Generico", proteins: 12.6, carbs: 1.1, unitName: "unidad", servingGrams: 60 },
  { name: "Clara de huevo", brands: "Generico", proteins: 10.9, carbs: 0.7 },
  { name: "Lentejas cocidas", brands: "Generico", proteins: 9, carbs: 20 },
  { name: "Garbanzos cocidos", brands: "Generico", proteins: 8.9, carbs: 27.4 },
  { name: "Queso fresco batido", brands: "Generico", proteins: 8, carbs: 4 },
  { name: "Proteina whey", brands: "Generico", proteins: 80, carbs: 8, unitName: "scoop", servingGrams: 30 },
  { name: "Oreo", brands: "Generico", proteins: 5, carbs: 70 }
];

function loadBedcaFoods() {
  try {
    return JSON.parse(fs.readFileSync(BEDCA_FILE, "utf8"));
  } catch (error) {
    console.warn("Could not load BEDCA foods:", error.message);
    return [];
  }
}

const bedcaFoods = loadBedcaFoods();

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, " ")
    .trim();
}

function normalizeToken(token) {
  if (token.length > 4 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

function searchTokens(value) {
  const stopWords = new Set(["de", "del", "la", "el", "los", "las", "y", "con", "para", "en"]);
  return normalizeText(value)
    .split(/\s+/)
    .map(normalizeToken)
    .filter((token) => token && !stopWords.has(token));
}

function scoreFood(food, query) {
  const queryText = normalizeText(query);
  const nameText = normalizeText(food.name);
  const searchText = normalizeText(`${food.name} ${food.brands || ""}`);
  const queryParts = searchTokens(query);
  const nameParts = searchTokens(food.name);
  if (!queryText || queryParts.length === 0) return 0;
  if (nameText === queryText) return 1000;
  if (nameText.startsWith(queryText)) return 900 - nameText.length / 100;
  const allTokensMatch = queryParts.every((queryPart) =>
    nameParts.some((namePart) => namePart === queryPart || namePart.startsWith(queryPart))
  );
  if (allTokensMatch) return 750 - nameText.length / 100;
  const searchTokensValue = searchTokens(searchText);
  const looseMatchCount = queryParts.filter((queryPart) =>
    searchTokensValue.some((part) => part === queryPart || part.startsWith(queryPart))
  ).length;
  if (looseMatchCount > 0) return 300 + looseMatchCount * 50 - nameText.length / 100;
  return 0;
}

function rankedSearch(foods, query, limit, minimumScore = 1) {
  const seen = new Set();
  return foods
    .map((food) => ({ ...food, score: scoreFood(food, query) }))
    .filter((food) => food.score >= minimumScore && food.name && (food.proteins || food.carbs))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "es"))
    .filter((food) => {
      const key = normalizeText(food.name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map(({ score, ...food }) => food);
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readState() {
  try {
    ensureDataDir();
    if (!fs.existsSync(DATA_FILE)) return defaultState;
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return {
      history: parsed.history || {},
      profile: "profile" in parsed ? parsed.profile : null,
      savedFoods: Array.isArray(parsed.savedFoods) ? parsed.savedFoods : [],
      savedPlates: Array.isArray(parsed.savedPlates) ? parsed.savedPlates : []
    };
  } catch (error) {
    console.error("Could not read state:", error);
    return defaultState;
  }
}

function writeState(state) {
  ensureDataDir();
  const cleanState = {
    history: state && state.history ? state.history : {},
    profile: state && "profile" in state ? state.profile : null,
    savedFoods: state && Array.isArray(state.savedFoods) ? state.savedFoods : [],
    savedPlates: state && Array.isArray(state.savedPlates) ? state.savedPlates : []
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(cleanState, null, 2));
  return cleanState;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        req.destroy();
        reject(new Error("Body too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      timeout: 8000,
      headers: {
        "User-Agent": "NutriTrack/1.6.0 (contact: https://github.com/Ismaeloul/umbrel-app-store)",
        "Accept": "application/json",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.5"
      }
    }, (response) => {
      let body = "";
      response.on("data", (chunk) => {
        body += chunk;
        if (body.length > 4_000_000) req.destroy(new Error("Response too large"));
      });
      response.on("end", () => {
        if ((response.statusCode || 500) >= 400) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("Request timed out")));
    req.on("error", reject);
    req.end();
  });
}

function normalizeFood(product) {
  const nutriments = product.nutriments || {};
  const proteins = Number(nutriments.proteins_100g ?? nutriments["proteins"] ?? 0);
  const carbs = Number(nutriments.carbohydrates_100g ?? nutriments["carbohydrates"] ?? 0);
  return {
    name: product.product_name_es || product.product_name || product.generic_name_es || product.generic_name || "",
    brands: product.brands || "",
    proteins: Number.isFinite(proteins) ? proteins : 0,
    carbs: Number.isFinite(carbs) ? carbs : 0,
    unitName: product.serving_quantity ? "porcion" : "unidad",
    servingGrams: Number(product.serving_quantity) || 100
  };
}

function fallbackSearch(query, limit) {
  return rankedSearch([...fallbackFoods, ...bedcaFoods], query, limit);
}

async function collectFoodSearch(query, limit) {
  const genericProducts = fallbackSearch(query, limit);
  if (genericProducts.length > 0) {
    return { source: "bedca", products: genericProducts };
  }

  const params = new URLSearchParams({
    search_terms: query,
    search_simple: "1",
    action: "process",
    json: "1",
    page_size: String(limit),
    lc: "es",
    cc: "es",
    lang: "es",
    fields: "product_name_es,product_name,generic_name_es,generic_name,brands,nutriments,serving_quantity"
  });

  const urls = [
    `https://es.openfoodfacts.org/cgi/search.pl?${params.toString()}`,
    `https://world.openfoodfacts.org/cgi/search.pl?${params.toString()}`
  ];

  for (const sourceUrl of urls) {
    try {
      const data = await fetchJson(sourceUrl);
      const products = (data.products || [])
        .map(normalizeFood)
        .filter((food) => food.name && (food.proteins || food.carbs))
        .map((food) => ({ ...food, score: scoreFood(food, query) }))
        .filter((food) => food.score >= 250)
        .sort((a, b) => b.score - a.score)
        .map(({ score, ...food }) => food)
        .slice(0, limit);
      if (products.length > 0) {
        return {
          source: sourceUrl.includes("es.") ? "openfoodfacts-es" : "openfoodfacts-world",
          products
        };
      }
    } catch (error) {
      console.warn(`Food search failed for ${sourceUrl}:`, error.message);
    }
  }

  return { source: "fallback", products: fallbackSearch(query, limit) };
}

async function searchFoods(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const query = (url.searchParams.get("q") || "").trim();
  const limit = Math.min(12, Math.max(1, Number(url.searchParams.get("limit") || 8)));
  if (query.length < 2) return sendJson(res, 200, { source: "empty", products: [] });

  sendJson(res, 200, await collectFoodSearch(query, limit));
}

async function legacyFoodSearch(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const query = (url.searchParams.get("search_terms") || url.searchParams.get("q") || "").trim();
  const limit = Math.min(12, Math.max(1, Number(url.searchParams.get("page_size") || 8)));
  if (query.length < 2) return sendJson(res, 200, { count: 0, products: [] });

  const result = await collectFoodSearch(query, limit);
  sendJson(res, 200, {
    count: result.products.length,
    page: 1,
    page_size: limit,
    source: result.source,
    products: result.products.map((food) => ({
      product_name_es: food.name,
      product_name: food.name,
      brands: food.brands,
      nutriments: {
        proteins_100g: food.proteins,
        carbohydrates_100g: food.carbs
      },
      serving_quantity: food.servingGrams || 100
    }))
  });
}

function proxyOpenFoodFacts(req, res) {
  const target = new URL(req.url.replace(/^\/off/, ""), "https://es.openfoodfacts.org");
  if (!target.searchParams.has("lc")) target.searchParams.set("lc", "es");
  if (!target.searchParams.has("cc")) target.searchParams.set("cc", "es");
  if (!target.searchParams.has("lang")) target.searchParams.set("lang", "es");

  const proxyReq = https.request(target, {
    headers: {
      "Host": "es.openfoodfacts.org",
      "User-Agent": "NutriTrack/1.6.0 (https://github.com/Ismaeloul/umbrel-app-store)",
      "Accept": "application/json"
    }
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 502, {
      "Content-Type": proxyRes.headers["content-type"] || "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    });
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (error) => {
    console.error("Open Food Facts proxy failed:", error);
    sendJson(res, 502, { error: "No se pudo conectar con Open Food Facts" });
  });
  proxyReq.end();
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/api/state") {
      return sendJson(res, 200, readState());
    }

    if (req.method === "PUT" && req.url === "/api/state") {
      const body = await readBody(req);
      return sendJson(res, 200, writeState(JSON.parse(body || "{}")));
    }

    if (req.method === "GET" && req.url.startsWith("/api/foods/search")) {
      return searchFoods(req, res);
    }

    if (req.method === "GET" && req.url.startsWith("/off/cgi/search.pl")) {
      return legacyFoodSearch(req, res);
    }

    if (req.url.startsWith("/off/")) {
      return proxyOpenFoodFacts(req, res);
    }

    if (req.method === "GET" && (req.url === "/" || req.url.startsWith("/?"))) {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });
      return fs.createReadStream(INDEX_FILE).pipe(res);
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    console.error("Request failed:", error);
    sendJson(res, 500, { error: "Error interno" });
  }
});

server.listen(PORT, () => {
  ensureDataDir();
  console.log(`NutriTrack listening on ${PORT}`);
});
