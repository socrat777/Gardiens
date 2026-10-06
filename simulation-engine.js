const MODEL_VERSION = "GARDIEN-SIM-1.0";

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function simulateScenario({
  name,
  baseline = {},
  assumptions = {}
} = {}) {
  const population = numberOrNull(baseline.population);
  const co2 = numberOrNull(baseline.co2_per_capita);
  const renewable = numberOrNull(
    baseline.renewable_energy
  );
  const lifeExpectancy = numberOrNull(
    baseline.life_expectancy
  );
  const poverty = numberOrNull(
    baseline.poverty
  );

  const co2Reduction = numberOrNull(
    assumptions.co2_reduction_pct
  );
  const renewableDelta = numberOrNull(
    assumptions.renewable_delta_pp
  );
  const lifeExpectancyDelta = numberOrNull(
    assumptions.life_expectancy_delta_years
  );
  const povertyDelta = numberOrNull(
    assumptions.poverty_delta_pct
  );

  const estimates = {
    population,

    co2_per_capita:
      co2 !== null && co2Reduction !== null
        ? Number(
            (
              co2 *
              (1 - co2Reduction / 100)
            ).toFixed(4)
          )
        : null,

    renewable_energy:
      renewable !== null &&
      renewableDelta !== null
        ? Number(
            (
              renewable +
              renewableDelta
            ).toFixed(4)
          )
        : null,

    life_expectancy:
      lifeExpectancy !== null &&
      lifeExpectancyDelta !== null
        ? Number(
            (
              lifeExpectancy +
              lifeExpectancyDelta
            ).toFixed(3)
          )
        : null,

    poverty:
      poverty !== null &&
      povertyDelta !== null
        ? Number(
            (
              poverty +
              povertyDelta
            ).toFixed(3)
          )
        : null
  };

  return {
    model: MODEL_VERSION,
    scenario:
      name || "scénario_sans_nom",

    estimates,

    assumptions,

    data_status: {
      population:
        population !== null
          ? "available"
          : "missing",

      co2_per_capita:
        co2 !== null
          ? "available"
          : "missing",

      renewable_energy:
        renewable !== null
          ? "available"
          : "missing",

      life_expectancy:
        lifeExpectancy !== null
          ? "available"
          : "missing",

      poverty:
        poverty !== null
          ? "available"
          : "missing"
    },

    limitations: [
      "Modèle déterministe de première génération.",
      "Les paramètres d'impact sont des hypothèses et non des relations causales validées.",
      "Aucune projection ne doit être présentée comme une observation réelle.",
      "Les résultats numériques doivent être accompagnés de leurs données d'entrée et de leurs hypothèses."
    ]
  };
}

function simulate(scenarios = []) {
  if (!Array.isArray(scenarios)) {
    throw new TypeError(
      "scenarios doit être un tableau"
    );
  }

  return {
    model: MODEL_VERSION,
    scenario_count: scenarios.length,
    results: scenarios.map(
      simulateScenario
    )
  };
}

module.exports = {
  MODEL_VERSION,
  simulateScenario,
  simulate
};