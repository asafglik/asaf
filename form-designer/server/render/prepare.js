// Pool of worker threads that turn (template, data) into document HTML.
// Parsing a 50MB XML takes seconds of CPU; doing it here keeps the server
// responsive and uses every core when many requests arrive together.
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { config } from '../config.js';

const size = Math.max(1, config.prepareWorkers || os.cpus().length);
const workers = [];
const idle = [];
const queue = [];
const pending = new Map();
let seq = 0;

function spawn() {
  const w = new Worker(new URL('./prepare-worker.js', import.meta.url), {
    resourceLimits: { maxOldGenerationSizeMb: config.workerMemoryMb },
  });
  w.current = null;
  w.on('message', (m) => {
    const p = pending.get(m.id);
    pending.delete(m.id);
    w.current = null;
    w.unref();
    idle.push(w);
    pump();
    if (!p) return;
    if (m.ok) p.resolve(m);
    else p.reject(Object.assign(new Error(m.message), m.status ? { status: m.status } : {}));
  });
  w.on('error', (e) => fail(w, e));
  w.on('exit', (code) => { if (code !== 0) fail(w, new Error(`worker exited (${code})`)); });
  // after the listeners (adding a 'message' listener refs the worker again):
  // idle workers do not keep the process (CLI, tests) alive
  w.unref();
  workers.push(w);
  idle.push(w);
}

function fail(w, e) {
  const i = workers.indexOf(w);
  if (i < 0) return;
  workers.splice(i, 1);
  const j = idle.indexOf(w);
  if (j >= 0) idle.splice(j, 1);
  if (w.current !== null) {
    const p = pending.get(w.current);
    pending.delete(w.current);
    // typically out of memory on a huge input
    if (p) p.reject(Object.assign(new Error('הנתונים גדולים מדי לעיבוד'), { status: 413, cause: e }));
  }
  spawn();
  pump();
}

function pump() {
  while (idle.length && queue.length) {
    const w = idle.pop();
    const job = queue.shift();
    w.current = job.msg.id;
    w.ref(); // busy workers keep the process alive until they answer
    w.postMessage(job.msg, job.transfer);
  }
}

/**
 * { html, errors, width, height } for the template and data (object, string, or
 * raw bytes with an optional charset).
 */
export function prepareDocument(template, data, { format, lang, charset, namePattern, index } = {}) {
  if (!workers.length) for (let i = 0; i < size; i++) spawn();
  const id = ++seq;
  let payload = data;
  const transfer = [];
  if (Buffer.isBuffer(data) || data instanceof Uint8Array) {
    // a private copy whose memory moves to the worker without another copy
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    payload = copy;
    transfer.push(copy.buffer);
  }
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    queue.push({ msg: { id, template, data: payload, charset, format, lang, namePattern, index }, transfer });
    pump();
  });
}

export async function closePrepareWorkers() {
  const all = workers.splice(0);
  idle.length = 0;
  await Promise.all(all.map((w) => w.terminate()));
}
