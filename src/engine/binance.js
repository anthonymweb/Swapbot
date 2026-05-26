/**
 * Binance adapter (stubbed for v0 scaffolding).
 *
 * Goals:
 * - Provide a stable interface for later integration
 * - Keep local dev/test fully offline by default
 *
 * If BINANCE_REAL=1 and env vars are present, this could be extended to call real APIs.
 */
const axios = require('axios');

async function fetchMarketFeatures({ symbols = [], limit = 100 } = {}) {
  // Offline by default: return synthetic features for given symbols (or a small default set).
  const defaultSymbols = ['PEPEUSDT', 'WIFUSDT', 'DOGEUSDT', 'BONKUSDT', 'SHIBUSDT'];
  const useSymbols = symbols.length ? symbols : defaultSymbols;

  if (process.env.BINANCE_REAL !== '1') {
    return useSymbols.map((symbol, idx) => {
      // Deterministic-ish mapping from index/symbol length (keeps tests stable)
      const gain24hPct = 10 + (idx + 1) * 11.1; // 21.1, 32.2, ...
      const volumeX = 2 + (idx + 2) * 2.05;
      const momentumPct = 2 + (idx + 1) * 2.3;

      return { symbol, gain24hPct, volumeX, momentumPct };
    });
  }

  // Real call placeholder (intentionally not implemented for safety).
  // Keep structure ready for future.
  if (!process.env.BINANCE_BASE_URL) {
    throw new Error('BINANCE_REAL=1 but BINANCE_BASE_URL is not set');
  }

  // Example endpoint (not guaranteed):
  const base = process.env.BINANCE_BASE_URL.replace(/\/$/, '');
  const results = [];

  for (const symbol of useSymbols) {
    // TODO: Replace with correct kline/ticker endpoints and feature extraction.
    const url = `${base}/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`;
    const { data } = await axios.get(url, { timeout: 10_000 });
    const gain24hPct = Number(data.priceChangePercent || 0);
    const volumeX = Number(data.quoteVolume || 0) / 100000; // normalized placeholder
    const momentumPct = gain24hPct * 0.35;

    results.push({ symbol, gain24hPct, volumeX, momentumPct });
  }

  return results.slice(0, limit);
}

module.exports = {
  fetchMarketFeatures,
};
