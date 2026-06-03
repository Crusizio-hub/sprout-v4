// SPROUT V4 — sync function (sin dependencias externas)
// Usa la API REST de Supabase directamente con fetch

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Supabase not configured' }) };
  }

  // Helper para llamadas a Supabase REST API
  async function sb(table, method, params, body) {
    let url = `${SUPABASE_URL}/rest/v1/${table}`;
    if (params) url += `?${params}`;

    const res = await fetch(url, {
      method: method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal'
      },
      body: body ? JSON.stringify(body) : undefined
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Supabase error on ${table}: ${err}`);
    }

    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  try {
    const body   = JSON.parse(event.body);
    const { action, user_id, data } = body;

    if (!user_id || !action) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing user_id or action' }) };
    }

    const today = new Date().toISOString().slice(0, 10);
    const sevenDaysAgo = new Date(Date.now() - 7*24*60*60*1000).toISOString().slice(0, 10);

    // ── LOAD: cargar todos los datos del usuario ──
    if (action === 'load') {
      const [user, profile, messages, memories, sprouts, seeds, seedsLog, moodLog, usage] = await Promise.all([
        sb('users',       'GET', `id=eq.${user_id}&select=*`),
        sb('profiles',    'GET', `user_id=eq.${user_id}&select=*`),
        sb('messages',    'GET', `user_id=eq.${user_id}&select=*&order=created_at.asc&limit=45`),
        sb('memories',    'GET', `user_id=eq.${user_id}&select=*&order=created_at.desc&limit=20`),
        sb('sprouts',     'GET', `user_id=eq.${user_id}&select=*&order=created_at.asc`),
        sb('seeds',       'GET', `user_id=eq.${user_id}&select=*&order=created_at.asc`),
        sb('seeds_log',   'GET', `user_id=eq.${user_id}&date=gte.${sevenDaysAgo}&select=*`),
        sb('mood_log',    'GET', `user_id=eq.${user_id}&select=*&order=date.desc&limit=30`),
        sb('usage_stats', 'GET', `user_id=eq.${user_id}&select=*`)
      ]);

      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          user:      user?.[0]      || null,
          profile:   profile?.[0]   || null,
          messages:  messages       || [],
          memories:  memories       || [],
          sprouts:   sprouts        || [],
          seeds:     seeds          || [],
          seeds_log: seedsLog       || [],
          mood_log:  moodLog        || [],
          usage:     usage?.[0]     || null
        })
      };
    }

    // ── SAVE USER ──
    if (action === 'save_user') {
      await sb('users', 'PATCH', `id=eq.${user_id}`, data);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    // ── SAVE PROFILE ──
    if (action === 'save_profile') {
      await sb('profiles', 'PATCH', `user_id=eq.${user_id}`, { ...data, updated_at: new Date().toISOString() });
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    // ── SAVE MOOD ──
    if (action === 'save_mood') {
      await fetch(`${SUPABASE_URL}/rest/v1/mood_log`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify({ user_id, mood: data.mood, date: today })
      });
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    // ── SAVE SEED ──
    if (action === 'save_seed') {
      if (data.id) {
        await sb('seeds', 'PATCH', `id=eq.${data.id}&user_id=eq.${user_id}`, data);
      } else {
        await sb('seeds', 'POST', null, { ...data, user_id });
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    // ── DELETE SEED ──
    if (action === 'delete_seed') {
      await sb('seeds', 'DELETE', `id=eq.${data.id}&user_id=eq.${user_id}`);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    // ── TOGGLE SEED ──
    if (action === 'toggle_seed') {
      await fetch(`${SUPABASE_URL}/rest/v1/seeds_log`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify({
          user_id,
          seed_id: data.seed_id,
          date: today,
          done: data.done,
          version_idx: data.version_idx ?? -1
        })
      });
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    // ── SAVE SPROUT ──
    if (action === 'save_sprout') {
      let saved;
      if (data.id) {
        saved = await sb('sprouts', 'PATCH', `id=eq.${data.id}&user_id=eq.${user_id}`, data);
      } else {
        saved = await sb('sprouts', 'POST', null, { ...data, user_id });
      }
      return { statusCode: 200, headers, body: JSON.stringify({ sprout: saved?.[0] || data }) };
    }

    // ── DELETE SPROUT ──
    if (action === 'delete_sprout') {
      await sb('sprouts', 'DELETE', `id=eq.${data.id}&user_id=eq.${user_id}`);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    // ── SAVE MEMORY ──
    if (action === 'save_memory') {
      await sb('memories', 'POST', null, { user_id, type: data.type, content: data.content });
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    // ── SAVE JOURNAL ──
    if (action === 'save_journal') {
      await sb('journal', 'POST', null, {
        user_id,
        content: data.content,
        shared_with_fern: data.shared_with_fern || false
      });
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    // ── SAVE SPROUT JOURNAL ──
    if (action === 'save_sprout_journal') {
      await sb('sprout_journal', 'POST', null, {
        user_id,
        sprout_id: data.sprout_id,
        content: data.content,
        shared_with_fern: data.shared_with_fern || false
      });
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    // ── UPDATE USAGE ──
    if (action === 'update_usage') {
      await fetch(`${SUPABASE_URL}/rest/v1/usage_stats`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify({ user_id, ...data, last_open: today, updated_at: new Date().toISOString() })
      });
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    // ── CREATE USER: primer login ──
    if (action === 'create_user') {
      // Verificar si ya existe
      const existing = await sb('users', 'GET', `id=eq.${user_id}&select=id`);
      if (!existing || existing.length === 0) {
        await sb('users', 'POST', null, { id: user_id, language: data.language || 'es' });
        await sb('profiles', 'POST', null, { user_id });
        await sb('usage_stats', 'POST', null, { user_id });
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action: ' + action }) };

  } catch(err) {
    console.error('Sync error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
