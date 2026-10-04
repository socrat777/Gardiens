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
        <p>Année : ${item.year || "—"}</p>
        <p>Confiance : ${Math.round((item.confidence || 0) * 100)} %</p>
        <p>Source : ${item.source || "—"}</p>
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

loadRealData();