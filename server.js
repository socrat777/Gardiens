const http = require("http");
const fs = require("fs");
const path = require("path");const zlib = require("zlib");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, "public");
const MAX_BODY = 64 * 1024;
const MAX_QUESTION = 4000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 60;
const clients = new Map();
const DATA_CACHE_MS = 15 * 60 * 1000;
let realDataCache = { expires: 0, data: null };

function clamp(x, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, x));
}
function assessReliability(indicator) {
  const year = Number(indicator.year);
  const currentYear = new Date().getUTCFullYear();

  const age = Number.isFinite(year)
    ? Math.max(0, currentYear - year)
    : null;

  let freshness = "unknown";

  if (age !== null) {
    if (age <= 2) {
      freshness = "good";
    } else if (age <= 5) {
      freshness = "aging";
    } else {
      freshness = "stale";
    }
  }

  const sourceVerified =
    Boolean(indicator.source) &&
    Boolean(indicator.source_url) &&
    Number.isFinite(Number(indicator.value));

  const completeness =
    sourceVerified &&
    Number.isFinite(year) &&
    Boolean(indicator.unit)
      ? "complete"
      : "partial";

  const baseConfidence =
    Number.isFinite(Number(indicator.confidence))
      ? Number(indicator.confidence)
      : 0.70;

  let score = baseConfidence;

  if (freshness === "aging") {
    score *= 0.90;
  }

  if (freshness === "stale") {
    score *= 0.70;
  }

  if (completeness === "partial") {
    score *= 0.75;
  }

  score = Number(
    Math.max(0, Math.min(1, score)).toFixed(2)
  );

  let status = "confirmed";

  if (!sourceVerified) {
    status = "unavailable";
  } else if (freshness === "stale") {
    status = "stale";
  } else if (completeness === "partial") {
    status = "partial";
  } else if (score < 0.75) {
    status = "partial";
  }

  return {
    status,
    score,
    freshness,
    completeness,
    source_verified: sourceVerified,
    observation_age_years: age,
    cross_source_check: "not_available"
  };
}

function assessOverallReliability(indicators, errors) {
  if (!indicators.length) {
    return {
      status: "unavailable",
      score: 0,
      confirmed: 0,
      partial: 0,
      stale: 0,
      conflicts: 0,
      unavailable: errors.length
    };
  }

  const counts = {
    confirmed: 0,
    partial: 0,
    stale: 0,
    conflict: 0,
    unavailable: errors.length
  };

  let total = 0;

  indicators.forEach(indicator => {
    const reliability = indicator.reliability;

    if (!reliability) {
      return;
    }

    total += reliability.score;

    if (reliability.status === "confirmed") {
      counts.confirmed++;
    } else if (reliability.status === "stale") {
      counts.stale++;
    } else if (reliability.status === "conflict") {
      counts.conflict++;
    } else if (reliability.status === "unavailable") {
      counts.unavailable++;
    } else {
      counts.partial++;
    }
  });

  const score = Number(
    (total / indicators.length).toFixed(2)
  );

  let status = "confirmed";

  if (counts.conflict > 0) {
    status = "conflict";
  } else if (
    counts.unavailable > 0 &&
    counts.confirmed === 0
  ) {
    status = "unavailable";
  } else if (
    counts.partial > 0 ||
    counts.stale > 0 ||
    counts.unavailable > 0
  ) {
    status = "partial";
  }

  return {
    status,
    score,
    confirmed: counts.confirmed,
    partial: counts.partial,
    stale: counts.stale,
    conflicts: counts.conflict,
    unavailable: counts.unavailable
  };
}
const DATA_SOURCES = [
  { id: "world_bank", name: "World Bank Open Data", type: "économie / société / développement", status: "active", url: "https://data.worldbank.org/" },
  { id: "who", name: "Organisation mondiale de la Santé (OMS)", type: "santé mondiale", status: "active", url: "https://www.who.int/data" },
  { id: "fao", name: "FAOSTAT — FAO", type: "alimentation / agriculture / forêts", status: "planned", url: "https://www.fao.org/faostat/" },
  { id: "nasa", name: "NASA", type: "climat / Terre / environnement", status: "active", url: "https://data.nasa.gov/" },
  { id: "noaa", name: "NOAA", type: "climat / océans / atmosphère", status: "planned", url: "https://www.noaa.gov/" },
  { id: "un", name: "Organisation des Nations Unies", type: "population / développement durable", status: "active", url: "https://population.un.org/wpp/" }
];

