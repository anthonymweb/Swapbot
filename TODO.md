# SwapBot SaaS build TODO

## Plan (approved by user)
1. Scaffold a complete SwapBot SaaS repo in /home/anthonyl/Documents/swapbot:
   - Backend API (Node/Express)
   - Auth + per-user API key management (basic, production-ready structure)
   - Job runner interface for bot scans (local + webhook style; GitHub Actions can call single-scan)
   - Per-user state storage (file-based first; easily swappable to DB)
2. Create public dashboard prototype:
   - Telegram Mini App frontend (black brutalist UI)
   - Fetches per-user data snapshots
   - Auto refresh every 30s
3. Implement bot scanner logic placeholders:
   - Dual-engine scoring rules module
   - Binance integration module (stubbed in scaffolding; safe to test)
4. Add deployment scaffolding:
   - package.json scripts
   - GitHub Actions workflow templates (scan + pages deploy)
5. Provide run instructions + environment variables.

## Progress
- [x] Step 1: Scaffold backend/API skeleton
- [x] Step 2: Scaffold frontend mini app (public/index.html)
- [x] Step 3: Implement engine modules + state model (offline/stubbed v0 scoring + candidate gen + Binance adapter)
- [x] Step 4: Add workflows/templates (scan + pages deploy scaffolding)
- [x] Step 5: Testing + local dev instructions (smoke test + README + env example)

