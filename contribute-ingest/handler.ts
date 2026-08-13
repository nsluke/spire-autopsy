/**
 * Snapshot ingest — POST JSON, allowlist-sanitize, store. No IPs, no user-agent.
 * Used by the Cloudflare Worker and by Pages Functions at /api/contribute.
 */
import { sanitizeContribution, SNAPSHOT_SCHEMA } from '../src/lib/contributeSnapshot';

export interface ContributeEnv {
  DB: {
    prepare(query: string): {
      bind: (...args: unknown[]) => { run: () => Promise<unknown> };
    };
  };
  ALLOWED_ORIGINS?: string;
}

const MAX_BYTES = 64 * 1024;

function allowedOrigins(env: ContributeEnv): string[] {
  const raw = env.ALLOWED_ORIGINS ?? 'https://nsluke.github.io,http://localhost:5173,http://127.0.0.1:5173';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function originAllowed(origin: string, allow: string[]): boolean {
  if (allow.includes(origin)) return true;
  try {
    const u = new URL(origin);
    if (u.protocol === 'https:' && u.hostname.endsWith('.pages.dev')) return true;
  } catch {
    return false;
  }
  return false;
}

function corsHeaders(origin: string): Headers {
  return new Headers({
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  });
}

export async function handleContributeRequest(request: Request, env: ContributeEnv): Promise<Response> {
  const origin = request.headers.get('origin') ?? '';
  const allow = allowedOrigins(env);
  if (!origin || !originAllowed(origin, allow)) {
    return new Response('origin not allowed', { status: 403 });
  }
  const cors = corsHeaders(origin);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== 'POST') {
    cors.set('allow', 'POST, OPTIONS');
    return new Response('method not allowed', { status: 405, headers: cors });
  }

  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > MAX_BYTES) {
    return new Response('payload too large', { status: 413, headers: cors });
  }

  let raw: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BYTES) {
      return new Response('payload too large', { status: 413, headers: cors });
    }
    raw = JSON.parse(text) as unknown;
  } catch {
    return new Response('invalid json', { status: 400, headers: cors });
  }

  const snapshot = sanitizeContribution(raw);
  if (!snapshot) {
    return new Response('not a contribution snapshot', { status: 422, headers: cors });
  }

  if (!env.DB) {
    return new Response('ingest not configured', { status: 503, headers: cors });
  }

  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      'INSERT INTO contributions (id, schema_version, run_count, payload) VALUES (?, ?, ?, ?)',
    )
      .bind(id, SNAPSHOT_SCHEMA, snapshot.corpus.runCount, JSON.stringify(snapshot))
      .run();
  } catch {
    return new Response('store failed', { status: 500, headers: cors });
  }

  cors.set('content-type', 'application/json');
  return new Response(JSON.stringify({ ok: true }), { status: 201, headers: cors });
}
