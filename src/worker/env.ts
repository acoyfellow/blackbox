import type { AiBinding, JsonValue } from './clef';

export interface D1RunResult {
  success: boolean;
}

export interface D1Statement {
  bind(...values: (string | number | null)[]): D1Statement;
  first(): Promise<JsonValue>;
  all(): Promise<{ results: JsonValue[] }>;
  run(): Promise<D1RunResult>;
}

export interface D1Binding {
  prepare(sql: string): D1Statement;
}

export interface R2Object {
  text(): Promise<string>;
}

export interface R2Binding {
  put(key: string, value: string): Promise<R2Object | null>;
  get(key: string): Promise<R2Object | null>;
}

export interface Env {
  AI: AiBinding;
  DB: D1Binding;
  LOGS: R2Binding;
}
