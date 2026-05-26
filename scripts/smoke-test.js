const { spawn } = require('node:child_process');
const http = require('node:http');

const PORT = Number(process.env.PORT || 3000);
const BASE_URL = `http://127.0.0.1:${PORT}`;

function requestJson(method, path) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      BASE_URL + path,
      { method, headers: { 'content-type': 'application/json' } },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, json: body ? JSON.parse(body) : null });
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  // Start server in a child process.
  const child = spawn('node', ['server.js'], { stdio: 'inherit', env: { ...process.env, PORT } });

  // Wait for /api/health
  const start = Date.now();
  let health;
  while (Date.now() - start < 10_000) {
    try {
      health = await requestJson('GET', '/api/health');
      if (health.status === 200) break;
    } catch {
      // ignore until server is up
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  if (!health || health.status !== 200) {
    child.kill('SIGTERM');
    throw new Error('Smoke test failed: server did not become ready in time.');
  }

  const snapshot = await requestJson('GET', '/api/snapshot');
  if (snapshot.status !== 200) {
    child.kill('SIGTERM');
    throw new Error('Smoke test failed: /api/snapshot not working.');
  }

  const scanResp = await requestJson('POST', '/api/scan/single');
  if (scanResp.status !== 200 || !scanResp.json?.ok) {
    child.kill('SIGTERM');
    throw new Error('Smoke test failed: /api/scan/single not working.');
  }

  // Done
  child.kill('SIGTERM');
  console.log('Smoke test passed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
