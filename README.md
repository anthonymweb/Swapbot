# SwapBot SaaS (v0 scaffold)

## Requirements
- Node.js 24+
- npm

## Local setup
```bash
npm ci
cp .env.example .env 2>/dev/null || true
```

## Run
Start API server:
```bash
npm run dev
# or: npm start
```

The server listens on:
- `PORT` (default: `3000`)

## Test (smoke)
```bash
npm test
```
This runs a local server and validates:
- `GET /api/health`
- `GET /api/snapshot`
- `POST /api/scan/single`

## Useful env vars
- `PORT` – API port (default: 3000)
- `MIN_BALANCE_USDT` – minimum `state.totalUSDT` to allow scanning (default: 3)
- `SCAN_INTERVAL_MS` – scan loop interval (default: 30000)
- `SCAN_SYMBOLS` – comma-separated symbols (only used when `BINANCE_REAL=1`)
- `BINANCE_REAL` – set to `"1"` to enable real Binance feature fetching (stubbed interface; defaults to offline synthetic)

## Project structure
- `server.js` – Express API
- `src/bot/runner.js` – Scan runner (single + loop)
- `src/engine/*` – Scoring + candidate generation + Binance adapter (stubbed)

## GitHub Actions
- `.github/workflows/scan.yml` – runs `node src/bot/runner.js --single-scan` on schedule
- `.github/workflows/pages.yml` – deploys the static dashboard from `/public`
