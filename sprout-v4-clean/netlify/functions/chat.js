// SPROUT V4 — chat function (Netlify Functions v2, streaming)

export default async (req) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: cors });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const SUPABASE_URL  = process.env.SUPABASE_URL;
  const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;

  let payload;
  try { payload = await req.json(); }
  catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  const { messages, system, user_id, save_message } = payload;
  if (!messages || !Array.isArray(messages)) {
    return new Response(JSON.stringify({ error: 'Invalid request' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  // Detectar idioma del system prompt para fallback
  const isEN = system && system.startsWith('YOUR NAME');

  const fallbackMsg = isEN
    ? "My AI took a little breath — it happens sometimes. Try again in a moment 🌿"
    : "Mi IA se tomó un pequeño respiro — pasa a veces. Intentá de nuevo en un momento 🌿";

  let anthropicRes;
  try {
    anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
        system: system || '',
        messages,
        stream: true,
      }),
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ content: [{ text: fallbackMsg }], fallback: true }),
      { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }

  if (!anthropicRes.ok) {
    return new Response(
      JSON.stringify({ content: [{ text: fallbackMsg }], fallback: true }),
      { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }

  // ── Streaming SSE ──
  const encoder = new TextEncoder();
  let fullText = '';

  const stream = new ReadableStream({
    async start(controller) {
      const reader = anthropicRes.body.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (raw === '[DONE]') continue;
            try {
              const parsed = JSON.parse(raw);
              if (parsed.type === 'content_block_delta' && parsed.delta && parsed.delta.text) {
                fullText += parsed.delta.text;
                controller.enqueue(encoder.encode(
                  `data: ${JSON.stringify({ text: parsed.delta.text })}\n\n`
                ));
              }
            } catch (_) {}
          }
        }
      } catch (readErr) {
        console.error('Stream read error:', readErr);
      }

      // Guardar en Supabase al finalizar
      if (user_id && save_message && SUPABASE_URL && SUPABASE_KEY && fullText) {
        const today = new Date().toISOString().slice(0, 10);
        const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
        if (lastUserMsg) {
          try {
            await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Prefer': 'return=minimal',
              },
              body: JSON.stringify([
                { user_id, role: 'user', content: lastUserMsg.content, date: today },
                { user_id, role: 'ai',   content: fullText,            date: today },
              ]),
            });
          } catch (dbErr) {
            console.error('Supabase save error:', dbErr.message);
          }
        }
      }

      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...cors,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    },
  });
};
