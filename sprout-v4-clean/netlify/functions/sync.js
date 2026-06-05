// SPROUT V4 — sync function (Netlify Functions v2)

export default async (req) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), { status, headers });

  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) return json({ error: 'Supabase not configured' }, 500);

  async function sb(table, method, params, body) {
    let url = `${SUPABASE_URL}/rest/v1/${table}`;
    if (params) url += `?${params}`;
    const res = await fetch(url, {
      method: method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) { const err = await res.text(); throw new Error(`Supabase error on ${table}: ${err}`); }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  try {
    const payload = await req.json();
    const { action, user_id, data } = payload;

    if (!user_id || !action) return json({ error: 'Missing user_id or action' }, 400);

    const today = new Date().toISOString().slice(0, 10);
    const sevenDaysAgo = new Date(Date.now() - 7*24*60*60*1000).toISOString().slice(0, 10);

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
        sb('usage_stats', 'GET', `user_id=eq.${user_id}&select=*`),
      ]);
      return json({
        user:      user?.[0]    || null,
        profile:   profile?.[0] || null,
        messages:  messages     || [],
        memories:  memories     || [],
        sprouts:   sprouts      || [],
        seeds:     seeds        || [],
        seeds_log: seedsLog     || [],
        mood_log:  moodLog      || [],
        usage:     usage?.[0]   || null,
      });
    }

    if (action === 'save_user') {
      await sb('users', 'PATCH', `id=eq.${user_id}`, data);
      return json({ ok: true });
    }

    if (action === 'save_profile') {
      await sb('profiles', 'PATCH', `user_id=eq.${user_id}`, { ...data, updated_at: new Date().toISOString() });
      return json({ ok: true });
    }

    if (action === 'save_mood') {
      await fetch(`${SUPABASE_URL}/rest/v1/mood_log`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer': 'resolution=merge-duplicates',
        },
        body: JSON.stringify({ user_id, mood: data.mood, date: today }),
      });
      return json({ ok: true });
    }

    if (action === 'save_seed') {
      if (data.id) await sb('seeds', 'PATCH', `id=eq.${data.id}&user_id=eq.${user_id}`, data);
      else          await sb('seeds', 'POST',  null, { ...data, user_id });
      return json({ ok: true });
    }

    if (action === 'delete_seed') {
      await sb('seeds', 'DELETE', `id=eq.${data.id}&user_id=eq.${user_id}`);
      return json({ ok: true });
    }

    if (action === 'toggle_seed') {
      await fetch(`${SUPABASE_URL}/rest/v1/seeds_log`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer': 'resolution=merge-duplicates',
        },
        body: JSON.stringify({
          user_id, seed_id: data.seed_id, date: today,
          done: data.done, version_idx: data.version_idx ?? -1,
        }),
      });
      return json({ ok: true });
    }

    if (action === 'save_sprout') {
      let saved;
      if (data.id) saved = await sb('sprouts', 'PATCH', `id=eq.${data.id}&user_id=eq.${user_id}`, data);
      else          saved = await sb('sprouts', 'POST',  null, { ...data, user_id });
      return json({ sprout: saved?.[0] || data });
    }

    if (action === 'delete_sprout') {
      await sb('sprouts', 'DELETE', `id=eq.${data.id}&user_id=eq.${user_id}`);
      return json({ ok: true });
    }

    if (action === 'save_memory') {
      await sb('memories', 'POST', null, { user_id, type: data.type, content: data.content });
      return json({ ok: true });
    }

    if (action === 'save_journal') {
      await sb('journal', 'POST', null, {
        user_id, content: data.content, shared_with_fern: data.shared_with_fern || false,
      });
      return json({ ok: true });
    }

    if (action === 'save_sprout_journal') {
      await sb('sprout_journal', 'POST', null, {
        user_id, sprout_id: data.sprout_id, content: data.content,
        shared_with_fern: data.shared_with_fern || false,
      });
      return json({ ok: true });
    }

    if (action === 'update_usage') {
      await fetch(`${SUPABASE_URL}/rest/v1/usage_stats`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer': 'resolution=merge-duplicates',
        },
        body: JSON.stringify({ user_id, ...data, last_open: today, updated_at: new Date().toISOString() }),
      });
      return json({ ok: true });
    }

    if (action === 'create_user') {
      const existing = await sb('users', 'GET', `id=eq.${user_id}&select=id`);
      if (!existing || existing.length === 0) {
        await sb('users',       'POST', null, { id: user_id, language: data.language || 'es' });
        await sb('profiles',    'POST', null, { user_id });
        await sb('usage_stats', 'POST', null, { user_id });
      }
      return json({ ok: true });
    }

    return json({ error: 'Unknown action: ' + action }, 400);

  } catch (err) {
    console.error('Sync error:', err.message);
    return json({ error: err.message }, 500);
  }
};
