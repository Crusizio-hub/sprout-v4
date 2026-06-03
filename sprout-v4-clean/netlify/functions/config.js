// SPROUT V4 — config function
// Sirve las keys públicas al frontend de forma segura

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      supabase_url: process.env.SUPABASE_URL      || '',
      supabase_key: process.env.SUPABASE_ANON_KEY || ''
    })
  };
};
