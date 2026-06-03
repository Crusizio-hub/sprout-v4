// SPROUT V4 — chat function (sin dependencias externas)
exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const body = JSON.parse(event.body);
    const { messages, system, user_id, save_message } = body;

    if (!messages || !Array.isArray(messages)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request' }) };
    }

    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
    const SUPABASE_URL  = process.env.SUPABASE_URL;
    const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;

    // ── Llamada a Anthropic ──
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
        system: system || '',
        messages: messages
      })
    });

    const data = await res.json();

    if (data.error) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: data.error.message }) };
    }

    const reply = data.content && data.content[0] ? data.content[0].text : '';

    // ── Guardar mensajes en Supabase si hay user_id ──
    if (user_id && save_message && SUPABASE_URL && SUPABASE_KEY) {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');

        if (lastUserMsg) {
          await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${SUPABASE_KEY}`,
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify([
              { user_id, role: 'user', content: lastUserMsg.content, date: today },
              { user_id, role: 'ai',   content: reply,               date: today }
            ])
          });
        }
      } catch(dbErr) {
        console.error('Supabase save error:', dbErr.message);
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ content: data.content }) };

  } catch(err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error: ' + err.message }) };
  }
};
