const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, "public");

const MAX_BODY = 64 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 60;
const clients = new Map();

function clamp(x, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, x));
}

/* =========================
   MOTEUR GARDIEN
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

    if (!Number.isFinite(value)) return 50 * confidence;

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
          (Number.isFinite(Number(i.confidence))
            ? Number(i.confidence)
            : 0.7),
        0
      ) / indicators.length
    : 0;

  const risk = risks.length
    ? risks.reduce((a, x) => a + x, 0) /
      Math.max(
        indicators.reduce(
          (a, i) =>
            a +
            (Number.isFinite(Number(i.confidence))
              ? Number(i.confidence)
              : 0.7),
          0
        ),
        0.0001
      )
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
        score: Number(
          clamp(benefit - penalty).toFixed(1)
        ),
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
      "Le moteur ne déclenche aucune action externe.",
      "GARDIEN ne doit jamais sauver l'humanité en devenant une menace pour l'humanité."
    ]
  };
}

/* =========================
   CLASSIFICATION
   ========================= */

function classify(question) {
  const s = question.toLowerCase();
  const themes = [];

  if (/eau|hydrique|océan|rivière/.test(s))
    themes.push("eau");

  if (/climat|carbone|émission|réchauffement|gaz à effet/.test(s))
    themes.push("climat");

  if (/déchet|recycl|plastique|ordure/.test(s))
    themes.push("déchets");

  if (/énergie|électricité|pétrole|gaz|nucléaire|solaire|éolien/.test(s))
    themes.push("énergie");

  if (/santé|maladie|hôpital|soin|pandémie/.test(s))
    themes.push("santé");

  if (/alimentation|agriculture|nourriture|famine/.test(s))
    themes.push("alimentation");

  if (/guerre|conflit|violence|arme|sécurité/.test(s))
    themes.push("sécurité");

  return themes.length ? themes : ["général"];
}

/* =========================
   ANALYSE GARDIEN
   ========================= */

function analyzeProblem(question) {
  const themes = classify(question);

  const solutionSets = {
    eau: [
      "réduction de la consommation",
      "réutilisation et traitement",
      "protection des bassins versants"
    ],

    climat: [
      "efficacité et sobriété",
      "électrification et énergie bas-carbone",
      "restauration des écosystèmes"
    ],

    déchets: [
      "réduction à la source",
      "réemploi et réparation",
      "recyclage et économie circulaire"
    ],

    énergie: [
      "efficacité énergétique",
      "diversification des sources",
      "stockage et résilience des réseaux"
    ],

    santé: [
      "prévention",
      "accès aux soins et capacités locales",
      "surveillance et préparation"
    ],

    alimentation: [
      "réduction des pertes",
      "résilience agricole",
      "diversification des sources alimentaires"
    ],

    sécurité: [
      "prévention et désescalade",
      "protection des civils et infrastructures",
      "coopération et résilience"
    ],

    général: [
      "prévention du risque",
      "solution progressive et réversible",
      "coopération et résilience"
    ]
  };

  const options = [
    ...new Set(
      themes.flatMap(
        theme =>
          solutionSets[theme] ||
          solutionSets.général
      )
    )
  ].slice(0, 6);

  return {
    engine: "GARDIEN-ANALYSE-1.0",

    question,

    themes,

    stages: [
      {
        name: "Problème",
        status: "identifié",
        detail:
          "La question est transformée en problème à examiner sans supposer de faits non fournis."
      },

      {
        name: "Risques",
        status: "à mesurer",
        detail:
          "Identifier les impacts humains, environnementaux, économiques et les risques secondaires."
      },

      {
        name: "Données",
        status: "à documenter",
        detail:
          "Sourcer les indicateurs, leur période, leur population et leur niveau d'incertitude."
      },

      {
        name: "Solutions",
        status: "générées",
        detail:
          "Comparer plusieurs options plutôt qu'une seule réponse."
      },

      {
        name: "Simulation",
        status: "prévue",
        detail:
          "Tester les conséquences, les coûts, les délais, la résilience et les effets indésirables."
      },

      {
        name: "Décision",
        status: "humaine",
        detail:
          "GARDIEN ne décide pas et ne déclenche aucune action réelle."
      }
    ],

    options,

    criteria: [
      "bénéfice humain",
      "impact sur la Terre",
      "résilience",
      "coût",
      "délai",
      "incertitude",
      "réversibilité"
    ],

    safety: [
      "Aucune personne n'est traitée comme sacrifiable.",
      "Aucune action externe autonome.",
      "Les faits, modèles, hypothèses et opinions doivent être distingués.",
      "Les objectifs fondamentaux de GARDIEN ne sont pas modifiés par une simple requête."
    ],

    limitations: [
      "Cette analyse structure le problème mais ne constitue pas une preuve scientifique.",
      "Aucune donnée réelle n'est inventée lorsque la question n'en fournit pas.",
      "Une décision réelle nécessite des sources fiables, des experts et une validation humaine."
    ]
  };
}

/* =========================
   RÉPONSE DÉMO
   ========================= */

