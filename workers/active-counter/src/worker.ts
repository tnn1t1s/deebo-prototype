interface Env {
  ACTIVE_USERS: KVNamespace;
  ENVIRONMENT: string;
}

// Get the ISO week number for a date
export function getWeekNumber(d: Date): string {
  const date = new Date(d.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  const week1 = new Date(date.getFullYear(), 0, 4);
  const weekNum = Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  return `${date.getFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
}

async function handlePing(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || !('hash' in body) || typeof body.hash !== 'string') {
      return new Response('Invalid request body', { status: 400 });
    }

    const currentWeek = getWeekNumber(new Date());
    const key = `${currentWeek}:${body.hash}`;
    
    // Store the ping with a 7-day expiration
    await env.ACTIVE_USERS.put(key, new Date().toISOString(), { expirationTtl: 7 * 24 * 60 * 60 });

    return new Response(JSON.stringify({ success: true }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    return new Response('Internal server error', { status: 500 });
  }
}

async function handleActive(env: Env): Promise<Response> {
  try {
    const currentWeek = getWeekNumber(new Date());
    const prefix = `${currentWeek}:`;
    
    // List all keys for the current week
    const { keys } = await env.ACTIVE_USERS.list({ prefix });
    const count = keys.length;

    // Return in shields.io JSON format
    const response = {
      schemaVersion: 1,
      label: 'active installs',
      message: count.toString(),
      color: count > 0 ? 'brightgreen' : 'lightgrey',
    };

    return new Response(JSON.stringify(response), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
  } catch (error) {
    return new Response('Internal server error', { status: 500 });
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    const url = new URL(request.url);

    // Route requests
    if (url.pathname === '/ping') {
      return handlePing(request, env);
    } else if (url.pathname === '/active') {
      return handleActive(env);
    }

    return new Response('Not found', { status: 404 });
  },
};
