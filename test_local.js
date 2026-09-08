#!/usr/bin/env node
/**
 * Local check: run the real handler over every pinned handle and assert it never
 * answers with a product other than the one the freight mapping validated.
 *
 *   node test_local.js            # all handles
 *   node test_local.js 40         # first 40 only
 */
const handler = require('./api/eta.js');
const MAP = require('./gw-map.json');

function fakeRes() {
  const r = {};
  r.setHeader = () => {};
  r.status = () => r;
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}

const norm = u => String(u || '').trim().toLowerCase().replace(/^http:/, 'https:').replace(/\/+$/, '');

(async () => {
  const handles = Object.keys(MAP);
  const limit = process.argv[2] ? parseInt(process.argv[2], 10) : handles.length;
  const todo = handles.slice(0, limit);

  let ok = 0, hidden = 0, wrong = 0;
  const byMatch = {};
  const wrongOnes = [], hiddenOnes = [];

  for (let i = 0; i < todo.length; i++) {
    const h = todo[i];
    const res = fakeRes();
    await handler({ method: 'GET', query: { handle: h } }, res);
    const b = res.body || {};
    byMatch[b.matched || 'error'] = (byMatch[b.matched || 'error'] || 0) + 1;

    if (b.status === 'unknown' || !b.eta_text) {
      hidden++;
      hiddenOnes.push([h, b.matched, b.error || '']);
    } else if (norm(b.source_url) !== norm(MAP[h].u)) {
      wrong++;
      wrongOnes.push([h, MAP[h].u, b.source_url, b.eta_text]);
    } else {
      ok++;
    }
    if ((i + 1) % 50 === 0) process.stderr.write(`  ...${i + 1}/${todo.length}\n`);
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\nchecked            ${todo.length}`);
  console.log(`correct product    ${ok}`);
  console.log(`badge hidden       ${hidden}`);
  console.log(`WRONG PRODUCT      ${wrong}`);
  console.log(`\nresolution path:`, byMatch);

  if (wrongOnes.length) {
    console.log('\n--- WRONG ---');
    wrongOnes.forEach(w => console.log('  ', w.join('\n     ')));
  }
  if (hiddenOnes.length) {
    console.log(`\n--- hidden (${hiddenOnes.length}) ---`);
    hiddenOnes.slice(0, 20).forEach(w => console.log('  ', w.join(' | ')));
  }
  process.exit(wrong ? 1 : 0);
})();
