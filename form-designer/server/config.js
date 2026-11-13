// Runtime configuration: environment variables override config.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// dates are formatted in Israel time unless the server says otherwise (TZ / config.json timeZone)
const tzFromFile = (() => {
  try {
    return JSON.parse(fs.readFileSync(process.env.FD_CONFIG || new URL('../config.json', import.meta.url), 'utf8')).timeZone;
  } catch {
    return undefined;
  }
})();
if (!process.env.TZ) process.env.TZ = tzFromFile || 'Asia/Jerusalem';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

const fileCfg = readJson(process.env.FD_CONFIG || path.join(ROOT, 'config.json'));
const argMode = process.argv.find((a) => a.startsWith('--mode='))?.split('=')[1];

const env = process.env;
const bool = (v, d) => (v === undefined ? d : /^(1|true|yes|on)$/i.test(String(v)));

export const config = {
  port: +(env.PORT || fileCfg.port || 3700),
  host: env.HOST || fileCfg.host || '0.0.0.0',
  // full = designer + render API, render = render API only (client servers)
  mode: argMode || env.FD_MODE || fileCfg.mode || 'full',
  storageDir: path.resolve(ROOT, env.FD_STORAGE || fileCfg.storageDir || 'storage'),
  chromePath: env.CHROME_PATH || fileCfg.chromePath || '',
  apiKey: env.FD_API_KEY || fileCfg.apiKey || '',
  maxConcurrent: +(env.FD_MAX_CONCURRENT || fileCfg.maxConcurrent || 4),
  maxQueue: +(env.FD_MAX_QUEUE || fileCfg.maxQueue || 100),
  renderTimeoutMs: +(env.FD_RENDER_TIMEOUT_MS || fileCfg.renderTimeoutMs || 60000),
  maxImportBytes: +(fileCfg.maxImportBytes || 25 * 1024 * 1024),
  bodyLimit: env.FD_BODY_LIMIT || fileCfg.bodyLimit || '60mb',
  // bulk rendering: records per call and request size
  maxBatch: +(env.FD_MAX_BATCH || fileCfg.maxBatch || 10000),
  batchBodyLimit: env.FD_BATCH_BODY_LIMIT || fileCfg.batchBodyLimit || '300mb',
  allowRemoteImages: bool(env.FD_ALLOW_REMOTE_IMAGES, !!fileCfg.allowRemoteImages),
  sofficePath: env.SOFFICE_PATH || fileCfg.sofficePath || '',
  historyLimit: +(fileCfg.historyLimit || 20),
  // smart design agent (Claude). ANTHROPIC_API_KEY is read by the SDK as well.
  anthropicApiKey: fileCfg.anthropicApiKey || '',
  aiModel: env.FD_AI_MODEL || fileCfg.aiModel || 'claude-opus-5-5',
};