const WORLD_BANK_INDICATORS = [
  { id: "population", code: "SP.POP.TOTL", name: "Population mondiale", unit: "personnes", direction: "context", confidence: 0.95 },
  { id: "co2_per_capita", code: "EN.ATM.CO2E.PC", name: "Émissions de CO₂ par habitant", unit: "tonnes métriques par habitant", direction: "lower_better", confidence: 0.90 },
  { id: "renewable_energy", code: "EG.FEC.RNEW.ZS", name: "Part des énergies renouvelables", unit: "% de consommation énergétique", direction: "higher_better", confidence: 0.90 },
  { id: "safe_drinking_water", code: "SH.H2O.SMDW.ZS", name: "Accès à l'eau potable gérée en toute sécurité", unit: "% de la population", direction: "higher_better", confidence: 0.88 },
  { id: "life_expectancy", code: "SP.DYN.LE00.IN", name: "Espérance de vie à la naissance", unit: "années", direction: "higher_better", confidence: 0.95 },
  { id: "infant_mortality", code: "SH.DYN.NMRT", name: "Mortalité néonatale", unit: "décès pour 1 000 naissances", direction: "lower_better", confidence: 0.92 },
  { id: "forest_area", code: "AG.LND.FRST.ZS", name: "Surface forestière", unit: "% de la superficie terrestre", direction: "higher_better", confidence: 0.90 },
  { id: "poverty", code: "SI.POV.DDAY", name: "Population vivant sous le seuil international de pauvreté", unit: "% de la population", direction: "lower_better", confidence: 0.88 },
  { id: "greenhouse_gas", code: "EN.ATM.GHGT.KT.CE", name: "Émissions de gaz à effet de serre", unit: "kilotonnes de CO₂ équivalent", direction: "lower_better", confidence: 0.88 }
]; 

async function fetchWorldBankIndicator(indicator) {
  const url = "https://api.worldbank.org/v2/country/WLD/indicator/" +
    encodeURIComponent(indicator.code) +
    "?format=json&per_page=20";

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "GARDIEN/2.0"
    }
  });

  if (!response.ok) {
    throw new Error(`World Bank ${indicator.code}: HTTP ${response.status}`);
  }

  const data = await response.json();

  if (!Array.isArray(data) || !Array.isArray(data[1])) {
    throw new Error(`Réponse World Bank invalide pour ${indicator.code}`);
  }

  const observation = data[1].find(
    item => item &&
      item.value !== null &&
      item.value !== undefined
  );

  if (!observation) {
    throw new Error(`Aucune donnée disponible pour ${indicator.code}`);
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
  uncertainty  : "À interpréter selon la méthodologie de la source.",
    verified_at: new Date().toISOString()
  };
}

