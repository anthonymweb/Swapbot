const { loadOrInitState, saveState } = require('../state');
const { generateCandidatesFromFeatures, generateSyntheticFeatures } = require('../engine/candidateGenerator');
const { fetchMarketFeatures } = require('../engine/binance');

async function runSingleScan({ reason = 'cron' } = {}) {
  const state = await loadOrInitState();

  // Safety guard: minimum balance
  const total = Number(state.totalUSDT || 0);
  if (total < Number(process.env.MIN_BALANCE_USDT || 3)) {
    state.topCandidates = [];
    state.portfolioHistory = state.portfolioHistory || [];
    state.portfolioHistory.push({ t: Date.now(), v: total });
    await saveState(state);
    return { reason, ok: true, skipped: 'min_balance_guard' };
  }

  const now = Date.now();

  // Features -> candidates -> scoring (offline by default; BINANCE_REAL can be enabled later)
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
    // Keep scan operational even if the feature adapter fails
    features = generateSyntheticFeatures();
  }

  const candidates = generateCandidatesFromFeatures(features).slice(0, 10);

  state.topCandidates = candidates;
  state.portfolioHistory = state.portfolioHistory || [];
  state.portfolioHistory.push({ t: now, v: total });

  const tradingPaused = Boolean(state.tradingPaused);

  // Mark update only; real trade execution engine will be implemented next.
  await saveState(state);

  return {
    reason,
    ok: true,
    skipped: tradingPaused ? 'trading_paused' : 'engine_not_implemented',
    topCandidates: candidates,
  };
}

async function runLoop() {
  const intervalMs = Number(process.env.SCAN_INTERVAL_MS || 30000);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await runSingleScan({ reason: 'loop' });
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

module.exports = { runSingleScan };

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

