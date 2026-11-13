#!/usr/bin/env node
// Load test for the render API: N calls sent at the same time.
//   node scripts/loadtest.js --template 1001 --data examples/invoice.xml --count 1000
//   node scripts/loadtest.js --template 1001 --data small.xml --count 1000 --big big50mb.xml --big-count 5
// Options: --url http://localhost:3700  --key <x-api-key>  --concurrency <calls in flight, default = count>
import fs from 'node:fs';
import http from 'node:http';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args[a.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true;
}
const url = new URL(`/api/render/${args.template || '1001'}`, args.url || 'http://localhost:3700');
const small = fs.readFileSync(args.data || new URL('../examples/invoice.xml', import.meta.url));
const big = args.big ? fs.readFileSync(args.big) : null;
const count = Number(args.count || 1000);
const bigCount = big ? Number(args['big-count'] || 1) : 0;
const conc = Number(args.concurrency || count + bigCount);
const agent = new http.Agent({ keepAlive: true, maxSockets: conc });

// the large calls are spread through the run
const jobs = Array.from({ length: count }, () => small);
for (let i = 0; i < bigCount; i++) jobs.splice(Math.floor(((i + 1) * jobs.length) / (bigCount + 1)), 0, big);

function call(body) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const req = http.request(url, { method: 'POST', agent, headers: { 'Content-Type': 'application/xml', 'Content-Length': body.length, ...(args.key ? { 'x-api-key': args.key } : {}) } }, (res) => {
      let bytes = 0;
      res.on('data', (c) => { bytes += c.length; });
      res.on('end', () => resolve({ status: res.statusCode, ms: Date.now() - t0, bytes, big: body === big, pages: res.headers['x-render-pages'] }));
    });
    req.on('error', (e) => resolve({ status: 'ERR ' + e.code, ms: Date.now() - t0, big: body === big }));
    req.end(body);
  });
}

const started = Date.now();
const results = [];
let next = 0;
await Promise.all(Array.from({ length: Math.min(conc, jobs.length) }, async () => {
  while (next < jobs.length) results.push(await call(jobs[next++]));
}));
const secs = (Date.now() - started) / 1000;
const by = {};
for (const r of results) by[r.status] = (by[r.status] || 0) + 1;
const pct = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor((arr.length * p) / 100))] : 0);
const ms = results.filter((r) => !r.big && r.status === 200).map((r) => r.ms).sort((a, b) => a - b);
const bigMs = results.filter((r) => r.big).map((r) => `${r.status}/${(r.ms / 1000).toFixed(1)}s`);
console.log(`${results.length} calls (${count} x ${(small.length / 1024).toFixed(0)}KB${big ? ` + ${bigCount} x ${(big.length / 1e6).toFixed(0)}MB` : ''}), ${Math.min(conc, jobs.length)} at once, ${secs.toFixed(1)}s`);
console.log('status:', JSON.stringify(by));
console.log(`small calls: ${(ms.length / secs).toFixed(1)}/s, latency p50 ${(pct(ms, 50) / 1000).toFixed(1)}s, p95 ${(pct(ms, 95) / 1000).toFixed(1)}s, max ${(pct(ms, 100) / 1000).toFixed(1)}s`);
if (bigMs.length) console.log('large calls:', bigMs.join(', '));
process.exitCode = results.every((r) => r.status === 200) ? 0 : 1;