async function fetchNASAClimateData() {
  const url =
    "https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv";

  const response = await fetch(url, {
    headers: {
      Accept: "text/csv",
      "User-Agent": "GARDIEN/2.0"
    }
  });

  if (!response.ok) {
    throw new Error(`NASA GISTEMP: HTTP ${response.status}`);
  }

  const text = await response.text();

  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const headerIndex = lines.findIndex(
    line => line.startsWith("Year,")
  );

  if (headerIndex === -1) {
    throw new Error("Format NASA GISTEMP non reconnu");
  }

  const headers = lines[headerIndex]
    .split(",")
    .map(x => x.trim());

  const yearIndex = headers.indexOf("Year");
  const annualIndex = headers.indexOf("J-D");

  if (yearIndex === -1 || annualIndex === -1) {
    throw new Error("Colonnes NASA GISTEMP introuvables");
  }

  const validRows = lines
    .slice(headerIndex + 1)
    .map(line => line.split(","))
    .filter(row => row.length > annualIndex)
    .map(row => ({
      year: Number(row[yearIndex]),
      value: Number(row[annualIndex])
    }))
    .filter(
      row =>
        Number.isFinite(row.year) &&
        Number.isFinite(row.value)
    );

  if (!validRows.length) {
    throw new Error("Aucune donnée NASA GISTEMP disponible");
  }

  const latest = validRows[validRows.length - 1];

  return {
    id: "nasa_global_temperature",
    indicator: "Anomalie de température de surface mondiale",
    code: "GISTEMP-GLB",
    value: latest.value,
    year: latest.year,
    unit: "°C par rapport à la période de référence NASA",
    direction: "lower_better",
    source: "NASA GISS GISTEMP",
    source_url: "https://data.giss.nasa.gov/gistemp/",
    confidence: 0.95,uncertainty:
  "Anomalie climatique issue de la méthodologie NASA GISTEMP.",
verified_at:
  new Date().toISOString()
};
}
    async function fetchUNPopulationData() {
  const now = Date.now();

  if (
    fetchUNPopulationData.cache &&
    now < fetchUNPopulationData.cache.expires
  ) {
    return fetchUNPopulationData.cache.data;
  }

  const url =
    "https://population.un.org/wpp/assets/Excel%20Files/1_Indicator%20(Standard)/CSV_FILES/WPP2024_TotalPopulationBySex.csv.gz";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/gzip, application/octet-stream",
        "User-Agent": "GARDIEN/2.0"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(
        `ONU WPP2024: HTTP ${response.status}`
      );
    }

    const buffer = Buffer.from(
      await response.arrayBuffer()
    );

    let csv;

    try {
      csv = zlib.gunzipSync(buffer).toString("utf8");
    } catch (error) {
      throw new Error(
        "ONU WPP2024: fichier gzip invalide"
      );
    }

    const lines = csv.split(/\r?\n/);
    let observation = null;

    for (let i = 1; i < lines.length; i += 1) {
      if (!lines[i]) continue;

      const columns = lines[i].split(",");

      if (
        columns.length >= 17 &&
        columns[9] === "World" &&
        columns[11] === "Medium" &&
        Number(columns[12]) === 2026 &&
        Number.isFinite(Number(columns[16]))
      ) {
        observation = {
          year: 2026,
          value: Number(columns[16]) * 1000
        };
        break;
      }
    }

    if (!observation) {
      throw new Error(
        "ONU WPP2024: donnée mondiale 2026 introuvable"
      );
    }

    const data = {
      id: "un_world_population",
      indicator:
        "Population mondiale — ONU WPP 2024",
      code: "WPP2024_TOTAL_POPULATION",
      value: Math.round(observation.value),
      year: observation.year,
      unit: "personnes",
      direction: "context",
      source:
        "Organisation des Nations Unies — World Population Prospects 2024",
      source_url:
        "https://population.un.org/wpp/",
      confidence: 0.95,
      data_type: "projection",
      uncertainty:
        "Projection WPP 2024, variante Medium. Cette valeur n'est pas une observation mesurée.",
      verified_at:
        new Date().toISOString()
    };

    fetchUNPopulationData.cache = {
      expires: now + 60 * 60 * 1000,
      data
    };

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

  

  async function getRealData() {
  const now = Date.now();
  if (
    realDataCache.data &&
    now < realDataCache.expires
  ) {
    return realDataCache.data;
  }
    

  const worldBankResults =
    await Promise.allSettled(
      WORLD_BANK_INDICATORS.map(
        fetchWorldBankIndicator
      )
    );

  const nasaResult =
    await Promise.allSettled([
      fetchNASAClimateData()
    ]);

  const whoResult =
    await Promise.allSettled([
      fetchWHOIndicator(WHO_INDICATORS[0])
    ]);const unResult =
  await Promise.allSettled([
    fetchUNPopulationData()
  ]);

  const indicators = [];
  const errors = [];

  worldBankResults.forEach(
    (result, index) => {
      if (result.status === "fulfilled") {
        indicators.push(result.value);
      } else {
        errors.push({
          source: "World Bank Open Data",
          indicator:
            WORLD_BANK_INDICATORS[index].id,
          error: String(
            result.reason?.message ||
            result.reason ||
            "Erreur inconnue"
          )
        });
      }
    }
  );

  nasaResult.forEach(result => {
    if (result.status === "fulfilled") {
      indicators.push(result.value);
    } else {
      errors.push({
        source: "NASA GISS GISTEMP",
        indicator:
          "nasa_global_temperature",
        error: String(
          result.reason?.message ||
          result.reason ||
          "Erreur inconnue"
        )
      });
    }
  });

    unResult.forEach(result => {
    if (result.status === "fulfilled") {
      indicators.push(result.value);
    } else {
      errors.push({
        source:
          "Organisation des Nations Unies — World Population Prospects 2024",
        indicator:
          "un_world_population",
        error: String(
          result.reason?.message ||
          result.reason ||
          "Erreur inconnue"
        )
      });
    }
  });whoResult.forEach(result => {
    if (result.status === "fulfilled") {
      indicators.push(result.value);
    } else {
      errors.push({
        source:
          "Organisation mondiale de la Santé (OMS)",
        indicator:
          WHO_INDICATORS[0].id,
        error: String(
          result.reason?.message ||
          result.reason ||
          "Erreur inconnue"
        )
      });
    }
  });

  const expectedCount =
    WORLD_BANK_INDICATORS.length + 3;

  const result = {
    engine: "GARDIEN-CORE-2.0",

    sources: [
      "World Bank Open Data",
      "NASA GISS GISTEMP",
      "Organisation mondiale de la Santé (OMS)",
"Organisation des Nations Unies — World Population Prospects 2024"
    ],

    updated:
      new Date().toISOString(),

    territory: "Monde",

    indicators,

    status:
      indicators.length === expectedCount
        ? "complete"
        : indicators.length > 0
          ? "partial"
          : "unavailable",

    errors,

    human_validation_required: true,

    external_action_taken: false,

    note:
      "Les données correspondent à la dernière observation disponible retournée par chaque source. Elles ne signifient pas nécessairement que toutes les valeurs correspondent à l'année courante."
  };

  result.indicators =
    result.indicators.map(
      indicator => ({
        ...indicator,
        reliability:
          assessReliability(indicator)
      })
    );

  result.reliability =
    assessOverallReliability(
      result.indicators,
      result.errors
    );

  realDataCache = {
    expires:
      now + DATA_CACHE_MS,
    data: result
  };

  return result;
}

