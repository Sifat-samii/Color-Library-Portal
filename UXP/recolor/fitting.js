const { createCandidates, adjustRecipe } = require("./recipes");

async function fit(source, target, renderEvaluate, options = {}) {
  if (typeof renderEvaluate !== "function") throw new Error("A real rendered-output evaluator is required");
  const candidates = createCandidates(source, target, options);
  const budget = options.maxEvaluations == null ? 24 : options.maxEvaluations;
  const minimum = candidates.length + 1;
  if (!Number.isInteger(budget) || budget < minimum || budget > 100) throw new Error("Fitting budget must be between " + minimum + " and 100 evaluations");
  const check = () => {
    if (options.signal && options.signal.aborted) throw Object.assign(new Error("Recolor fitting cancelled"), { code: "CANCELLED" });
  };
  let best = null, evaluations = 0;
  const methodBest = new Map();
  const history = [];
  async function evaluate(recipe) {
    check();
    const quality = await renderEvaluate(recipe);
    check();
    evaluations += 1;
    history.push({ method: recipe.method, score: quality.score, status: quality.status });
    if (options.onProgress) options.onProgress({ evaluations, budget, method: recipe.method, quality });
    const acceptable = quality.available && Number.isFinite(quality.score) && quality.integrity && !quality.integrity.critical;
    if (!acceptable) return null;
    const result = { recipe, quality }, previous = methodBest.get(recipe.method);
    if (!previous || quality.score < previous.quality.score) methodBest.set(recipe.method, result);
    return result;
  }
  for (const candidate of candidates) {
    const result = await evaluate(candidate);
    if (result && (!best || result.quality.score < best.quality.score)) best = result;
  }
  if (!best) throw new Error("No native candidate passed rendered-output integrity checks; use manual correction");
  const stepsFor = recipe => {
    const steps = [["lightness", 6], ["chromaA", 4], ["chromaB", 4]];
    if (recipe.method === "D") steps.push(["gamma", 0.15]);
    if (options.refineAllCandidates && recipe.method === "B") steps.push(["hue", 12], ["saturation", 12]);
    return steps;
  };
  if (options.refineAllCandidates) {
    // Compare fitted methods, not only their starting estimates. Round-robin
    // coordinates prevent the first method consuming a small shared budget.
    const seeds = candidates.filter(candidate => methodBest.has(candidate.method));
    const longest = Math.max(...seeds.map(candidate => stepsFor(candidate).length));
    for (let coordinate = 0; coordinate < longest; coordinate++) {
      for (const candidate of seeds) {
        const step = stepsFor(candidate)[coordinate];
        if (!step) continue;
        for (const direction of [1, -1]) {
          if (evaluations >= budget - 1) break;
          const local = methodBest.get(candidate.method);
          const recipe = adjustRecipe(local.recipe, step[0], step[1] * direction);
          if (recipe.parameters[step[0]] === local.recipe.parameters[step[0]]) continue;
          const result = await evaluate(recipe);
          if (result && result.quality.score + 0.01 < best.quality.score) best = result;
        }
      }
    }
  }
  let scale = 1;
  // Deterministic coordinate search. Never equate a predicted color with a
  // successful Photoshop render. Reserve one evaluation to restore the best.
  while (evaluations < budget - 1 && best.quality.score > 0.25) {
    let improved = false;
    for (const [parameter, initialStep] of stepsFor(best.recipe)) {
      for (const direction of [1, -1]) {
        if (evaluations >= budget - 1) break;
        const recipe = adjustRecipe(best.recipe, parameter, initialStep * scale * direction);
        if (recipe.parameters[parameter] === best.recipe.parameters[parameter]) continue;
        const result = await evaluate(recipe);
        if (result && result.quality.score + 0.01 < best.quality.score) { best = result; improved = true; }
      }
    }
    if (!improved) scale /= 2;
    if (scale < 0.125) break;
  }
  const restored = await evaluate(best.recipe);
  if (!restored) throw new Error("Winning recipe failed verification when rendered again");
  return { ...restored, evaluations, history,
    comparison: candidates.map(candidate => {
      const fitted = methodBest.get(candidate.method);
      return { method: candidate.method, available: Boolean(fitted), score: fitted ? fitted.quality.score : null,
        anchorDeltaE00: fitted ? fitted.quality.anchorDeltaE00 : null };
    }), status: "EXPERIMENTAL_DESIGNER_REVIEW_REQUIRED" };
}

// Panel controls can share this queue without overlapping Photoshop edits.
// Pending requests coalesce; an in-flight transaction always finishes first.
function latestQueue(run) {
  let pending = null, running = false;
  async function drain() {
    if (running) return;
    running = true;
    while (pending) {
      const entry = pending; pending = null;
      try { entry.resolve(await run(entry.value)); } catch (error) { entry.reject(error); }
    }
    running = false;
  }
  return value => new Promise((resolve, reject) => {
    if (pending) pending.resolve({ superseded: true });
    pending = { value, resolve, reject };
    drain();
  });
}

module.exports = { fit, latestQueue };