function demoAnswer(question) {
  const analysis = analyzeProblem(question);

  return (
    "GARDIEN a identifié le thème : " +
    analysis.themes.join(", ") +
    ".\n\n" +
    "Solutions à examiner :\n" +
    analysis.options.map(x => "• " + x).join("\n") +
    "\n\n" +
    "La prochaine étape consiste à documenter les données, " +
    "simuler les conséquences et comparer les options avec leurs " +
    "coûts, risques, incertitudes et effets secondaires.\n\n" +
    "Décision finale : humaine."
  );
}

/* =========================
   IA OPTIONNELLE
   ========================= */

async function askAI(question) {
  const key = process.env.OPENAI_API_KEY;

  if (!key) {
    return demoAnswer(question);
  }

  const model = process.env.OPENAI_MODEL;

  if (!model) {
    return "Le modèle IA n'est pas configuré.";
  }

  const response = await fetch(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + key
      },

      body: JSON.stringify({
        model,

        input:
          "Tu es GARDIEN, une IA conseillère au service " +
          "de l'humanité et de la Terre. " +
          "Tu ne contrôles pas les humains. " +
          "Distingue faits, hypothèses et incertitudes. " +
          "N'invente pas de données. " +
          "Propose plusieurs options. " +
          "Ne déclenche aucune action réelle. " +
          "Aucune personne ne doit être considérée comme sacrifiable. " +
          "Question : " +
          question
      })
    }
  );

  if (!response.ok) {
    throw new Error("AI API " + response.status);
  }

  const data = await response.json();

  return data.output_text || "Réponse indisponible.";
}

/* =========================
   OUTILS SERVEUR
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

    req.on("end", () =>
      resolve(body)
    );

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

    /* HEALTH */

    if (
      req.method === "GET" &&
      urlPath === "/api/health"
    ) {
      return json(res, 200, {
        status: "ok",
        engine: "GARDIEN-CORE-2.0",
        analysis:
          "GARDIEN-ANALYSE-1.0",

        mode:
          process.env.OPENAI_API_KEY &&
          process.env.OPENAI_MODEL
            ? "ai"
            : "demo"
      });
    }

    /* API */
/* DONNÉES PUBLIQUES */
async function getRealData() {
  const indicators = [
    {
      id: "population",
      name: "Population mondiale",
      country: "WLD",
      indicator: "SP.POP.TOTL"
    },
    {
      id: "co2",
      name: "Émissions de CO₂",
      country: "WLD",
      indicator: "EN.ATM.CO2E.PC"
    },
    {
      id: "life",
      name: "Espérance de vie",
      country: "WLD",
      indicator: "SP.DYN.LE00.IN"
    }
  ];

  const results = await Promise.all(
    indicators.map(async item => {
      const url =
        "https://api.worldbank.org/v2/country/" +
        item.country +
        "/indicator/" +
        item.indicator +
        "?format=json&per_page=1";

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error("World Bank API error");
      }

      const data = await response.json();

      const value =
        data[1] &&
        data[1][0]
          ? data[1][0].value
          : null;

      const date =
        data[1] &&
        data[1][0]
          ? data[1][0].date
          : null;

      return {
        id: item.id,
        name: item.name,
        value,
        year: date,
        source: "World Bank Open Data"
      };
    })
  );

  return {
    source: "World Bank Open Data",
    updated: new Date().toISOString(),
    indicators: results
  };
}    if (req.method === "POST" && urlPath === "/api/evaluate") {
      try {
        const raw = await readBody(req);
        const payload = raw ? JSON.parse(raw) : {};
        return json(res, 200, evaluate(payload));
      } catch (err) {
        return json(res, 400, { error: "invalid_json" });
      }
    }

    if (req.method === "POST" && urlPath === "/api/ask") {
      try {
        const raw = await readBody(req);
        const payload = raw ? JSON.parse(raw) : {};
        const question = String(payload.question || "").trim();

        if (!question) {
          return json(res, 400, { error: "question_required" });
        }

        const answer = await askAI(question);

        return json(res, 200, {
          engine: "GARDIEN-ANALYSE-1.0",
          answer,
          human_control_required: true,
          external_action_taken: false
        });
      } catch (err) {
        return json(res, 500, {
          error: "ai_unavailable",
          message: err.message
        });
      }
    }

    if (req.method === "GET" && urlPath === "/api/real-data") {
      try {
        return json(res, 200, await getRealData());
      } catch (err) {
        return json(res, 502, {
          error: "real_data_unavailable",
          message: err.message
        });
      }
    }

    if (req.method === "GET") {
      const requested =
        urlPath === "/" ? "/index.html" : urlPath;

      const filePath = path.join(PUBLIC, requested);

      try {
        const stat = fs.statSync(filePath);

        if (!stat.isFile()) {
          throw new Error("not_file");
        }

        const ext = path.extname(filePath).toLowerCase();

        const types = {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".json": "application/json; charset=utf-8"
        };

        res.writeHead(200, {
          "Content-Type":
            types[ext] || "application/octet-stream",
          "Cache-Control": "no-cache"
        });

        return res.end(fs.readFileSync(filePath));
      } catch {
        return json(res, 404, {
          error: "not_found"
        });
      }
    }

    return json(res, 404, {
      error: "not_found"
    });
  }
);

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    "GARDIEN listening on port " + PORT
  );
});