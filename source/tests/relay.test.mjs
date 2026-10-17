import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { resolve } from 'node:path';

test('relay expires cached segments after ten seconds even when idle, without interrupting downloads', { timeout: 90000 }, async () => {
  const dotnet = process.env.DOTNET || 'dotnet';
  const output = resolve('../.qa/relay');
  execFileSync(dotnet, ['build', 'tests/relay/RelayChecks.csproj', '-c', 'Release', '-o', output, '--nologo'], { windowsHide: true, timeout: 60000, stdio: 'inherit' });
  const counts = new Map(), timers = new Set();
  const server = createServer((req, res) => {
    const path = req.url; const count = (counts.get(path) || 0) + 1; counts.set(path, count);
    const send = () => res.end(path === '/list.m3u8' ? `#EXTM3U\n# fetch ${count}` : `${path === '/slow.ts' ? 'slow' : 'segment'}:${count}`);
    if (path === '/slow.ts' || path === '/pending.ts') {
      const timer = setTimeout(() => { timers.delete(timer); send(); }, path === '/slow.ts' ? 12000 : 30000);
      timers.add(timer);
    } else send();
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const { stdout } = await promisify(execFile)(dotnet, [resolve(output, 'RelayChecks.dll'), `http://127.0.0.1:${server.address().port}/`], { windowsHide: true, timeout: 25000 });
    assert.match(stdout, /PASS:/);
    assert.equal(counts.get('/segment.ts'), 2);
    assert.equal(counts.get('/slow.ts'), 1);
    assert.equal(counts.get('/pending.ts'), 1);
  } finally {
    for (const timer of timers) clearTimeout(timer);
    server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
});
