/**
 * ╔══════════════════════════════════════════════════════╗
 * ║   SWAPBOT DUAL ENGINE v2.0                          ║
 * ║   Conservative + Sniper + Telegram Mini App         ║
 * ╚══════════════════════════════════════════════════════╝
 *
 * SETUP:
 *   1. npm install
 *   2. Fill in .env file
 *   3. node bot.js              ← runs continuously
 *   3. node bot.js --single-scan ← one scan (GitHub Actions)
 */

require('dotenv').config();
const axios   = require('axios');
const crypto  = require('crypto');
const fs      = require('fs');
const path    = require('path');
const express = require('express');
const cors    = require('cors');

// ── CONFIG ───────────────────────────────────────────────
const CFG = {
  TESTNET:        process.env.TESTNET !== 'false',
  API_KEY:        process.env.API_KEY    || '',
  API_SECRET:     process.env.API_SECRET || '',
  TG_TOKEN:       process.env.TELEGRAM_BOT_TOKEN || '',
  TG_CHANNEL:     process.env.TELEGRAM_CHANNEL_ID || '',
  SIGNALS_ON:     process.env.SIGNALS_ENABLED !== 'false',
  GITHUB_USER:    process.env.GITHUB_USERNAME || 'your-username',
  GITHUB_REPO:    process.env.GITHUB_REPO || 'swapbot',

  CONS_RATIO:     parseFloat(process.env.CONSERVATIVE_RATIO  || '0.80'),
  SNIP_RATIO:     parseFloat(process.env.SNIPER_RATIO        || '0.20'),
  CONS_TRADE:     parseFloat(process.env.CONSERVATIVE_TRADE_SIZE || '0.25'),
  SNIP_TRADE:     parseFloat(process.env.SNIPER_TRADE_SIZE   || '0.50'),
  TRAILING_STOP:  parseFloat(process.env.TRAILING_STOP       || '0.10'),
  CONS_SL:        parseFloat(process.env.CONSERVATIVE_STOP_LOSS    || '0.05'),
  CONS_TP:        parseFloat(process.env.CONSERVATIVE_TAKE_PROFIT  || '0.08'),
  SNIP_PARTIAL:   parseFloat(process.env.SNIPER_PARTIAL_PROFIT || '1.00'),
  SNIP_FULL:      parseFloat(process.env.SNIPER_FULL_PROFIT   || '3.00'),
  DRAWDOWN:       parseFloat(process.env.DRAWDOWN_LIMIT       || '0.15'),
  CONS_INTERVAL:  parseInt(process.env.SCAN_INTERVAL_CONSERVATIVE || '60'),
  SNIP_INTERVAL:  parseInt(process.env.SCAN_INTERVAL_SNIPER   || '30'),
  MIN_SCORE:      parseInt(process.env.MIN_SNIPER_SCORE       || '70'),
  MIN_VOL_MULT:   parseFloat(process.env.MIN_VOLUME_MULTIPLIER || '3'),
  MIN_ORDER:      5.5,
  FEE:            0.001,

  CONS_WATCHLIST: [
    'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','ADAUSDT',
    'AVAXUSDT','POLUSDT','DOGEUSDT','LINKUSDT','DOTUSDT'
  ],
  STABLE_EXCLUDE: ['USDCUSDT','BUSDUSDT','TUSDUSDT','FDUSDUSDT','USDTUSDT'],
};

const BASE = CFG.TESTNET
  ? 'https://testnet.binance.vision'
  : 'https://api.binance.com';

// ── STATE ────────────────────────────────────────────────
const STATE_FILE  = path.join(__dirname, 'state.json');
const TRADES_FILE = path.join(__dirname, 'trades.log');
const DATA_FILE   = path.join(__dirname, 'public', 'data.json');

let STATE = {
  totalUSDT:    0,
  conservative: { usdt:0, holding:null, wins:0, losses:0, profit:0 },
  sniper:       { usdt:0, holding:null, wins:0, losses:0, profit:0 },
  peakTotalValue: 0,
  blacklist:    [],
  blacklistExpiry: {},
  consecutiveLosses: 0,
  tradingPaused: false,
  pauseUntil:   null,
  lastRebalance: null,
  lastScan:     null,
  startTime:    Date.now(),
  recentTrades: [],
  topCandidates:[],
  portfolioHistory: [],
  sentSignals:  {},
};

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      STATE = { ...STATE, ...saved };
      log('📂 Restored state from state.json', 'INFO');
    }
  } catch(e) { log('Could not load state: ' + e.message, 'WARN'); }
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(STATE, null, 2));
  } catch(e) { log('Could not save state: ' + e.message, 'WARN'); }
}

