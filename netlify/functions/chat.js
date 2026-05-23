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

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

export default async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('', { status: 200, headers: CORS });
  }
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: CORS });
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
