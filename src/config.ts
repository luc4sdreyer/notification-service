export interface Config {
  port: number;
  sendDelayMs: number;
  sendFailureRate: number;
  workerConcurrency: number;
}

function readNumber(env: NodeJS.ProcessEnv, name: string, fallback: number, valid: (n: number) => boolean): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || !valid(value)) {
    throw new Error(`Invalid value for ${name}: ${raw}`);
  }
  return value;
}

const isNonNegativeInt = (n: number) => Number.isInteger(n) && n >= 0;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: readNumber(env, 'PORT', 3000, isNonNegativeInt),
    sendDelayMs: readNumber(env, 'SEND_DELAY_MS', 100, isNonNegativeInt),
    sendFailureRate: readNumber(env, 'SEND_FAILURE_RATE', 0.1, (n) => n >= 0 && n <= 1),
    workerConcurrency: readNumber(env, 'WORKER_CONCURRENCY', 5, (n) => Number.isInteger(n) && n >= 1),
  };
}
