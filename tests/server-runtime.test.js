import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('serveur actif: démarre réellement, expose health et bloque les fichiers privés', { timeout:15_000 }, async t => {
  const port = 43_000 + (process.pid % 1_000);
  const child = spawn(process.execPath, ['scripts/serve.js'], {
    cwd:new URL('../', import.meta.url),
    env:{ ...process.env, PORT:String(port), DATABASE_URL:'' },
    stdio:['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  t.after(() => { if (!child.killed) child.kill('SIGTERM'); });

  let healthResponse = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      healthResponse = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (healthResponse.ok) break;
    } catch {}
    await wait(100);
  }
  assert.ok(healthResponse?.ok, `serveur non démarré: ${output}`);
  const health = await healthResponse.json();
  assert.equal(health.ok, true);
  assert.equal(health.centralSync, false);
  assert.equal((await fetch(`http://127.0.0.1:${port}/continuity-center.js`)).status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${port}/.git/config`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${port}/scripts/serve.js`)).status, 404);
});
