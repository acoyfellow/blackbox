import { type LimitedEnv, serveLimited } from '../front/index';
import type { Env } from '../worker/env';
import core from '../worker/index';

export type StandaloneEnv = Env & LimitedEnv;

export default {
  fetch(request: Request, env: StandaloneEnv): Promise<Response> {
    return serveLimited(request, env, { fetch: (inner) => core.fetch(inner, env) });
  },
};
