const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();

const { loadOrInitState, saveState } = require('./src/state');

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

const PORT = Number(process.env.PORT || 3000);

let sseClients = [];

app.use(express.static(path.join(__dirname, 'public')));
app.use('/public', express.static(path.join(__dirname, 'public')));

async function broadcastState() {
  try {
    const state = await loadOrInitState();
    const payload = JSON.stringify({ updatedAt: new Date().toISOString(), state });
    sseClients.forEach(res => res.write(`data: ${payload}\n\n`));
  } catch (_) {}
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), clients: sseClients.length });
});

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
  sseClients.push(res);
  req.on('close', () => {
    sseClients = sseClients.filter(c => c !== res);
  });
});

app.get('/api/snapshot', async (req, res) => {
  try {
    const state = await loadOrInitState();
    res.json({ updatedAt: new Date().toISOString(), state });
  } catch (err) {
    res.status(500).json({ error: 'snapshot_failed', message: err.message });
  }
});

app.post('/api/scan/single', async (req, res) => {
  try {
    const { runSingleScan } = require('./src/bot/runner');
    const result = await runSingleScan({ reason: 'manual' });
    await broadcastState();
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/magic/flicker', async (req, res) => {
  try {
    const state = await loadOrInitState();
    const drift = (Math.random() - 0.5) * 30;
    const pnlDrift = (Math.random() - 0.5) * 6;
    state.totalUSDT = Math.max(0, Number(state.totalUSDT || 1000) + drift);
    if (state.conservative) {
      state.conservative.usdt = Math.max(0, Number(state.conservative.usdt || 500) + drift * 0.6);
      if (Math.random() > 0.7) state.conservative.wins += 1;
    }
    if (state.sniper) {
      state.sniper.usdt = Math.max(0, Number(state.sniper.usdt || 300) + drift * 0.4);
      if (Math.random() > 0.65) state.sniper.wins += 1;
      if (Math.random() > 0.85) state.sniper.losses += 1;
    }
    state.portfolioHistory = state.portfolioHistory || [];
    state.portfolioHistory.push({ t: Date.now(), v: Number(state.totalUSDT.toFixed(2)) });
    if (state.portfolioHistory.length > 200) state.portfolioHistory = state.portfolioHistory.slice(-200);
    state.topCandidates = (state.topCandidates || []).map(c => ({
      ...c,
      score: Math.min(100, Math.max(10, (c.score || 50) + (Math.random() - 0.5) * 12)),
      gain24hPct: Math.min(200, Math.max(-50, (c.gain24hPct || 20) + (Math.random() - 0.5) * 10)),
      volumeX: Math.max(0.5, (c.volumeX || 3) + (Math.random() - 0.5) * 2),
    }));
    await saveState(state);
    await broadcastState();
    res.json({ ok: true, totalUSDT: state.totalUSDT });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

const server = app.listen(PORT, () => {
  console.log(`[swapbot] API listening on port ${PORT}`);

  const { runLoop } = require('./src/bot/runner');
  runLoop().catch(() => {});
  console.log('[swapbot] Background scan loop started (30s interval)');
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`[swapbot] Port ${PORT} is already in use (EADDRINUSE).`);
    console.error(`[swapbot] Stop the existing process or set a different PORT.`);
    console.error(`[swapbot] Example: lsof -ti :${PORT} | xargs kill -9`);
  } else {
    console.error('[swapbot] Server failed to start:', err);
  }
  process.exit(1);
});
