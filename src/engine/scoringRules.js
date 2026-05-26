/**
 * Dual-engine scoring placeholder.
 * In v0 we keep it deterministic and fully offline.
 * Later: engine A/B will consume market features and output normalized scores.
 */

function normalizeScore(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  // Clamp to [0, 100]
  return Math.max(0, Math.min(100, x));
}

function engineConservative({ gain24hPct, volumeX, momentumPct }) {
  // Favor steadier momentum, moderate gain, and volume presence.
  const score =
    0.45 * normalizeScore(gain24hPct) +
    0.35 * normalizeScore(volumeX * 10) +
    0.20 * normalizeScore(momentumPct * 4);
  return score;
}

function engineSniper({ gain24hPct, volumeX, momentumPct }) {
  // Favor high momentum and strong gain, penalize low volume.
  const score =
    0.60 * normalizeScore(gain24hPct) +
    0.25 * normalizeScore(momentumPct * 6) +
    0.15 * normalizeScore(volumeX * 12);
  return score;
}

function dualEngineScore(features) {
  const conservative = engineConservative(features);
  const sniper = engineSniper(features);

  // Combined score: weighted blend, then clamp
  const combined = normalizeScore(0.55 * conservative + 0.45 * sniper);

  return {
    conservative: normalizeScore(conservative),
    sniper: normalizeScore(sniper),
    combined,
  };
}

module.exports = {
  dualEngineScore,
};