function evaluate(payload) {
  const indicators =
    Array.isArray(payload.indicators)
      ? payload.indicators
      : [];

  const interventions =
    Array.isArray(payload.interventions)
      ? payload.interventions
      : [];

  const risks = indicators.map(i => {
    const value = Number(i.value);

    const confidence =
      Number.isFinite(Number(i.confidence))
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

  const totalConfidence =
    indicators.reduce(
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
      "La confiance indique la qualité/provenance disponible, pas une certitude scientifique.",
      "Le moteur ne déclenche aucune action externe.",
      "La décision finale appartient toujours aux humains."
    ]
  };
}

function demoAnswer(question) {
  const s = question.toLowerCase();

  if (s.includes("eau")) {
    return "GARDIEN recommande de mesurer la qualité, la disponibilité, la consommation et la résilience hydrique, puis de comparer plusieurs solutions comme la conservation, la réutilisation, les infrastructures et la protection des bassins versants.";
  }

  if (s.includes("climat")) {
    return "GARDIEN propose d'examiner les leviers liés à l'énergie, aux transports, aux bâtiments, à l'industrie et aux écosystèmes, en distinguant les faits établis, les hypothèses et les incertitudes.";
  }

  if (
    s.includes("déchet") ||
    s.includes("déchets")
  ) {
    return "GARDIEN examine la réduction à la source, le réemploi, le tri, le recyclage et l'économie circulaire, en tenant compte des coûts, bénéfices et incertitudes.";
  }

  return "GARDIEN peut analyser une question, comparer des scénarios et présenter les compromis. Les données doivent être sourcées, vérifiées et interprétées avec prudence. Les humains gardent la décision finale.";
}

async function askAI(question) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;

  if (!apiKey || !model) {
    return demoAnswer(question);
  }

  const realData = await getRealData();

  const context = {
    reliability: realData.reliability,
    indicators: realData.indicators,
    errors: realData.errors || [],
    rules: {
      human_decision_required: true,
      external_action_taken: false,
      no_autonomous_actions: true,
      distinguish_observation_projection_hypothesis: true
    }
  };

  const response = await fetch(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            
              content:
  `Tu es le moteur d'analyse scientifique et d'aide à la décision de GARDIEN.

Ta mission est d'aider l'humanité et de protéger la Terre sans jamais devenir une menace pour l'humanité.

Utilise exclusivement les données réelles fournies par GARDIEN.

N'invente aucune donnée, aucun chiffre, aucune source et aucun résultat.

Distingue toujours :
1. observation réelle ;
2. projection ;
3. hypothèse ;
4. incertitude.

Analyse le problème et propose plusieurs solutions réellement différentes.

Pour CHAQUE solution, indique :

- Solution
- Pourquoi elle pourrait fonctionner
- Impact humain
- Impact sur la Terre
- Coût
- Faisabilité
- Risques
- Incertitudes
- Groupes affectés
- Niveau de confiance
- Données utilisées
- Données manquantes
- Conséquences à court terme
- Conséquences à long terme

La section "Données utilisées" doit citer uniquement les indicateurs réellement présents dans gardien_data, avec leur source et leur année lorsque disponibles.

La section "Données manquantes" doit préciser quelles informations supplémentaires seraient nécessaires pour vérifier ou quantifier correctement la solution.

Si les données sont insuffisantes, dis-le clairement.

SIMULATION DES CONSÉQUENCES :

Si les données permettent un calcul, indique les hypothèses et le calcul.

Si elles ne permettent pas un calcul fiable, fais seulement une analyse qualitative et indique clairement qu'il ne s'agit pas d'une simulation quantitative validée.

Ne présente jamais une hypothèse comme un fait.

CLASSEMENT :

Classe les solutions selon :
- impact humain ;
- impact environnemental ;
- coût ;
- faisabilité ;
- risques ;
- qualité et quantité des données disponibles.

Le classement est indicatif et ne constitue jamais une vérité absolue.

Avant toute conclusion, indique :
- les principales données manquantes ;
- les limites de l'analyse ;
- les incertitudes importantes ;
- les effets pervers possibles ;
- les inégalités possibles ;
- les conséquences à long terme.

Si une donnée de l'ONU est une projection, indique-le explicitement.

GARDE-FOUS GARDIEN :

- décision humaine obligatoire ;
- aucune action externe ;
- aucune action autonome ;
- aucune décision politique prise par GARDIEN ;
- ne jamais sacrifier une population pour atteindre un objectif environnemental ;
- rechercher les solutions qui protègent simultanément les humains et la Terre.

Réponds en français de manière claire, scientifique et structurée.

Termine toujours par :

"Décision humaine requise : OUI"

puis une section :

"Ce qu'il faudrait mesurer ensuite".`

Utilise les données réelles fournies par GARDIEN. N'invente aucune donnée, aucun chiffre, aucune source et aucun résultat.

Distingue toujours :
1. observation réelle ;
2. projection ;
3. hypothèse ;
4. incertitude.

Analyse le problème posé et propose plusieurs solutions réellement différentes.

Pour chaque solution, analyse :
- impact humain ;
- impact sur la Terre ;
- coût ;
- faisabilité ;
- risques ;
- incertitudes ;
- groupes de population affectés ;
- niveau de preuve.

Compare les solutions et établis un classement indicatif.

Identifie clairement les données manquantes avant de présenter une conclusion.

Recherche les effets pervers possibles, les inégalités et les conséquences à long terme.

Si une donnée des Nations Unies est une projection, indique-le explicitement.

Le classement est une aide à la décision et non une vérité absolue.

GARDIEN ne doit jamais prendre une décision politique ou humaine à la place des humains.

GARDIEN ne doit jamais effectuer d'action externe ou autonome.

La décision finale appartient toujours aux humains.

Réponds en français, de manière claire, scientifique et compréhensible.
          },
          {
            role: "user",
            content: JSON.stringify({
              question: question,
              gardien_data: context
            })
          }
        ]
      })
    }
  );

  if (!response.ok) {
  let errorDetails = "";

  try {
    const errorData = await response.json();

    errorDetails =
      errorData?.error?.message ||
      errorData?.error?.code ||
      errorData?.message ||
      "";
  } catch (error) {
    errorDetails = "";
  }

  throw new Error(
    "OpenAI HTTP " +
    response.status +
    (errorDetails
      ? " — " + errorDetails
      : "")
  );
}

  const data = await response.json();

  const output =
    Array.isArray(data.output)
      ? data.output
          .flatMap(item =>
            Array.isArray(item.content)
              ? item.content
              : []
          )
          .map(item => item.text)
          .filter(Boolean)
          .join("\n")
      : "";

  return output || demoAnswer(question);
}

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type":
      "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  });

  res.end(JSON.stringify(payload));
}

