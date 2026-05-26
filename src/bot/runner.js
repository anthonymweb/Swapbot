const { loadOrInitState, saveState } = require('../state');
const { generateCandidatesFromFeatures, generateSyntheticFeatures } = require('../engine/candidateGenerator');
const { fetchMarketFeatures } = require('../engine/binance');

const TRADE_SYMBOLS = ['PEPEUSDT', 'WIFUSDT', 'DOGEUSDT', 'BONKUSDT', 'SHIBUSDT', 'ADAUSDT', 'SOLUSDT', 'MATICUSDT'];

async function runSingleScan({ reason = 'cron' } = {}) {
  const state = await loadOrInitState();

  const total = Number(state.totalUSDT || 0);
  if (total < Number(process.env.MIN_BALANCE_USDT || 3)) {
    state.topCandidates = [];
    state.portfolioHistory = state.portfolioHistory || [];
    state.portfolioHistory.push({ t: Date.now(), v: total });
    await saveState(state);
    return { reason, ok: true, skipped: 'min_balance_guard' };
  }

  const now = Date.now();

  let features;
  try {
    const useSymbols = (process.env.SCAN_SYMBOLS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (process.env.BINANCE_REAL === '1') {
      features = await fetchMarketFeatures({ symbols: useSymbols, limit: 50 });
    } else {
      features = generateSyntheticFeatures();
    }
  } catch (e) {
    features = generateSyntheticFeatures();
  }

  const candidates = generateCandidatesFromFeatures(features).slice(0, 10);

  state.topCandidates = candidates;
  state.portfolioHistory = state.portfolioHistory || [];
  state.portfolioHistory.push({ t: now, v: total });
  if (state.portfolioHistory.length > 200) state.portfolioHistory = state.portfolioHistory.slice(-200);

  // Simulate a trade every few scans
  if (!state.recentTrades) state.recentTrades = [];
  if (Math.random() > 0.6) {
    const side = Math.random() > 0.5 ? 'buy' : 'sell';
    const candidate = candidates[Math.floor(Math.random() * Math.min(candidates.length, 4))];
    if (candidate) {
      const engines = ['conservative', 'sniper'];
      const engine = engines[Math.floor(Math.random() * engines.length)];
      const price = Math.random() * (engine === 'conservative' ? 0.5 : 5);
      const amount = Math.floor(Math.random() * 5000000 + 100000);
      const trade = {
        type: side,
        symbol: candidate.symbol || TRADE_SYMBOLS[Math.floor(Math.random() * TRADE_SYMBOLS.length)],
        price: Number(price.toFixed(8)),
        amount,
        timestamp: now,
        engine,
        pnl: side === 'sell' ? Number((Math.random() - 0.35) * 25).toFixed(2) : null,
      };
      state.recentTrades.unshift(trade);
      if (state.recentTrades.length > 20) state.recentTrades = state.recentTrades.slice(0, 20);

      if (side === 'sell' && trade.pnl > 0) {
        if (engine === 'conservative') state.conservative.wins += 1;
        else state.sniper.wins += 1;
      } else if (side === 'sell' && trade.pnl <= 0) {
        if (engine === 'conservative') state.conservative.losses += 1;
        else state.sniper.losses += 1;
      }

      // Jitter total USDT
      const drift = (Math.random() - 0.48) * Number(trade.pnl || 2);
      state.totalUSDT = Math.max(0, total + drift);
      if (engine === 'conservative') state.conservative.usdt = Math.max(0, Number(state.conservative.usdt || 500) + drift * 0.6);
      else state.sniper.usdt = Math.max(0, Number(state.sniper.usdt || 300) + drift * 0.4);
    }
  } else {
    const drift = (Math.random() - 0.48) * 12;
    state.totalUSDT = Math.max(0, total + drift);
  }

  await saveState(state);

  return {
    reason,
    ok: true,
    topCandidates: candidates,
    totalUSDT: state.totalUSDT,
  };
}

async function runLoop() {
  const intervalMs = Number(process.env.SCAN_INTERVAL_MS || 30000);
  while (true) {
    await runSingleScan({ reason: 'loop' });
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

module.exports = { runSingleScan, runLoop };

if (require.main === module) {
  const args = process.argv.slice(2);
  const single = args.includes('--single-scan');
  const loop = args.includes('--loop');

  if (single) {
    runSingleScan({ reason: 'cli_single' })
      .then((r) => {
        console.log(JSON.stringify(r, null, 2));
        process.exit(0);
      })
      .catch((e) => {
        console.error(e);
        process.exit(1);
      });
  } else if (loop) {
    runLoop().catch((e) => {
      console.error(e);
      process.exit(1);
    });
  } else {
    console.error('Usage: node bot/runner.js --single-scan | --loop');
    process.exit(1);
  }
}
