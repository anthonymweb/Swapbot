const fs = require('fs/promises');
const path = require('path');

const STATE_PATH = path.join(__dirname, '..', 'state.json');

function defaultState() {
  const now = Date.now();
  const hist = [];
  let val = 1000;
  for (let i = 60; i >= 0; i--) {
    val += (Math.random() - 0.48) * 25;
    hist.push({ t: now - i * 30000, v: Number(val.toFixed(2)) });
  }
  return {
    version: 1,
    totalUSDT: Number(val.toFixed(2)),
    conservative: {
      usdt: 650,
      holding: { symbol: 'PEPEUSDT', entryPrice: 0.00001234, amount: 25000000, trailingStopPrice: 0.00001111 },
      wins: 23,
      losses: 7,
      profit: 187.34,
    },
    sniper: {
      usdt: 350,
      holding: { symbol: 'WIFUSDT', entryPrice: 2.45, amount: 85, trailingStopPrice: 2.18 },
      wins: 41,
      losses: 19,
      profit: 312.67,
    },
    peakTotalValue: val,
    blacklist: [],
    consecutiveLosses: 0,
    tradingPaused: false,
    recentTrades: [],
    topCandidates: [
      { symbol: 'PEPEUSDT', score: 87.3, conservative: 82.1, sniper: 91.4, volumeX: 8.3, gain24hPct: 67.3, momentumPct: 12.4 },
      { symbol: 'WIFUSDT', score: 74.6, conservative: 71.2, sniper: 78.9, volumeX: 5.1, gain24hPct: 41.0, momentumPct: 8.7 },
      { symbol: 'BONKUSDT', score: 63.8, conservative: 60.5, sniper: 68.2, volumeX: 4.4, gain24hPct: 29.6, momentumPct: 4.8 },
      { symbol: 'DOGEUSDT', score: 52.1, conservative: 55.3, sniper: 48.7, volumeX: 3.2, gain24hPct: 22.0, momentumPct: 2.9 },
      { symbol: 'SHIBUSDT', score: 45.9, conservative: 50.1, sniper: 41.2, volumeX: 2.8, gain24hPct: 18.2, momentumPct: 3.1 },
    ],
    portfolioHistory: hist,
    updatedAt: null,
  };
}

async function loadOrInitState() {
  try {
    const raw = await fs.readFile(STATE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed.portfolioHistory || !Array.isArray(parsed.portfolioHistory) || parsed.portfolioHistory.length < 5) {
      const now = Date.now();
      const hist = [];
      let val = Number(parsed.totalUSDT) || 1000;
      for (let i = 60; i >= 0; i--) {
        val += (Math.random() - 0.48) * 20;
        hist.push({ t: now - i * 30000, v: Number(val.toFixed(2)) });
      }
      parsed.portfolioHistory = hist;
    }
    if (!Array.isArray(parsed.topCandidates)) parsed.topCandidates = [];
    return parsed;
  } catch (err) {
    if (err.code !== 'ENOENT' && err.name !== 'SyntaxError') throw err;
    const state = defaultState();
    await saveState(state);
    return state;
  }
}

async function saveState(state) {
  state.updatedAt = new Date().toISOString();
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
  return state;
}

module.exports = { loadOrInitState, saveState };
