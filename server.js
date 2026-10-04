const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, "public");

const MAX_BODY = 64 * 1024;
const MAX_QUESTION = 4000;

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 60;
const clients = new Map();

const DATA_CACHE_MS = 15 * 60 * 1000;
let realDataCache = {
  expires: 0,
  data: null
};

function clamp(x, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, x));
}

/* =========================
   GARDIEN CORE
========================= */

function evaluate(payload) {
  const indicators = Array.isArray(payload.indicators)
    ? payload.indicators
    : [];

  const interventions = Array.isArray(payload.interventions)
    ? payload.interventions
    : [];

  const risks = indicators.map(i => {
    const value = Number(i.value);

    const confidence = Number.isFinite(Number(i.confidence))
      ? Number(i.confidence)
      : 0.7;

    if (!Number.isFinite(value)) {
      return 50 * confidence;
    }

    const delta =
      i.direction === "higher_better"
        ? 50 - value
        : value - 50;

    return clamp(50 + delta) * confidence;
  });

  const confidence = indicators.length
    ? indicators.reduce(
        (a, i) =>
          a +
          (
            Number.isFinite(Number(i.confidence))
              ? Number(i.confidence)
              : 0.7
          ),
        0
      ) / indicators.length
    : 0;

  const totalConfidence = indicators.reduce(
    (a, i) =>
      a +
      (
        Number.isFinite(Number(i.confidence))
          ? Number(i.confidence)
          : 0.7
      ),
    0
  );

  const risk = risks.length
    ? risks.reduce((a, x) => a + x, 0) /
      Math.max(totalConfidence, 0.0001)
    : 0;

  const ranking = interventions
    .map(x => {
      const human = Number(x.human) || 0;
      const planet = Number(x.planet) || 0;
      const resilience = Number(x.resilience) || 0;
      const cost = Number(x.cost) || 0;
      const uncertainty = Number(x.uncertainty) || 0;
      const time = Number(x.time_to_impact) || 0;

      const benefit =
        0.40 * human +
        0.35 * planet +
        0.25 * resilience;

      const penalty =
        0.15 * cost +
        0.15 * uncertainty +
        0.10 * time;

      return {
        name: String(x.name || "Solution sans nom"),
        score: Number(clamp(benefit - penalty).toFixed(1)),
        details: x
      };
    })
    .sort((a, b) => b.score - a.score);

  return {
    engine: "GARDIEN-CORE-2.0",

    risk_score: Number(risk.toFixed(1)),

    risk_band:
      risk < 35
        ? "faible"
        : risk < 65
          ? "modéré"
          : "élevé",

    data_confidence: Number(confidence.toFixed(2)),

    ranking,

    human_control_required: true,

    external_action_taken: false,

    notes: [
      "Résultat produit par le moteur GARDIEN.",
      "Les données doivent être sourcées et validées avant toute utilisation réelle.",
      "La confiance indique la qualité/provenance disponible, pas une certitude scientifique.",
      "Le moteur ne déclenche aucune action externe.",
      "La décision finale appartient toujours aux humains."
    ]
  };
}

/* =========================
   DONNÉES PUBLIQUES
   WORLD BANK
========================= */

const WORLD_BANK_INDICATORS = [
  {
    id: "population",
    code: "SP.POP.TOTL",
    name: "Population mondiale",
    unit: "personnes",
    direction: "context",
    confidence: 0.95
  },
  {
    id: "co2_per_capita",
    code: "EN.ATM.CO2E.PC",
    name: "Émissions de CO₂ par habitant",
    unit: "tonnes métriques par habitant",
    direction: "lower_better",
    confidence: 0.90
  },
  {
    id: "renewable_energy",
    code: "EG.FEC.RNEW.ZS",
    name: "Part des énergies renouvelables",
    unit: "% de consommation énergétique",
    direction: "higher_better",
    confidence: 0.90
  },
  {
    id: "safe_drinking_water",
    code: "SH.H2O.SMDW.ZS",
    name: "Accès à l'eau potable gérée en toute sécurité",
    unit: "% de la population",
    direction: "higher_better",
    confidence: 0.88
  }
,
{
  id: "life_expectancy",
  code: "SP.DYN.LE00.IN",
  name: "Espérance de vie à la naissance",
  unit: "années",
  direction: "higher_better",
  confidence: 0.95
},
{
  id: "infant_mortality",
  code: "SH.DYN.NMRT",
  name: "Mortalité néonatale",
  unit: "décès pour 1 000 naissances",
  direction: "lower_better",
  confidence: 0.92
},
{
  id: "forest_area",
  code: "AG.LND.FRST.ZS",
  name: "Surface forestière",
  unit: "% de la superficie terrestre",
  direction: "higher_better",
  confidence: 0.90
},
{
  id: "poverty",
  code: "SI.POV.DDAY",
  name: "Population vivant sous le seuil international de pauvreté",
  unit: "% de la population",
  direction: "lower_better",
  confidence: 0.88
},
{
  id: "greenhouse_gas",
  code: "EN.ATM.GHGT.KT.CE",
  name: "Émissions de gaz à effet de serre",
  unit: "kilotonnes de CO₂ équivalent",
  direction: "lower_better",
  confidence: 0.88
}
];

