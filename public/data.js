/* =========================================
   GARDIEN — DONNÉES PUBLIQUES
   ========================================= */

const GARDIEN_DATA = {
  source: "World Bank Open Data",
  source_url: "https://data.worldbank.org/",
  updated: null,
  indicators: []
};

async function loadGardienData() {
  try {
    const response = await fetch("/api/real-data", {
      method: "GET",
      headers: {
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error("Données indisponibles");
    }

    const data = await response.json();

    GARDIEN_DATA.updated = data.updated || null;
    GARDIEN_DATA.indicators = Array.isArray(data.indicators)
      ? data.indicators
      : [];

    return GARDIEN_DATA;

  } catch (error) {
    console.error("GARDIEN data:", error);

    return {
      ...GARDIEN_DATA,
      error: "Impossible de charger les données publiques."
    };
  }
}

window.GARDIEN_DATA = GARDIEN_DATA;
window.loadGardienData = loadGardienData;