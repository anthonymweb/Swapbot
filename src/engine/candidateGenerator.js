const { dualEngineScore } = require('./scoringRules');

/**
 * Candidate generation stub:
 * - Accepts a list of "market features" (offline / mocked for now)
 * - Outputs scored candidates
 */
function generateCandidatesFromFeatures(features = []) {
  const scored = features.map((f) => {
    const { conservative, sniper, combined } = dualEngineScore(f);
    return {
      symbol: f.symbol,
      score: Number(combined.toFixed(2)),
      conservative: Number(conservative.toFixed(2)),
      sniper: Number(sniper.toFixed(2)),
      volumeX: f.volumeX,
      gain24hPct: f.gain24hPct,
      momentumPct: f.momentumPct,
    };
  });

  return scored.sort((a, b) => b.score - a.score);
}

/**
 * For v0 scaffold we generate synthetic features. Later:
 * - use Binance adapter output
 * - compute features from candles/tickers
 */
function generateSyntheticFeatures() {
  const now = Date.now();

  return [
    { symbol: 'PEPEUSDT', gain24hPct: 67.3, volumeX: 8.3, momentumPct: 12.4, _t: now },
    { symbol: 'WIFUSDT', gain24hPct: 41.0, volumeX: 5.1, momentumPct: 8.7, _t: now },
    { symbol: 'DOGEUSDT', gain24hPct: 22.0, volumeX: 3.2, momentumPct: 2.9, _t: now },
    { symbol: 'BONKUSDT', gain24hPct: 29.6, volumeX: 4.4, momentumPct: 4.8, _t: now },
    { symbol: 'SHIBUSDT', gain24hPct: 18.2, volumeX: 2.8, momentumPct: 3.1, _t: now },
  ];
}

module.exports = {
  generateCandidatesFromFeatures,
  generateSyntheticFeatures,
};