async function fetchWorldBankIndicator(indicator) {
  const url =
    "https://api.worldbank.org/v2/country/WLD/indicator/" +
    encodeURIComponent(indicator.code) +
    "?format=json&per_page=20";

  const response = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "GARDIEN/2.0"
    }
  });

  if (!response.ok) {
    throw new Error(
      `World Bank ${indicator.code}: HTTP ${response.status}`
    );
  }

  const data = await response.json();

if (!Array.isArray(data) || !Array.isArray(data[1])) {
  throw new Error(
    `Réponse World Bank invalide pour ${indicator.code}`
  );
}
    
        
}

  const observation = data[1].find(
    item =>
      item &&
      item.value !== null &&
      item.value !== undefined
  );

  if (!observation) {
    throw new Error(
      `Aucune donnée disponible pour ${indicator.code}`
    );
  }

  return {
    id: indicator.id,
    indicator: indicator.name,
    code: indicator.code,
    value: Number(observation.value),
    year: Number(observation.date),
    unit: indicator.unit,
    direction: indicator.direction,

    source: "World Bank Open Data",
    source_url: "https://data.worldbank.org/",

    confidence: indicator.confidence,

    uncertainty: "À interpréter selon la méthodologie de la source.",

    verified_at: new Date().toISOString()
  };
}

async function getRealData() {
  const now = Date.now();

  if (
    realDataCache.data &&
    now < realDataCache.expires
  ) {
    return realDataCache.data;
  }

  const results = await Promise.allSettled(
    WORLD_BANK_INDICATORS.map(fetchWorldBankIndicator)
  );

  const indicators = [];
  const errors = [];

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      indicators.push(result.value);
    } else {
      errors.push({
        indicator: WORLD_BANK_INDICATORS[index].id,
        error: result.reason
          ? String(result.reason.message || result.reason)
          : "Erreur inconnue"
      });
    }
  });

  const result = {
    engine: "GARDIEN-CORE-2.0",

    source: "World Bank Open Data",

    source_url: "https://data.worldbank.org/",

    updated: new Date().toISOString(),

    territory: "Monde",

    indicators,

    status:
      indicators.length === WORLD_BANK_INDICATORS.length
        ? "complete"
        : indicators.length > 0
          ? "partial"
          : "unavailable",

    errors,

    human_validation_required: true,

    note:
      "Les données correspondent à la dernière observation disponible retournée par la source. Elles ne signifient pas nécessairement que la valeur correspond à l'année courante."
  };

  realDataCache = {
    expires: now + DATA_CACHE_MS,
    data: result
  };

  return result;
}

/* =========================
   IA GARDIEN
========================= */

function demoAnswer(question) {
  const s = question.toLowerCase();

  if (s.includes("eau")) {
    return (
      "GARDIEN recommande de mesurer la qualité, " +
      "la disponibilité, la consommation et la résilience " +
      "hydrique, puis de comparer plusieurs solutions " +
      "comme la conservation, la réutilisation, " +
      "les infrastructures et la protection des bassins versants."
    );
  }

  if (s.includes("climat")) {
    return (
      "GARDIEN propose d'examiner les leviers liés à " +
      "l'énergie, aux transports, aux bâtiments, à " +
      "l'industrie et aux écosystèmes, en distinguant " +
      "les faits établis, les hypothèses et les incertitudes."
    );
  }

  if (
    s.includes("déchet") ||
    s.includes("déchets")
  ) {
    return (
      "GARDIEN examine la réduction à la source, " +
      "le réemploi, le tri, le recyclage et l'économie " +
      "circulaire, en tenant compte des coûts, bénéfices " +
      "et incertitudes."
    );
  }

  return (
    "GARDIEN peut analyser un problème, comparer " +
    "plusieurs solutions et expliquer leurs conséquences " +
    "et incertitudes. En mode démonstration, aucune " +
    "donnée réelle n'est supposée."
  );
}