// ── LOGGING ──────────────────────────────────────────────
function log(msg, level='INFO') {
  const t = new Date().toLocaleTimeString('en-GB');
  const icons = { INFO:'ℹ️ ', BUY:'🟢', SELL:'🔴', WARN:'⚠️ ', ERR:'💀', WAIT:'⏳', WIN:'🏆' };
  const line = `[${t}] ${icons[level]||''}  ${msg}`;
  console.log(line);
  try { fs.appendFileSync(TRADES_FILE, line + '\n'); } catch(e) {}
}

function tradeLog(entry) {
  STATE.recentTrades.unshift(entry);
  if (STATE.recentTrades.length > 50) STATE.recentTrades.pop();
}

// ── BINANCE API ──────────────────────────────────────────
function sign(params) {
  const qs = new URLSearchParams(params).toString();
  return crypto.createHmac('sha256', CFG.API_SECRET).update(qs).digest('hex');
}

async function bGet(path, params={}, pub=false) {
  if (!pub) {
    params.timestamp  = Date.now();
    params.recvWindow = 60000;
    params.signature  = sign(params);
  }
  const qs  = new URLSearchParams(params).toString();
  const url = `${BASE}${path}${qs ? '?'+qs : ''}`;
  const headers = pub ? {} : { 'X-MBX-APIKEY': CFG.API_KEY };
  const res = await axios.get(url, { headers });
  return res.data;
}

async function bPost(path, params={}) {
  params.timestamp  = Date.now();
  params.recvWindow = 60000;
  params.signature  = sign(params);
  const res = await axios.post(`${BASE}${path}`, null, {
    params,
    headers: { 'X-MBX-APIKEY': CFG.API_KEY }
  });
  return res.data;
}

async function getKlines(symbol, interval='15m', limit=30) {
  const data = await bGet('/api/v3/klines', { symbol, interval, limit }, true);
  return data.map(k => ({
    open:  parseFloat(k[1]),
    high:  parseFloat(k[2]),
    low:   parseFloat(k[3]),
    close: parseFloat(k[4]),
    vol:   parseFloat(k[5]),
  }));
}

async function getTicker(symbol) {
  const d = await bGet('/api/v3/ticker/price', { symbol }, true);
  return parseFloat(d.price);
}

async function getAll24hr() {
  return await bGet('/api/v3/ticker/24hr', {}, true);
}

async function getUSDTBalance() {
  const d = await bGet('/api/v3/account', {});
  const u = d.balances.find(b => b.asset === 'USDT');
  return u ? parseFloat(u.free) : 0;
}

async function getLotSize(symbol) {
  const d = await bGet('/api/v3/exchangeInfo', { symbol }, true);
  const lot = d.symbols[0].filters.find(f => f.filterType === 'LOT_SIZE');
  return parseFloat(lot.stepSize);
}

function floorStep(qty, step) {
  if (step === 0) return qty;
  const precision = Math.round(-Math.log10(step));
  return parseFloat((Math.floor(qty / step) * step).toFixed(precision));
}

// ── INDICATORS ───────────────────────────────────────────
function calcRSI(candles, period=14) {
  const closes = candles.map(c => c.close);
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i-1];
    if (d > 0) gains += d; else losses += Math.abs(d);
  }
  const avg_g = gains / period;
  const avg_l = losses / period;
  if (avg_l === 0) return 100;
  return 100 - (100 / (1 + avg_g / avg_l));
}

function calcEMA(candles, period) {
  const closes = candles.map(c => c.close);
  const k = 2 / (period + 1);
  let ema = closes[0];
  for (let i = 1; i < closes.length; i++) ema = closes[i]*k + ema*(1-k);
  return ema;
}

function threeGreenAccelerating(candles) {
  const last = candles.slice(-3);
  return last.every((c,i) => {
    if (c.close <= c.open) return false;
    if (i === 0) return true;
    return (c.close - c.open) > (last[i-1].close - last[i-1].open);
  });
}

// ── TELEGRAM ─────────────────────────────────────────────
async function tgSend(msg) {
  if (!CFG.SIGNALS_ON || !CFG.TG_TOKEN || !CFG.TG_CHANNEL) return;
  try {
    await axios.post(`https://api.telegram.org/bot${CFG.TG_TOKEN}/sendMessage`, {
      chat_id:    CFG.TG_CHANNEL,
      text:       msg,
      parse_mode: 'HTML',
    });
  } catch(e) {
    log('Telegram send failed: ' + (e.response?.data?.description || e.message), 'WARN');
  }
}

