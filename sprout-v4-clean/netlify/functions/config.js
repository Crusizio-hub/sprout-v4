// SPROUT V4 — config function (Netlify Functions v2)

export default async (req) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers });

  return new Response(JSON.stringify({
    supabase_url: process.env.SUPABASE_URL      || '',
    supabase_key: process.env.SUPABASE_ANON_KEY || '',
  }), { status: 200, headers });
};
