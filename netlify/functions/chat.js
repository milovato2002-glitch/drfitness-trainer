// Dr. Fitness — chat function (DUAL-MODE)
// ----------------------------------------------------------------------------
// Modern Netlify Functions format (export default + Web Response) so we can
// stream. Two response paths:
//   1. body.stream === true  -> proxy Anthropic's SSE stream straight through.
//   2. otherwise             -> behave EXACTLY as the old function did:
//                               wait for the full completion, return the same
//                               JSON shape ({ content:[{text}], ... }) so the
//                               other 14 callers are byte-for-byte unaffected.
//
// Hard caps preserved from the previous version.
// ----------------------------------------------------------------------------

const MAX_TOKENS_CAP = 4000;
const DEFAULT_MAX_TOKENS = 1000;
const DEFAULT_MODEL = 'claude-sonnet-4-6';

// Only the production site may call this function. Browsers always send an
// Origin header on POST (same-origin included), so a missing or foreign
// Origin is rejected. ALLOWED_ORIGINS (comma-separated Netlify env var) can
// override the list, e.g. to add a custom domain or http://localhost:8888.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://drfitness-trainer.netlify.app')
  .split(',').map(s => s.trim()).filter(Boolean);

// Basic per-IP rate limit (sliding window). State lives in this function
// instance's memory, so it resets on cold start and is not shared between
// instances. It stops casual abuse, not a determined attacker.
const RATE_LIMIT = 30;           // requests
const RATE_WINDOW_MS = 60 * 1000; // per minute
const hits = new Map();          // ip -> array of request timestamps

function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    hits.set(ip, recent);
    return Math.ceil((RATE_WINDOW_MS - (now - recent[0])) / 1000);
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) {
    for (const [key, times] of hits) {
      if (!times.length || now - times[times.length - 1] >= RATE_WINDOW_MS) hits.delete(key);
    }
  }
  return 0;
}

function clientIp(request, context) {
  if (context && context.ip) return context.ip;
  const nf = request.headers.get('x-nf-client-connection-ip');
  if (nf) return nf;
  const xff = request.headers.get('x-forwarded-for');
  return xff ? xff.split(',')[0].trim() : 'unknown';
}

export default async (request, context) => {
  const origin = request.headers.get('origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin);
  const CORS = {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };
  if (allowed) CORS['Access-Control-Allow-Origin'] = origin;

  if (!allowed) {
    return new Response(JSON.stringify({ error: 'Forbidden origin.' }), {
      status: 403,
      headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: CORS });
  }

  const retryAfter = rateLimited(clientIp(request, context));
  if (retryAfter) {
    return new Response(JSON.stringify({ error: 'Too many requests. Please wait a minute and try again.' }), {
      status: 429,
      headers: { ...CORS, 'Content-Type': 'application/json', 'Retry-After': String(retryAfter) }
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API key not configured.' }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  const requestedTokens = Number(body.max_tokens) || DEFAULT_MAX_TOKENS;
  const cappedTokens = Math.min(Math.max(1, requestedTokens), MAX_TOKENS_CAP);
  const model = body.model || DEFAULT_MODEL;
  const wantStream = body.stream === true;

  const upstreamBody = {
    model: model,
    max_tokens: cappedTokens,
    system: body.system || '',
    messages: body.messages || [],
    stream: wantStream
  };

  let upstream;
  try {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(upstreamBody)
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  // ---- STREAMING PATH ------------------------------------------------------
  // Pass Anthropic's SSE bytes straight through to the browser. The client
  // reads the SSE stream and accumulates text from content_block_delta events.
  if (wantStream) {
    // If upstream errored, it won't be an SSE stream — surface it as JSON.
    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text().catch(() => 'Upstream error');
      return new Response(JSON.stringify({ error: errText }), {
        status: upstream.status || 500,
        headers: { ...CORS, 'Content-Type': 'application/json' }
      });
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...CORS,
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    });
  }

  // ---- NON-STREAMING PATH (unchanged contract for the other 14 callers) ----
  let data;
  try {
    data = await upstream.json();
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }
  return new Response(JSON.stringify(data), {
    status: upstream.status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });
};