async function askAI(question) {
  const key = process.env.OPENAI_API_KEY;

  if (!key) {
    return demoAnswer(question);
  }

  const model = process.env.OPENAI_MODEL;

  if (!model) {
    return (
      "Le modèle IA n'est pas configuré. " +
      "Définissez OPENAI_MODEL côté serveur."
    );
  }

  const systemPrompt =
    "Tu es GARDIEN, une IA conseillère au service " +
    "de l'humanité et de la Terre. " +
    "Tu ne contrôles pas les humains. " +
    "Tu dois distinguer les faits, les hypothèses " +
    "et les incertitudes. " +
    "Tu ne dois jamais inventer de données. " +
    "Tu présentes plusieurs options lorsque c'est pertinent. " +
    "Tu expliques les avantages, les coûts, les risques " +
    "et les compromis. " +
    "Tu ne déclenches aucune action dans le monde réel. " +
    "La décision finale appartient toujours aux humains. " +
    "Tu ne proposes pas d'action dangereuse ou illégale.";

  const response = await fetch(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + key
      },

      body: JSON.stringify({
        model,
        input:
          systemPrompt +
          "\n\nQuestion de l'utilisateur:\n" +
          question
      })
    }
  );

  if (!response.ok) {
    throw new Error(
      "AI API " + response.status
    );
  }

  const data = await response.json();

  return (
    data.output_text ||
    "Réponse indisponible."
  );
}

/* =========================
   HTTP / SÉCURITÉ
========================= */

function json(res, code, obj) {
  const body = Buffer.from(
    JSON.stringify(obj)
  );

  res.writeHead(code, {
    "Content-Type":
      "application/json; charset=utf-8",

    "Cache-Control": "no-store"
  });

  res.end(body);
}

function securityHeaders(res) {
  res.setHeader(
    "X-Content-Type-Options",
    "nosniff"
  );

  res.setHeader(
    "X-Frame-Options",
    "DENY"
  );

  res.setHeader(
    "Referrer-Policy",
    "no-referrer"
  );

  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()"
  );

  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; " +
    "script-src 'self'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; " +
    "connect-src 'self'; " +
    "frame-ancestors 'none'; " +
    "base-uri 'self'; " +
    "form-action 'self'"
  );
}

function allowed(req) {
  const ip = (
    req.headers["x-forwarded-for"] ||
    req.socket.remoteAddress ||
    "unknown"
  )
    .toString()
    .split(",")[0]
    .trim();

  const now = Date.now();

  const old = clients.get(ip);

  if (
    !old ||
    now - old.start > RATE_WINDOW_MS
  ) {
    clients.set(ip, {
      start: now,
      count: 1
    });

    return true;
  }

  old.count++;

  return old.count <= RATE_MAX;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", chunk => {
      body += chunk;

      if (
        Buffer.byteLength(body) >
        MAX_BODY
      ) {
        req.destroy();

        reject(
          new Error("payload_too_large")
        );
      }
    });

    req.on("end", () => {
      resolve(body);
    });

    req.on("error", reject);
  });
}

/* =========================
   SERVEUR
========================= */

