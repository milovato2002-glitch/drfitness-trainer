// Hard caps on user-controllable fields. max_tokens is capped for cost
// protection; model defaults preserve current behavior for any caller that
// doesn't pass one.
const MAX_TOKENS_CAP = 4000;
const DEFAULT_MAX_TOKENS = 1000;
const DEFAULT_MODEL = 'claude-sonnet-4-6';

exports.handler = async function(event, context) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'API key not configured.' })
    };
  }
  try {
    const body = JSON.parse(event.body);
    const requestedTokens = Number(body.max_tokens) || DEFAULT_MAX_TOKENS;
    const cappedTokens = Math.min(Math.max(1, requestedTokens), MAX_TOKENS_CAP);
    const model = body.model || DEFAULT_MODEL;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model,
        max_tokens: cappedTokens,
        system: body.system || '',
        messages: body.messages || []
      })
    });
    const data = await response.json();
    return {
      statusCode: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(data)
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
