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

function limiterFor(request: Request, env: LimitedEnv): RateLimit {
  const path = new URL(request.url).pathname;

  if (path.endsWith('/narrate')) return env.NARRATE_LIMIT;

  if (request.method === 'POST') return env.UPLOAD_LIMIT;

  return env.READ_LIMIT;
}

export interface LimitedEnv {
  ASSETS: Fetcher;
  UPLOAD_LIMIT: RateLimit;
  NARRATE_LIMIT: RateLimit;
  READ_LIMIT: RateLimit;
}

export async function serveLimited(
  request: Request,
  env: LimitedEnv,
  core: Fetcher,
): Promise<Response> {
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

  return core.fetch(request);
}

export default {
  fetch(request: Request, env: FrontEnv): Promise<Response> {
    return serveLimited(request, env, env.CORE);
  },
};