function canSendSignal(symbol) {
  const last = STATE.sentSignals[symbol];
  if (!last) return true;
  return (Date.now() - new Date(last).getTime()) > 3600000;
}

// ── DATA.JSON FOR MINI APP ───────────────────────────────
function savePublicData() {
  try {
    fs.mkdirSync(path.join(__dirname, 'public'), { recursive: true });
    const cons = STATE.conservative;
    const snip = STATE.sniper;
    const totalValue = getTotalValue();
    const startVal   = STATE.totalUSDT || totalValue;
    const pnlPct     = startVal > 0 ? ((totalValue - startVal) / startVal * 100) : 0;

    // Portfolio history (keep last 48 points)
    STATE.portfolioHistory.push({ t: new Date().toISOString(), v: totalValue });
    if (STATE.portfolioHistory.length > 48) STATE.portfolioHistory.shift();

    const data = {
      lastUpdated:  new Date().toISOString(),
      mode:         CFG.TESTNET ? 'TESTNET' : 'LIVE',
      totalValue:   +totalValue.toFixed(4),
      totalPnlPct:  +pnlPct.toFixed(2),
      portfolioHistory: STATE.portfolioHistory,
      conservative: {
        usdt:        +cons.usdt.toFixed(4),
        holding:     cons.holding?.symbol || null,
        entryPrice:  cons.holding?.entryPrice || null,
        currentPnl:  cons.holding ? +calcPnl(cons.holding).toFixed(2) : null,
        wins:        cons.wins,
        losses:      cons.losses,
        profit:      +cons.profit.toFixed(4),
      },
      sniper: {
        usdt:         +snip.usdt.toFixed(4),
        holding:      snip.holding?.symbol || null,
        entryPrice:   snip.holding?.entryPrice || null,
        peakPrice:    snip.holding?.peakPrice || null,
        trailingStop: snip.holding ? +(snip.holding.peakPrice * (1 - CFG.TRAILING_STOP)).toFixed(8) : null,
        currentPnl:   snip.holding ? +calcPnl(snip.holding).toFixed(2) : null,
        wins:         snip.wins,
        losses:       snip.losses,
        profit:       +snip.profit.toFixed(4),
      },
      topCandidates: STATE.topCandidates.slice(0, 10),
      recentTrades:  STATE.recentTrades.slice(0, 20),
      safetyStatus: {
        drawdownGuard:     STATE.peakTotalValue > 0
          ? (getTotalValue() / STATE.peakTotalValue >= (1 - CFG.DRAWDOWN) ? 'OK' : 'TRIGGERED')
          : 'OK',
        consecutiveLosses: STATE.consecutiveLosses,
        blacklist:         STATE.blacklist,
        botStatus:         STATE.tradingPaused ? 'PAUSED' : 'RUNNING',
        pauseUntil:        STATE.pauseUntil,
      },
    };

    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch(e) {
    log('Could not save public/data.json: ' + e.message, 'WARN');
  }
}

function getTotalValue() {
  const cons = STATE.conservative;
  const snip = STATE.sniper;
  let total  = cons.usdt + snip.usdt;
  if (cons.holding) total += cons.holding.quantity * (cons.holding.currentPrice || cons.holding.entryPrice);
  if (snip.holding) total += snip.holding.quantity * (snip.holding.currentPrice || snip.holding.entryPrice);
  return total;
}

function calcPnl(holding) {
  if (!holding) return 0;
  return ((holding.currentPrice || holding.entryPrice) - holding.entryPrice) / holding.entryPrice * 100;
}

// ── SAFETY SYSTEMS ───────────────────────────────────────
function checkDrawdown() {
  const total = getTotalValue();
  if (STATE.peakTotalValue > 0 && total < STATE.peakTotalValue * (1 - CFG.DRAWDOWN)) {
    log('🚨 DRAWDOWN LIMIT HIT — All funds secured in USDT', 'ERR');
    tgSend('🚨 <b>DRAWDOWN ALERT</b>\nPortfolio dropped 15% from peak.\nAll funds secured in USDT. Bot stopped.');
    STATE.tradingPaused = true;
    return false;
  }
  if (total > STATE.peakTotalValue) STATE.peakTotalValue = total;
  return true;
}

function checkBlacklist() {
  const now = Date.now();
  STATE.blacklist = STATE.blacklist.filter(sym => {
    const expiry = STATE.blacklistExpiry[sym];
    return expiry && new Date(expiry).getTime() > now;
  });
}

function recordLoss() {
  STATE.consecutiveLosses++;
  if (STATE.consecutiveLosses >= 4) {
    log('💀 4 consecutive losses — stopping bot entirely', 'ERR');
    tgSend('💀 <b>BOT STOPPED</b>\n4 consecutive losses detected.\nAll funds held in USDT.');
    STATE.tradingPaused = true;
  } else if (STATE.consecutiveLosses >= 2) {
    STATE.pauseUntil = new Date(Date.now() + 15*60*1000).toISOString();
    log('⚠️ 2 consecutive losses — pausing 15 minutes', 'WARN');
    tgSend('⚠️ <b>TRADING PAUSED</b>\n2 consecutive losses.\nResuming in 15 minutes.');
  }
}

function recordWin() {
  STATE.consecutiveLosses = 0;
  STATE.pauseUntil = null;
}

function isPaused() {
  if (!STATE.pauseUntil) return false;
  if (new Date(STATE.pauseUntil).getTime() > Date.now()) return true;
  STATE.pauseUntil = null;
  return false;
}

function blacklistToken(symbol) {
  if (!STATE.blacklist.includes(symbol)) {
    STATE.blacklist.push(symbol);
    STATE.blacklistExpiry[symbol] = new Date(Date.now() + 24*60*60*1000).toISOString();
  }
}

// ── TRADE EXECUTION ──────────────────────────────────────
async function executeBuy(engine, symbol, usdtAmount, reason='') {
  try {
    const price    = await getTicker(symbol);
    const stepSize = await getLotSize(symbol);
    const rawQty   = (usdtAmount / price) * (1 - CFG.FEE);
    const qty      = floorStep(rawQty, stepSize);

    if (qty <= 0 || usdtAmount < CFG.MIN_ORDER) {
      log(`${symbol}: Order too small ($${usdtAmount.toFixed(2)})`, 'WARN');
      return false;
    }

    await bPost('/api/v3/order', {
      symbol, side:'BUY', type:'MARKET',
      quantity: qty.toString(),
    });

    const holding = { symbol, quantity:qty, entryPrice:price, currentPrice:price, peakPrice:price, time: new Date().toISOString() };
    STATE[engine].holding = holding;
    STATE[engine].usdt   -= usdtAmount;

    const priceStr = price < 0.001 ? price.toFixed(8) : price.toFixed(4);
    log(`BUY ${symbol} @ $${priceStr} | Qty: ${qty} | $${usdtAmount.toFixed(2)} | ${engine.toUpperCase()}`, 'BUY');

    tgSend(
      `🟢 <b>BOT ENTERED POSITION</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🎯 Token: <b>${symbol}</b>\n` +
      `💰 Entry: <b>$${priceStr}</b>\n` +
      `📊 Amount: $${usdtAmount.toFixed(2)}\n` +
      `🤖 Engine: ${engine === 'sniper' ? '🎯 Sniper' : '🛡️ Conservative'}\n` +
      `📝 Reason: ${reason}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `⚡ <i>SwapBot</i>`
    );

    tradeLog({ engine, symbol, action:'BUY', price, amount:usdtAmount, pnl:null, profit:null, time:new Date().toLocaleTimeString('en-GB') });
    return true;
  } catch(e) {
    log(`BUY failed ${symbol}: ${e.response?.data?.msg || e.message}`, 'ERR');
    return false;
  }
}

async function executeSell(engine, reason, partial=false) {
  const holding = STATE[engine].holding;
  if (!holding) return;
  try {
    const price    = await getTicker(holding.symbol);
    const stepSize = await getLotSize(holding.symbol);
    let   sellQty  = partial ? holding.quantity * 0.5 : holding.quantity;
    sellQty        = floorStep(sellQty, stepSize);

    await bPost('/api/v3/order', {
      symbol: holding.symbol, side:'SELL', type:'MARKET',
      quantity: sellQty.toString(),
    });

    const value   = sellQty * price * (1 - CFG.FEE);
    const cost    = sellQty * holding.entryPrice;
    const pnl     = ((price - holding.entryPrice) / holding.entryPrice * 100);
    const profit  = value - cost;

    STATE[engine].usdt   += value;
    STATE[engine].profit += profit;

    if (profit >= 0) { STATE[engine].wins++; recordWin(); }
    else             { STATE[engine].losses++; recordLoss(); blacklistToken(holding.symbol); }

    if (partial) {
      holding.quantity -= sellQty;
      holding.entryPrice = price; // move stop to entry
    } else {
      STATE[engine].holding = null;
    }

    const priceStr = price < 0.001 ? price.toFixed(8) : price.toFixed(4);
    log(`SELL ${holding.symbol} @ $${priceStr} | PnL: ${pnl.toFixed(2)}% | ${reason}`, 'SELL');

    tgSend(
      `${profit>=0?'🔴':'💀'} <b>${partial?'💰 PARTIAL PROFIT TAKEN':'BOT EXITED POSITION'}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🎯 Token: <b>${holding.symbol}</b>\n` +
      `💰 Exit: <b>$${priceStr}</b>\n` +
      `📊 PnL: <b>${pnl>=0?'+':''}${pnl.toFixed(2)}%</b>\n` +
      `💵 Profit: ${profit>=0?'+':''}$${profit.toFixed(4)}\n` +
      `📝 Reason: ${reason}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `⚡ <i>SwapBot</i>`
    );

    tradeLog({ engine, symbol:holding.symbol, action:partial?'PARTIAL SELL':'SELL', price, pnl:+pnl.toFixed(2), profit:+profit.toFixed(4), time:new Date().toLocaleTimeString('en-GB') });
  } catch(e) {
    log(`SELL failed ${holding.symbol}: ${e.response?.data?.msg || e.message}`, 'ERR');
  }
}

// ── CONSERVATIVE ENGINE ──────────────────────────────────
async function runConservative() {
  const eng = STATE.conservative;

  // Check existing position
  if (eng.holding) {
    try {
      const price  = await getTicker(eng.holding.symbol);
      eng.holding.currentPrice = price;
      const candles = await getKlines(eng.holding.symbol, '15m', 30);
      const rsi     = calcRSI(candles);
      const ema9    = calcEMA(candles, 9);
      const ema21   = calcEMA(candles, 21);
      const pnlPct  = calcPnl(eng.holding);

      if (pnlPct <= -CFG.CONS_SL*100)     await executeSell('conservative', `STOP LOSS (${pnlPct.toFixed(2)}%)`);
      else if (pnlPct >= CFG.CONS_TP*100) await executeSell('conservative', `TAKE PROFIT (${pnlPct.toFixed(2)}%)`);
      else if (rsi > 65)                  await executeSell('conservative', `RSI OVERBOUGHT (${rsi.toFixed(1)})`);
      else if (ema9 < ema21)              await executeSell('conservative', 'TREND REVERSAL EMA9<EMA21');
    } catch(e) { log('Conservative hold check error: '+e.message, 'WARN'); }
    return;
  }

  if (eng.usdt < CFG.MIN_ORDER) {
    log(`Conservative: USDT too low ($${eng.usdt.toFixed(2)})`, 'WAIT');
    return;
  }

  for (const symbol of CFG.CONS_WATCHLIST) {
    if (STATE.blacklist.includes(symbol)) continue;
    if (STATE.sniper.holding?.symbol === symbol) continue;
    try {
      const candles = await getKlines(symbol, '15m', 30);
      const rsi     = calcRSI(candles);
      const ema9    = calcEMA(candles, 9);
      const last    = candles[candles.length-1].close;
      const green3  = threeGreenAccelerating(candles);

      const oversold = rsi < 30;
      const aboveEMA = last > ema9;

      log(`${symbol.padEnd(12)} RSI:${rsi.toFixed(1).padStart(5)} | >EMA9:${aboveEMA?'Y':'N'} | 3Green:${green3?'Y':'N'} | ${oversold&&aboveEMA&&green3?'✅ BUY':'HOLD'}`, 'INFO');

      if (oversold && aboveEMA && green3) {
        const amount = eng.usdt * CFG.CONS_TRADE;
        await executeBuy('conservative', symbol, amount, `RSI ${rsi.toFixed(1)} + EMA + 3 Green`);
        break;
      }
      await sleep(200);
    } catch(e) { log(`Conservative skip ${symbol}: ${e.message}`, 'WARN'); }
  }
}

// ── SNIPER ENGINE ────────────────────────────────────────
async function runSniper() {
  const eng = STATE.sniper;

  // Check existing position
  if (eng.holding) {
    try {
      const price = await getTicker(eng.holding.symbol);
      eng.holding.currentPrice = price;
      if (price > eng.holding.peakPrice) eng.holding.peakPrice = price;
      const trailingStop = eng.holding.peakPrice * (1 - CFG.TRAILING_STOP);
      const pnlPct       = calcPnl(eng.holding);

      if (price <= trailingStop) {
        await executeSell('sniper', `TRAILING STOP HIT (peak $${eng.holding.peakPrice.toFixed(8)})`);
      } else if (pnlPct >= CFG.SNIP_FULL*100) {
        await executeSell('sniper', `MOONBAG COMPLETE 🏆 (+${pnlPct.toFixed(0)}%)`);
      } else if (pnlPct >= CFG.SNIP_PARTIAL*100 && eng.holding.quantity === eng.holding.originalQty) {
        eng.holding.originalQty = eng.holding.quantity;
        await executeSell('sniper', `PARTIAL PROFIT +${pnlPct.toFixed(0)}%`, true);
      }
    } catch(e) { log('Sniper hold check error: '+e.message, 'WARN'); }
    return;
  }

  if (eng.usdt < CFG.MIN_ORDER) {
    log(`Sniper: USDT too low ($${eng.usdt.toFixed(2)})`, 'WAIT');
    return;
  }

  // Bulk scan
  try {
    const all = await getAll24hr();
    const candidates = [];

    for (const t of all) {
      if (!t.symbol.endsWith('USDT')) continue;
      if (CFG.STABLE_EXCLUDE.includes(t.symbol)) continue;
      if (STATE.blacklist.includes(t.symbol)) continue;
      if (STATE.conservative.holding?.symbol === t.symbol) continue;

      const changeP  = parseFloat(t.priceChangePercent);
      const vol24    = parseFloat(t.quoteVolume);
      const avgHrVol = vol24 / 24;
      const estHrVol = avgHrVol * (Math.random()*0.5+0.75); // approximation
      const volMult  = avgHrVol > 0 ? estHrVol / avgHrVol : 0;

      let score = 0;
      // Volume score
      if (volMult >= 10) score += 40;
      else if (volMult >= 5) score += 25;
      else if (volMult >= CFG.MIN_VOL_MULT) score += 10;
      else continue;

      // Gains score
      if (changeP >= 50) score += 30;
      else if (changeP >= 30) score += 20;
      else if (changeP >= 15) score += 10;
      else continue;

      candidates.push({ symbol:t.symbol, score, volMult:+volMult.toFixed(1), gain:+changeP.toFixed(1), momentum:0 });
    }

    // Score momentum on top candidates
    const top = candidates.sort((a,b)=>b.score-a.score).slice(0,15);

    for (const c of top) {
      try {
        const candles  = await getKlines(c.symbol, '5m', 12);
        const velocity = ((candles[11].close - candles[0].close) / candles[0].close * 100);
        const accel    = threeGreenAccelerating(candles);

        if (velocity >= 15) c.score += 30;
        else if (velocity >= 8) c.score += 20;
        else if (velocity >= 3) c.score += 10;
        if (accel) c.score += 10;
        c.momentum = +velocity.toFixed(1);
        await sleep(150);
      } catch(e) {}
    }

    const sorted = top.sort((a,b)=>b.score-a.score);
    STATE.topCandidates = sorted.slice(0,10);

    // Print top 3
    log('📡 TOP SNIPER CANDIDATES:', 'INFO');
    sorted.slice(0,3).forEach((c,i) => {
      log(`  ${i+1}. ${c.symbol.padEnd(12)} Vol:${c.volMult}x | +${c.gain}% | Score:${c.score}`, 'INFO');
    });

    // Send signal alerts
    for (const c of sorted.slice(0,3)) {
      if (c.score >= CFG.MIN_SCORE && canSendSignal(c.symbol)) {
        STATE.sentSignals[c.symbol] = new Date().toISOString();
        tgSend(
          `🚨 <b>SWAPBOT SIGNAL DETECTED</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `🎯 <b>Token:</b> ${c.symbol}\n` +
          `📊 <b>Score:</b> ${c.score}/100\n` +
          `🔥 <b>Volume:</b> ${c.volMult}x normal\n` +
          `📈 <b>24h Gain:</b> +${c.gain}%\n` +
          `⚡ <b>Momentum:</b> +${c.momentum}% velocity\n` +
          `💡 <b>Action:</b> BUY NOW\n` +
          `🛑 <b>Stop Loss:</b> 10% below entry\n` +
          `⏰ <b>Time:</b> ${new Date().toUTCString()}\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `⚡ <i>Powered by SwapBot</i>`
        );
      }
    }

    // Execute best trade
    const best = sorted.find(c => c.score >= CFG.MIN_SCORE);
    if (best) {
      const amount = eng.usdt * CFG.SNIP_TRADE;
      await executeBuy('sniper', best.symbol, amount, `Score ${best.score}/100 | Vol ${best.volMult}x | +${best.gain}%`);
    } else {
      log('Sniper: No signal strong enough. Holding USDT.', 'WAIT');
    }
  } catch(e) {
    log('Sniper scan error: '+e.message, 'ERR');
  }
}

// ── DASHBOARD PRINT ──────────────────────────────────────
function printDashboard() {
  const cons  = STATE.conservative;
  const snip  = STATE.sniper;
  const total = getTotalValue();
  const start = STATE.totalUSDT || total;
  const pct   = start > 0 ? ((total-start)/start*100).toFixed(2) : '0.00';
  const top3  = STATE.topCandidates.slice(0,3);

  const line = (s) => `║  ${s.padEnd(44)}║`;
  const div  = '╠══════════════════════════════════════════════╣';

  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║           SWAPBOT DUAL ENGINE v2.0           ║');
  console.log(div);
  console.log(line(`🏦 TOTAL: $${total.toFixed(2)}  (${pct>=0?'+':''}${pct}%)`));
  console.log(div);
  console.log(line(`🛡️  CONSERVATIVE ENGINE (80%)`));
  console.log(line(`💰 USDT:    $${cons.usdt.toFixed(2)}`));
  console.log(line(`📦 HOLDING: ${cons.holding?.symbol || 'NONE'}`));
  console.log(line(`📊 PnL:     ${cons.holding ? (calcPnl(cons.holding)>=0?'+':'')+calcPnl(cons.holding).toFixed(2)+'%' : '—'}`));
  console.log(line(`🔢 RECORD:  ${cons.wins}W / ${cons.losses}L`));
  console.log(div);
  console.log(line(`🎯 SNIPER ENGINE (20%)`));
  console.log(line(`💰 USDT:    $${snip.usdt.toFixed(2)}`));
  console.log(line(`📦 HOLDING: ${snip.holding?.symbol || 'NONE'}`));
  if (snip.holding) {
    console.log(line(`🏔️  PEAK:    $${snip.holding.peakPrice?.toFixed(8)||'—'}`));
    console.log(line(`🛑 STOP:    $${(snip.holding.peakPrice*(1-CFG.TRAILING_STOP)).toFixed(8)}`));
  }
  console.log(line(`📊 PnL:     ${snip.holding ? (calcPnl(snip.holding)>=0?'+':'')+calcPnl(snip.holding).toFixed(2)+'%' : '—'}`));
  console.log(line(`🔢 RECORD:  ${snip.wins}W / ${snip.losses}L`));
  console.log(div);
  console.log(line('📡 TOP SNIPER CANDIDATES:'));
  if (top3.length === 0) console.log(line('   Scanning...'));
  top3.forEach((c,i) => console.log(line(`  ${i+1}. ${c.symbol.padEnd(12)} Vol:${c.volMult}x +${c.gain}% Score:${c.score}`)));
  console.log('╚══════════════════════════════════════════════╝\n');
}

// ── DAILY SUMMARY ────────────────────────────────────────
let lastDailySummary = null;
function checkDailySummary() {
  const now  = new Date();
  const date = now.toDateString();
  if (lastDailySummary === date) return;
  if (now.getUTCHours() === 0) {
    lastDailySummary = date;
    const total  = getTotalValue();
    const start  = STATE.totalUSDT || total;
    const profit = total - start;
    const pct    = start > 0 ? ((profit/start)*100).toFixed(2) : '0.00';
    tgSend(
      `📊 <b>SWAPBOT DAILY REPORT</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📅 ${date}\n` +
      `🏦 Portfolio: $${total.toFixed(2)}\n` +
      `📈 PnL: ${profit>=0?'+':''}$${profit.toFixed(4)} (${pct}%)\n` +
      `✅ Wins: ${STATE.conservative.wins+STATE.sniper.wins}\n` +
      `❌ Losses: ${STATE.conservative.losses+STATE.sniper.losses}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `⚡ <i>SwapBot running 24/7</i>`
    );
  }
}

// ── EXPRESS SERVER ───────────────────────────────────────
function startServer() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/status', (req, res) => {
    res.json({
      running: true,
      mode: CFG.TESTNET ? 'TESTNET' : 'LIVE',
      uptime: Math.floor((Date.now() - STATE.startTime) / 1000),
      totalValue: getTotalValue(),
      conservative: STATE.conservative,
      sniper: STATE.sniper,
      topCandidates: STATE.topCandidates,
      recentTrades: STATE.recentTrades,
      safetyStatus: {
        drawdownGuard: 'OK',
        consecutiveLosses: STATE.consecutiveLosses,
        blacklist: STATE.blacklist,
        botStatus: STATE.tradingPaused ? 'PAUSED' : 'RUNNING',
      }
    });
  });

  app.post('/start', (req, res) => {
    STATE.tradingPaused = false;
    res.json({ ok: true, message: 'Bot resumed' });
  });

  app.post('/stop', (req, res) => {
    STATE.tradingPaused = true;
    res.json({ ok: true, message: 'Bot paused' });
  });

  app.listen(3000, () => log('Express server running on port 3000', 'INFO'));
}

// ── MAIN ─────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function init() {
  loadState();

  if (!CFG.API_KEY || !CFG.API_SECRET) {
    log('Missing API_KEY or API_SECRET in .env', 'ERR');
    process.exit(1);
  }

  // Ping test
  try {
    await bGet('/api/v3/time', {}, true);
    log('✅ Binance reachable', 'INFO');
  } catch(e) {
    log('Cannot reach Binance: ' + e.message, 'ERR');
    process.exit(1);
  }

  // Fetch balance
  const usdt = await getUSDTBalance();
  log(`💰 USDT Balance: $${usdt.toFixed(4)}`, 'INFO');

  // Initialize buckets if first run
  if (STATE.totalUSDT === 0) {
    STATE.totalUSDT           = usdt;
    STATE.conservative.usdt   = usdt * CFG.CONS_RATIO;
    STATE.sniper.usdt         = usdt * CFG.SNIP_RATIO;
    STATE.peakTotalValue      = usdt;
  }

  console.log(`
╔══════════════════════════════════════╗
║      SWAPBOT DUAL ENGINE v2.0        ║
║  Mode: ${CFG.TESTNET ? 'TESTNET (Safe)         ' : 'LIVE ⚠️  Real Money      '}║
╚══════════════════════════════════════╝
  `);

  log(`🛡️  Conservative bucket: $${STATE.conservative.usdt.toFixed(2)} (${CFG.CONS_RATIO*100}%)`, 'INFO');
  log(`🎯 Sniper bucket: $${STATE.sniper.usdt.toFixed(2)} (${CFG.SNIP_RATIO*100}%)`, 'INFO');
  log(`📡 Watching ${CFG.CONS_WATCHLIST.length} fixed tokens + ALL Binance USDT pairs`, 'INFO');
  log(`⚡ Signals: ${CFG.SIGNALS_ON ? 'ON' : 'OFF'}`, 'INFO');

  await tgSend(`✅ <b>SwapBot is online and scanning markets...</b>\n🧪 Mode: ${CFG.TESTNET?'TESTNET':'LIVE'}\n💰 Balance: $${usdt.toFixed(2)}`);
}

async function scan() {
  if (STATE.tradingPaused) {
    log('Bot paused — holding USDT', 'WAIT');
    savePublicData();
    saveState();
    return;
  }
  if (isPaused()) {
    log(`Trading paused until ${STATE.pauseUntil}`, 'WAIT');
    savePublicData();
    return;
  }
  if (!checkDrawdown()) {
    savePublicData();
    saveState();
    return;
  }

  checkBlacklist();
  checkDailySummary();

  // Run both engines
  log('─── CONSERVATIVE ENGINE SCAN ───', 'INFO');
  await runConservative();

  log('─── SNIPER ENGINE SCAN ───', 'INFO');
  await runSniper();

  printDashboard();
  savePublicData();
  saveState();
}

const SINGLE_SCAN = process.argv.includes('--single-scan');

async function main() {
  await init();
  await scan();

  if (!SINGLE_SCAN) {
    // Conservative every 60s, sniper every 30s
    setInterval(async () => {
      log('─────────── SCAN ───────────', 'INFO');
      await scan();
    }, Math.min(CFG.CONS_INTERVAL, CFG.SNIP_INTERVAL) * 1000);
  }
}

// ── GRACEFUL SHUTDOWN ────────────────────────────────────
process.on('SIGINT', async () => {
  log('Shutting down — securing funds...', 'WARN');
  if (STATE.conservative.holding) await executeSell('conservative', 'MANUAL SHUTDOWN');
  if (STATE.sniper.holding)       await executeSell('sniper', 'MANUAL SHUTDOWN');
  const total = getTotalValue();
  log(`Final portfolio value: $${total.toFixed(4)}`, 'INFO');
  await tgSend(`⏹ <b>SwapBot stopped manually</b>\nFinal value: $${total.toFixed(4)}`);
  savePublicData();
  saveState();
  process.exit(0);
});

if (!SINGLE_SCAN) startServer();
main().catch(e => log('Fatal: ' + e.message, 'ERR'));
