const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || "/data";
const DATA_FILE = path.join(DATA_DIR, "nutritrack-state.json");
const INDEX_FILE = path.join(__dirname, "index.html");

const defaultState = {
  history: {},
  profile: null
};

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
      profile: "profile" in parsed ? parsed.profile : null
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
    profile: state && "profile" in state ? state.profile : null
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

function proxyOpenFoodFacts(req, res) {
  const target = new URL(req.url.replace(/^\/off/, ""), "https://es.openfoodfacts.org");
  if (!target.searchParams.has("lc")) target.searchParams.set("lc", "es");
  if (!target.searchParams.has("cc")) target.searchParams.set("cc", "es");
  if (!target.searchParams.has("lang")) target.searchParams.set("lang", "es");

  const proxyReq = https.request(target, {
    headers: {
      "Host": "es.openfoodfacts.org",
      "User-Agent": "NutriTrack/1.3.0 (https://github.com/Ismaeloul/umbrel-app-store)",
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