function readBody(req) {
  
return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;

    req.on("data", chunk => {
      size += chunk.length;

      if (size > MAX_BODY) {
        reject(
          new Error("payload_too_large")
        );
        req.destroy();
        return;
      }

      body += chunk;
    });

    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function allowedRequest(req) {
  const forwarded =
    req.headers["x-forwarded-for"];

  const ip =
    typeof forwarded === "string"
      ? forwarded.split(",")[0].trim()
      : req.socket.remoteAddress || "unknown";

  const now = Date.now();
  const existing = clients.get(ip);

  if (
    !existing ||
    now - existing.start > RATE_WINDOW_MS
  ) {
    clients.set(ip, {
      start: now,
      count: 1
    });
    return true;
  }

  existing.count += 1;

  return existing.count <= RATE_MAX;
}

const server = http.createServer(
  async (req, res) => {
    const parsed = new URL(
      req.url,
      `http://${req.headers.host || "localhost"}`
    );

    const urlPath = parsed.pathname;

    if (!allowedRequest(req)) {
      return json(res, 429, {
        error: "rate_limit_exceeded"
      });
    }

if (
  req.method === "GET" &&
  urlPath === "/api/who-data"
) {
  try {
  
    const data = await fetchWHOIndicator(
      WHO_INDICATORS[0]
    );

    return json(res, 200, {
      engine: "GARDIEN-CORE-2.0",
      source:
        "Organisation mondiale de la Santé (OMS)",
      data,
      human_validation_required: true,
      external_action_taken: false
    });
  } catch (error) {
    return json(res, 502, {
      error: "who_data_unavailable",
      message: String(
        error.message || error
              )
      });
    }
  }
    if (
      req.method === "GET" &&
      urlPath === "/api/health"
    ) {
      return json(res, 200, {
        status: "ok",
        engine: "GARDIEN-CORE-2.0",
        real_data: true,
        human_control_required: true,
        external_action_taken: false,
        mode:
          process.env.OPENAI_API_KEY &&
          process.env.OPENAI_MODEL
            ? "ai"
            : "demo"
      });
    }

    if (
      req.method === "GET" &&
      urlPath === "/api/sources"
    ) {
      return json(res, 200, {
        engine: "GARDIEN-CORE-2.0",
        sources: DATA_SOURCES,
        human_validation_required: true,
        external_action_taken: false,
        note:
          "Les sources sont répertoriées séparément de leur intégration technique. Une source planifiée n'est pas encore utilisée pour produire des données."
      });
    }

    if (
      req.method === "GET" &&
      urlPath === "/api/nasa-data"
    ) {
      try {
        const data =
          await fetchNASAClimateData();

        return json(res, 200, {
          engine: "GARDIEN-CORE-2.0",
          source: "NASA GISS GISTEMP",
          data,
          human_validation_required: true,
          external_action_taken: false
        });
      } catch (error) {
        return json(res, 502, {
          error: "nasa_data_unavailable",
          message:
            String(error.message || error)
        });
      }
    }

    if (
      req.method === "GET" &&
      urlPath === "/api/real-data"
    ) {
      try {
        const data =
          await getRealData();

        return json(res, 200, data);
      } catch (error) {
        return json(res, 500, {
          error: "real_data_unavailable"
        });
      }
    }

    if (
      req.method === "GET" &&
      urlPath === "/api/history"
    ) {
      try {
        const indicatorId =
          parsed.searchParams.get(
            "indicator"
          );

        const indicator =
          WORLD_BANK_INDICATORS.find(
            item => item.id === indicatorId
          );

        if (!indicator) {
          return json(res, 400, {
            error: "indicator_not_allowed"
          });
        }

        const response =
          await fetch(
            "https://api.worldbank.org/v2/country/WLD/indicator/" +
            encodeURIComponent(indicator.code) +
            "?format=json&per_page=100",
            {
              headers: {
                Accept: "application/json",
                "User-Agent": "GARDIEN/2.0"
              }
            }
          );

        if (!response.ok) {
          throw new Error(
            "World Bank error"
          );
        }

        const data =
          await response.json();

        if (
          !Array.isArray(data) ||
          !Array.isArray(data[1])
        ) {
          throw new Error(
            "World Bank history invalid"
          );
        }

        const history =
          data[1]
            .filter(
              item =>
                item &&
                item.value !== null &&
                item.value !== undefined
            )
            .map(item => ({
              year: Number(item.date),
              value: Number(item.value)
            }))
            .sort(
              (a, b) => a.year - b.year
            );

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
    }

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

        return json(res, code, {
          error:
            code === 413
              ? "payload_too_large"
              : "server_error"
        });
      }
    }

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
          return json(res, 400, {
            error: "question_required"
          });
        }

        const question =
          payload.question
            .trim()
            .slice(0, MAX_QUESTION);

        const answer =
          await askAI(question);

        return json(res, 200, {
          answer
        });
      } catch (error) {
        console.error(
          "GARDIEN /api/ask:",
          error
        );

        return json(res, 500, {
          error: "server_error"
        });
      }
    }

    if (
      req.method !== "GET" &&
      req.method !== "HEAD"
    ) {
      return json(res, 405, {
        error: "method_not_allowed"
      });
    }

    const fileUrl =
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
      return json(res, 403, {
        error: "forbidden"
      });
    }

    fs.readFile(
      file,
      (err, data) => {
        if (err) {
          return json(res, 404, {
            error: "not_found"
          });
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

        res.writeHead(200, {
          "Content-Type":
            types[ext] ||
            "application/octet-stream",
          "Cache-Control":
            ext === ".html"
              ? "no-cache"
              : "public, max-age=3600"
        });

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
);// ============================================================
// OMS / WHO — INDICATEURS DE SANTÉ
// ============================================================

const WHO_INDICATORS = [
  {
    id: "who_life_expectancy",
    code: "WHOSIS_000001",
    name: "Espérance de vie à la naissance — OMS",
    unit: "années",
    direction: "higher_better",
    confidence: 0.95
  }
];

async function fetchWHOIndicator(indicator) {
  const url =
    "https://ghoapi.azureedge.net/api/" +
    encodeURIComponent(indicator.code) +
    "?$filter=SpatialDim%20eq%20%27GLOBAL%27";

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "GARDIEN/2.0"
    }
  });

  if (!response.ok) {
    throw new Error(
      `OMS ${indicator.code}: HTTP ${response.status}`
    );
  }

  const data = await response.json();

  if (!data || !Array.isArray(data.value)) {
    throw new Error(
      `Réponse OMS invalide pour ${indicator.code}`
    );
  }

  const observation = data.value
    .filter(item =>
      item &&
      Number.isFinite(Number(item.NumericValue))
    )
    .sort((a, b) =>
      Number(b.TimeDim || 0) -
      Number(a.TimeDim || 0)
    )[0];

  if (!observation) {
    throw new Error(
      `Aucune donnée OMS disponible pour ${indicator.code}`
    );
  }

  return {
    id: indicator.id,
    indicator: indicator.name,
    code: indicator.code,
    value: Number(observation.NumericValue),
    year: Number(observation.TimeDim),
    unit: indicator.unit,
    direction: indicator.direction,
    source: "Organisation mondiale de la Santé (OMS)",
    source_url: "https://www.who.int/data",
    confidence: indicator.confidence,
    uncertainty:
      "À interpréter selon la méthodologie OMS et la couverture disponible.",
    verified_at: new Date().toISOString()
  };
}