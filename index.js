/**
 * Host half of the opencode usage ring.
 *
 * opencode publishes the account's plan usage itself - one rolling 5-hour
 * window, one week, and one 30-day month - at its Zen endpoint. The ring shows
 * the 5-hour and 30-day figures, so this half simply reads the plan state with
 * the API key opencode already stored and hands the result to the Client.
 *
 * Only a GET request leaves this machine, and the key is never logged, echoed
 * or written anywhere.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ROUTE_PATH = '/opencode-usage-ring/data';
const USAGE_URL = 'https://opencode.ai/zen/go/v1/usage';
const WINDOWS = ['rolling', 'weekly', 'monthly'];

/** One read serves every open page for a minute. */
const CACHE_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 12000;

const KEY_ENTRIES = ['opencode-go', 'go', 'opencode'];
const KEY_ENV = ['OPENCODE_GO_API_KEY', 'OPENCODE_API_KEY'];

function warn(message) {
  try {
    console.warn(`[opencode-usage-ring] ${message}`);
  } catch {
    // logging is best-effort
  }
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/* ---------------------------------------------------------------- the key */

/**
 * opencode stores one credential per provider in `auth.json` next to its
 * database. The `opencode-go` entry is the one the Go plan bills against.
 */
function candidateAuthFiles() {
  const list = [];
  const xdg = text(process.env.XDG_DATA_HOME);
  if (xdg) list.push(join(xdg, 'opencode', 'auth.json'));
  list.push(join(homedir(), '.local', 'share', 'opencode', 'auth.json'));
  const localAppData = text(process.env.LOCALAPPDATA);
  if (localAppData) list.push(join(localAppData, 'opencode', 'auth.json'));
  list.push(join(homedir(), 'AppData', 'Local', 'opencode', 'auth.json'));
  return list;
}

async function readStoredKey() {
  for (const file of candidateAuthFiles()) {
    if (!existsSync(file)) continue;
    let parsed;
    try {
      parsed = JSON.parse(await readFile(file, 'utf8'));
    } catch {
      continue;
    }
    for (const entry of KEY_ENTRIES) {
      const record = parsed && parsed[entry];
      const key = record && typeof record === 'object' ? text(record.key) : '';
      if (key) return key;
    }
  }
  return '';
}

async function apiKey() {
  for (const name of KEY_ENV) {
    const value = text(process.env[name]);
    if (value) return value;
  }
  return readStoredKey();
}

/* -------------------------------------------------------------- the plan */

function normalizeWindow(input) {
  if (!input || typeof input !== 'object') return null;
  const percent = Number(input.percent);
  return {
    percent: Number.isFinite(percent) ? Math.max(0, Math.min(999, Math.round(percent * 10) / 10)) : 0,
    status: text(input.status) || 'ok',
    resetsAt: text(input.resetsAt) || null,
  };
}

function describeFailure(status) {
  if (status === 401 || status === 403) return 'The opencode API key was refused. Run `opencode auth login` again.';
  if (status === 404) return 'This account has no opencode Go plan usage endpoint.';
  if (status === 429) return 'The opencode usage endpoint is rate limited. It will retry shortly.';
  return `The opencode usage endpoint answered ${status}.`;
}

async function fetchUsage() {
  const key = await apiKey();
  if (!key) {
    throw new Error('No opencode Go API key was found. Run `opencode auth login` once.');
  }
  let response;
  try {
    response = await fetch(USAGE_URL, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${key}`,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const cause = error && error.cause && error.cause.code ? ` (${error.cause.code})` : '';
    throw new Error(`Could not reach opencode.ai${cause}. Check this computer's internet connection.`);
  }
  if (!response.ok) throw new Error(describeFailure(response.status));

  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error('The opencode usage endpoint answered with something other than JSON.');
  }
  const usage = body && body.usage;
  if (!usage || typeof usage !== 'object') {
    throw new Error('The opencode usage endpoint answered without plan data.');
  }

  const windows = {};
  for (const name of WINDOWS) windows[name] = normalizeWindow(usage[name]);
  if (!windows.rolling && !windows.monthly) {
    throw new Error('The opencode usage endpoint answered without a 5-hour window.');
  }
  return windows;
}

/* ---------------------------------------------------------------- snapshot */

let cache = null;
let lastGood = null;

async function snapshot(now = Date.now()) {
  if (cache && now - cache.at < CACHE_MS) return cache.payload;

  let payload;
  try {
    const windows = await fetchUsage();
    payload = {
      available: true,
      error: null,
      updatedAt: new Date(now).toISOString(),
      source: 'opencode.ai',
      windows,
    };
    lastGood = payload;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!lastGood) warn(message);
    // A page that already showed numbers keeps them, greyed out, instead of
    // collapsing to an empty circle because one request failed.
    payload = {
      available: false,
      error: message,
      updatedAt: lastGood ? lastGood.updatedAt : null,
      source: lastGood ? 'opencode.ai (last good read)' : null,
      windows: lastGood ? lastGood.windows : null,
    };
  }

  cache = { at: payload.available ? now : now - Math.floor(CACHE_MS / 2), payload };
  return payload;
}

/* ------------------------------------------------------------------ route */

function sendJson(res, status, value) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(value));
}

async function handleRequest(req, res) {
  try {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed.' });
      return;
    }
    sendJson(res, 200, await snapshot());
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

/* ------------------------------------------------------------------- load */

/**
 * `ctx.get(name)` answers for the moment it is called, so a web server that
 * activates after this plugin is waited for rather than missed.
 */
const SERVICE_RETRY_MS = 250;
const SERVICE_RETRY_LIMIT = 40;

function useService(ctx, name, use, onGiveUp) {
  let done = false;
  let timer = null;
  let attempts = 0;

  const attempt = () => {
    if (done) return;
    const service = ctx.get(name);
    if (service) {
      done = true;
      try {
        use(service);
      } catch (error) {
        warn(`could not use ${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }
    attempts += 1;
    if (attempts >= SERVICE_RETRY_LIMIT) {
      onGiveUp?.();
      return;
    }
    timer = setTimeout(attempt, SERVICE_RETRY_MS);
  };

  attempt();

  try {
    ctx.effect(() => () => {
      done = true;
      if (timer) clearTimeout(timer);
    });
  } catch {
    done = true;
    if (timer) clearTimeout(timer);
  }
}

export function apply(ctx) {
  useService(
    ctx,
    'webServer',
    (webServer) => {
      ctx.effect(() => webServer.register({ kind: 'exact', path: ROUTE_PATH, handler: handleRequest }));
    },
    () => warn('no web server in this composition; the ring cannot read plan usage'),
  );
}
