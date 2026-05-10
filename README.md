# ⚡ SwapBot Dual Engine v2.0

A crypto trading bot with two simultaneous engines, Telegram signal alerts, and a Telegram Mini App dashboard.

---

## 🗂 File Structure

```
swapbot/
├── bot.js                        ← Main bot (dual engine)
├── package.json                  ← Dependencies
├── .env.example                  ← Copy to .env and fill in
├── .gitignore                    ← Keeps secrets off GitHub
├── public/
│   ├── index.html                ← Telegram Mini App
│   └── data.json                 ← Live data (auto-updated)
└── .github/
    └── workflows/
        ├── bot.yml               ← Runs bot every 5 min
        └── pages.yml             ← Deploys Mini App
```

---

## 🚀 Setup (Local)

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env with your actual keys
```

### 3. Run the bot
```bash
# Continuous mode (local / PM2)
node bot.js

# Single scan (GitHub Actions)
node bot.js --single-scan
```

---

## 📱 Telegram Setup

### Create your bot
1. Open @BotFather on Telegram
2. Send `/newbot`
3. Follow prompts → copy the **token**
4. Add token to `.env` as `TELEGRAM_BOT_TOKEN`

### Create your channel
1. Create a new Telegram channel
2. Add your bot as **Administrator**
3. Add channel username to `.env` as `TELEGRAM_CHANNEL_ID`

### Register Mini App
1. Open @BotFather
2. Send `/newapp`
3. Select your bot
4. Web App URL: `https://YOUR_USERNAME.github.io/swapbot/`
5. Copy the Mini App link → pin it in your channel

---

## ☁️ GitHub Actions Setup

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "SwapBot v2.0"
git branch -M main
git remote add origin https://github.com/USERNAME/swapbot.git
git push -u origin main
```

### 2. Add GitHub Secrets
Go to repo → Settings → Secrets → Actions → New secret:

| Secret | Value |
|--------|-------|
| `TESTNET` | `true` |
| `API_KEY` | Your Binance API key |
| `API_SECRET` | Your Binance secret |
| `TELEGRAM_BOT_TOKEN` | Your bot token |
| `TELEGRAM_CHANNEL_ID` | @YourChannel |
| `SIGNALS_ENABLED` | `true` |
| `GH_USERNAME` | Your GitHub username |

### 3. Enable GitHub Pages
Repo → Settings → Pages → Source → **GitHub Actions**

### 4. Enable Actions
Repo → Actions → Enable workflows

---

## 🧠 Strategy

### Conservative Engine (80%)
- Watches: BTC, ETH, BNB, SOL, ADA, AVAX, POL, DOGE, LINK, DOT
- Buys when: RSI < 30 AND price > EMA9 AND 3 green accelerating candles
- Sells when: RSI > 65 OR -5% loss OR +8% profit OR EMA reversal

### Sniper Engine (20%)
- Watches: ALL Binance USDT pairs including memecoins
- Scores tokens: Volume spike + 24h gains + momentum velocity
- Buys when: Score ≥ 70/100
- Uses trailing stop: 10% below peak price
- Partial sell at +100%, full exit at +300%

### Safety Systems
- 🚨 Drawdown guard: stops if portfolio drops 15%
- ⚠️ Consecutive loss guard: pause after 2 losses, stop after 4
- 🚫 Blacklist: losing tokens banned for 24h
- 💀 Minimum balance: stops below $3

---

## 💰 Monetization Phases

| Phase | Status | Description |
|-------|--------|-------------|
| Telegram Signals | ✅ Active | Free signal alerts to channel |
| Sellable Package | ⏸ On Hold | Selar.co + MTN MoMo |
| SaaS Dashboard | ⏸ On Hold | Users pay monthly |

---

## ⚠️ Risk Disclaimer

- Never invest money you cannot afford to lose
- No bot guarantees profit
- Always test on testnet first
- Keep stop losses enabled at all times
