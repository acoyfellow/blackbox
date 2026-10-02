import { z } from 'zod';

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface FrontEnv {
  ASSETS: Fetcher;
  CORE: Fetcher;
  UPLOAD_LIMIT: RateLimit;
  NARRATE_LIMIT: RateLimit;
  READ_LIMIT: RateLimit;
}

const ipSchema = z.string().min(1).catch('unknown');

function limiterFor(request: Request, env: FrontEnv): RateLimit {
  const path = new URL(request.url).pathname;

  if (path.endsWith('/narrate')) return env.NARRATE_LIMIT;

  if (request.method === 'POST') return env.UPLOAD_LIMIT;

  return env.READ_LIMIT;
}

export default {
  async fetch(request: Request, env: FrontEnv): Promise<Response> {
    const path = new URL(request.url).pathname;

    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
    const ip = ipSchema.parse(request.headers.get('cf-connecting-ip'));
    const { success } = await limiterFor(request, env).limit({ key: ip });

    if (!success) {
      return new Response(JSON.stringify({ error: 'rate limited' }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      });
    }

    return env.CORE.fetch(request);
  },
};
