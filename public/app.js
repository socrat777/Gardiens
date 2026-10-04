const question = document.getElementById("question");
const button = document.getElementById("askButton");
const result = document.getElementById("result");

button.addEventListener("click", async () => {
  const text = question.value.trim();

  if (!text) {
    result.textContent = "Décris d'abord le problème à analyser.";
    return;
  }

  button.disabled = true;
  result.textContent = "GARDIEN analyse la question…";

  try {
    const response = await fetch("/api/ask", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        question: text
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Erreur serveur");
    }

    result.textContent = data.answer || "Aucune réponse disponible.";
  } catch (error) {
    result.textContent =
      "Impossible d'obtenir une réponse pour le moment.";
  } finally {
    button.disabled = false;
  }
});
async function loadRealData() {
  const status = document.getElementById("realDataStatus");
  const list = document.getElementById("realDataList");

  if (!status || !list) return;

  try {
    status.textContent = "Chargement des données réelles…";

    const response = await fetch("/api/real-data");

    if (!response.ok) {
      throw new Error("Données indisponibles");
    }

    const data = await response.json();

    list.innerHTML = "";

    if (!Array.isArray(data.indicators) || data.indicators.length === 0) {
      status.textContent = "Aucune donnée disponible.";
      return;
    }

    data.indicators.forEach(item => {
      const card = document.createElement("div");
      card.className = "data-card";

      const value =
        typeof item.value === "number"
          ? item.value.toLocaleString("fr-CA", {
              maximumFractionDigits: 2
            })
          : item.value;

  card.innerHTML = `
  <h3>${item.indicator}</h3>

  <p class="data-value">${value} ${item.unit || ""}</p>

  <p>📅 Année : ${item.year || "—"}</p>

  <p>📊 Confiance : ${Math.round((item.confidence || 0) * 100)} %</p>

  <p>📈 Historique : ${
    Array.isArray(item.history)
      ? item.history.length + " années disponibles"
      : "données historiques non disponibles"
  }</p>

  <p>🔎 Source : ${item.source || "—"}</p>

  <p class="data-method">
    Donnée publique vérifiable
  </p>
`;

      list.appendChild(card);
    });

    status.textContent =
      data.status === "complete"
        ? "Données réelles chargées."
        : "Données partiellement disponibles.";

  } catch (error) {
    console.error("GARDIEN real data:", error);
    status.textContent =
      "Impossible de charger les données réelles.";
  }
}

loadRealData();async function updateRiskSummary() {
  const summary = document.getElementById("riskSummary");
  if (!summary) return;

  try {
    const response = await fetch("/api/real-data");
    if (!response.ok) throw new Error("Données indisponibles");

    const data = await response.json();
    const indicators = Array.isArray(data.indicators)
      ? data.indicators
      : [];

    if (!indicators.length) {
      summary.textContent =
        "Aucune donnée suffisante pour établir une évaluation.";
      return;
    }

    const valid = indicators.filter(
      item => Number.isFinite(Number(item.value))
    );

    if (!valid.length) {
      summary.textContent =
        "Les données disponibles ne permettent pas encore une évaluation.";
      return;
    }

    const averageConfidence =
      valid.reduce(
        (sum, item) => sum + (Number(item.confidence) || 0),
        0
      ) / valid.length;

    let level = "modéré";

    if (averageConfidence >= 90) {
      level = "évaluation fondée sur des données relativement robustes";
    } else if (averageConfidence < 75) {
      level = "évaluation à interpréter avec prudence";
    }

    summary.innerHTML =
      `<strong>État actuel :</strong> ${level}.<br>` +
      `${valid.length} indicateurs analysés. ` +
      `Confiance moyenne des données : ` +
      `${Math.round(averageConfidence)} %.<br><br>` +
      `<small>Cette évaluation est préliminaire et ne constitue pas une prédiction. ` +
      `La décision finale reste humaine.</small>`;

  } catch (error) {
    summary.textContent =
      "Impossible de calculer l'évaluation pour le moment.";
  }
}

updateRiskSummary();