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
