const question = document.getElementById("question");
const button = document.getElementById("askButton");
const result = document.getElementById("result");

const REFRESH_MS = 5 * 60 * 1000;

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function createLiveStatus() {
  if (document.getElementById("gardienLiveStatus")) return;

  const box = document.createElement("div");
  box.id = "gardienLiveStatus";
  box.style.cssText =
    "margin:20px 0;padding:15px;border-radius:12px;" +
    "background:#10251d;color:#fff;font-family:system-ui;" +
    "border:1px solid rgba(255,255,255,.15)";

  box.innerHTML = `
    <strong>🟢 GARDIEN — surveillance des données</strong>
    <div id="gardienLiveText" style="margin-top:6px">
      Initialisation…
    </div>
  `;

  document.body.prepend(box);
}

function setLiveStatus(text, state = "ok") {
  createLiveStatus();

  const element = document.getElementById("gardienLiveText");
  if (!element) return;

  const icons = {
    ok: "🟢",
    warning: "🟠",
    error: "🔴",
    loading: "🔄"
  };

  element.textContent = `${icons[state] || "ℹ️"} ${text}`;
}

async function getRealData() {
  const response = await fetch("https://gardien-1.onrender.com/api/ask", {
    method: "GET",
    headers: {
      Accept: "application/json"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error("Données indisponibles");
  }

  return response.json();
}

async function loadRealData() {
  const status = document.getElementById("realDataStatus");
  const list = document.getElementById("realDataList");

  createLiveStatus();
  setLiveStatus("Vérification des données…", "loading");

  try {
    const data = await getRealData();

    if (status) {
      status.textContent =
        data.status === "complete"
          ? "Données réelles chargées."
          : "Données partiellement disponibles.";
    }

    if (!list) return;

    list.innerHTML = "";

    const indicators = Array.isArray(data.indicators)
      ? data.indicators
      : [];

    if (!indicators.length) {
      setLiveStatus("Aucune donnée disponible.", "error");
      return;
    }

    indicators.forEach(item => {
      const card = document.createElement("div");
      card.className = "data-card";

      const value =
        typeof item.value === "number"
          ? item.value.toLocaleString("fr-CA", {
              maximumFractionDigits: 2
            })
          : item.value ?? "—";

      const confidence = Math.round(
        (Number(item.confidence) || 0) * 100
      );

      const history = Array.isArray(item.history)
        ? `${item.history.length} années disponibles`
        : "non disponible";

      card.innerHTML = `
        <h3>${escapeHTML(item.indicator)}</h3>

        <p class="data-value">
          ${escapeHTML(value)} ${escapeHTML(item.unit || "")}
        </p>

        <p>📅 Année : ${escapeHTML(item.year || "—")}</p>

        <p>📊 Confiance : ${confidence} %</p>

        <p>📈 Historique : ${escapeHTML(history)}</p>

        <p>🔎 Source : ${escapeHTML(item.source || "—")}</p>

        <p class="data-method">
          Donnée publique vérifiable
        </p>
      `;

      list.appendChild(card);
    });

    const now = new Date();

    const time = now.toLocaleTimeString("fr-CA", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });

    const sourceStatus =
      data.status === "complete"
        ? "toutes les données disponibles"
        : "certaines sources sont indisponibles";

    setLiveStatus(
      `Dernière vérification : ${time} — ${indicators.length} indicateurs — ${sourceStatus}. Prochaine vérification dans 5 minutes.`,
      data.status === "complete" ? "ok" : "warning"
    );

  } catch (error) {
    console.error("GARDIEN real data:", error);

    setLiveStatus(
      "Impossible de récupérer les données. GARDIEN conserve son état de sécurité.",
      "error"
    );

    if (status) {
      status.textContent =
        "Impossible de charger les données réelles.";
    }
  }
}

async function updateRiskSummary() {
  const summary = document.getElementById("riskSummary");
  if (!summary) return;

  try {
    const data = await getRealData();

    const indicators = Array.isArray(data.indicators)
      ? data.indicators
      : [];

    const valid = indicators.filter(
      item => Number.isFinite(Number(item.value))
    );

    if (!valid.length) {
      summary.textContent =
        "Aucune donnée suffisante pour établir une évaluation.";
      return;
    }

    const averageConfidence =
      valid.reduce(
        (sum, item) => sum + (Number(item.confidence) || 0),
        0
      ) / valid.length;

    let level = "modéré";

    if (averageConfidence >= 0.90) {
      level =
        "données relativement robustes";
    } else if (averageConfidence < 0.75) {
      level =
        "interprétation prudente nécessaire";
    }

    summary.innerHTML =
      `<strong>État des données :</strong> ${level}.<br>` +
      `${valid.length} indicateurs analysés.<br>` +
      `Confiance moyenne : ${Math.round(
        averageConfidence * 100
      )} %.<br><br>` +
      `<small>Cette évaluation est préliminaire. ` +
      `Elle ne constitue pas une prédiction. ` +
      `La décision finale reste humaine.</small>`;

  } catch (error) {
    summary.textContent =
      "Impossible de calculer l'évaluation pour le moment.";
  }
}

if (button && question && result) {
  button.addEventListener("click", async () => {
    const text = question.value.trim();

    if (!text) {
      result.textContent =
        "Décris d'abord le problème à analyser.";
      return;
    }

    button.disabled = true;
    result.textContent =
      "GARDIEN analyse la question…";

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
        throw new Error(
          data.error || "Erreur serveur"
        );
      }

      result.textContent =
        data.answer ||
        "Aucune réponse disponible.";

    } catch (error) {
      result.textContent =
        "Impossible d'obtenir une réponse pour le moment.";
    } finally {
      button.disabled = false;
    }
  });
}

createLiveStatus();

loadRealData();
updateRiskSummary();

setInterval(async () => {
  await loadRealData();
  await updateRiskSummary();
}, REFRESH_MS);