const server = http.createServer(
  async (req, res) => {
    securityHeaders(res);

    if (!allowed(req)) {
      return json(
        res,
        429,
        { error: "rate_limit" }
      );
    }

    const urlPath =
      (req.url || "/").split("?")[0];

    /* Santé du serveur */

    if (
      req.method === "GET" &&
      urlPath === "/api/health"
    ) {
      return json(res, 200, {
        status: "ok",

        engine: "GARDIEN-CORE-2.0",

        mode:
          process.env.OPENAI_API_KEY &&
          process.env.OPENAI_MODEL
            ? "ai"
            : "demo",

        real_data: true,

        human_control_required: true,

        external_action_taken: false
      });
    }

    /* Données publiques réelles */

    if (
      req.method === "GET" &&
      urlPath === "/api/real-data"
    ) {
      try {
        const data =
          await getRealData();

        return json(
          res,
          200,
          data
        );
      } catch (error) {
        return json(
          res,
          500,
          {
            error:
              "real_data_unavailable"
          }
        );
      }
    }

        /* Historique des données publiques */

    if (req.method === "GET" && urlPath === "/api/history") {
      try {
        const indicatorId = new URL(
          req.url,
          "http://localhost"
        ).searchParams.get("indicator");

        const indicator = WORLD_BANK_INDICATORS.find(
          item => item.id === indicatorId
        );

        if (!indicator) {
          return json(res, 400, {
            error: "indicator_not_allowed"
          });
        }

        const url =
          "https://api.worldbank.org/v2/country/WLD/indicator/" +
          encodeURIComponent(indicator.code) +
          "?format=json&per_page=100";

        const response = await fetch(url);

        if (!response.ok) {
          throw new Error("World Bank error");
        }

        const data = await response.json();

        const history = data[1]
          .filter(item => item.value !== null)
          .map(item => ({
            year: Number(item.date),
            value: Number(item.value)
          }))
          .sort((a, b) => a.year - b.year);

        return json(res, 200, {
          engine: "GARDIEN-CORE-2.0",
          indicator: indicator.name,
          unit: indicator.unit,
          source: "World Bank Open Data",
          confidence: indicator.confidence,
          history
        });

      } catch (error) {
        return json(res, 500, {
          error: "history_unavailable"
        });
      }
    }/* Analyse GARDIEN */

    if (
      req.method === "POST" &&
      urlPath === "/api/evaluate"
    ) {
      try {
        const raw =
          await readBody(req);

        const payload =
          JSON.parse(raw || "{}");

        return json(
          res,
          200,
          evaluate(payload)
        );
      } catch (error) {
        const code =
          error.message ===
          "payload_too_large"
            ? 413
            : 500;

        return json(
          res,
          code,
          {
            error:
              code === 413
                ? "payload_too_large"
                : "server_error"
          }
        );
      }
    }

    /* Question à l'IA */

    if (
      req.method === "POST" &&
      urlPath === "/api/ask"
    ) {
      try {
        const raw =
          await readBody(req);

        const payload =
          JSON.parse(raw || "{}");

        if (
          typeof payload.question !==
            "string" ||
          !payload.question.trim()
        ) {
          return json(
            res,
            400,
            {
              error:
                "question_required"
            }
          );
        }

        const question =
          payload.question
            .trim()
            .slice(0, MAX_QUESTION);

        const answer =
          await askAI(question);

        return json(
          res,
          200,
          { answer }
        );
      } catch (error) {
        console.error(
          "GARDIEN /api/ask:",
          error
        );

        return json(
          res,
          500,
          {
            error:
              "server_error"
          }
        );
      }
    }

    /* Méthodes HTTP autorisées */

    if (
      req.method !== "GET" &&
      req.method !== "HEAD"
    ) {
      return json(
        res,
        405,
        {
          error:
            "method_not_allowed"
        }
      );
    }

    /* Fichiers du site */

    let fileUrl =
      urlPath === "/"
        ? "/index.html"
        : urlPath;

    const file = path.resolve(
      PUBLIC,
      "." + fileUrl
    );

    if (
      !file.startsWith(
        PUBLIC + path.sep
      )
    ) {
      return json(
        res,
        403,
        {
          error:
            "forbidden"
        }
      );
    }

    fs.readFile(
      file,
      (err, data) => {
        if (err) {
          return json(
            res,
            404,
            {
              error:
                "not_found"
            }
          );
        }

        const ext =
          path.extname(file);

        const types = {
          ".html":
            "text/html; charset=utf-8",

          ".css":
            "text/css; charset=utf-8",

          ".js":
            "text/javascript; charset=utf-8",

          ".json":
            "application/json; charset=utf-8",

          ".svg":
            "image/svg+xml",

          ".webmanifest":
            "application/manifest+json"
        };

        res.writeHead(
          200,
          {
            "Content-Type":
              types[ext] ||
              "application/octet-stream",

            "Cache-Control":
              ext === ".html"
                ? "no-cache"
                : "public, max-age=3600"
          }
        );

        if (
          req.method !== "HEAD"
        ) {
          res.end(data);
        } else {
          res.end();
        }
      }
    );
  }
);

/* =========================
   DÉMARRAGE / ARRÊT
========================= */

server.listen(
  PORT,
  () => {
    console.log(
      `GARDIEN : serveur actif sur le port ${PORT}`
    );
  }
);

process.on(
  "SIGTERM",
  () =>
    server.close(
      () => process.exit(0)
    )
);

process.on(
  "SIGINT",
  () =>
    server.close(
      () => process.exit(0)
    )
);