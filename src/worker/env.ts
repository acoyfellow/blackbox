import type { AiBinding } from './clef';

export interface D1Statement {
  bind(...values: (string | number | null)[]): D1Statement;
  first(): Promise<unknown>;
  all(): Promise<{ results: unknown[] }>;
  run(): Promise<unknown>;
}

export interface D1Binding {
  prepare(sql: string): D1Statement;
}

export interface R2Object {
  text(): Promise<string>;
}

export interface R2Binding {
  put(key: string, value: string): Promise<unknown>;
  get(key: string): Promise<R2Object | null>;
}

export interface Env {
  AI: AiBinding;
  DB: D1Binding;
  LOGS: R2Binding;
}
