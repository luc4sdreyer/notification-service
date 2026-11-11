import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createContainer } from './container.js';
import { SimulatedSender } from './adapters/simulatedSender.js';
import { log } from './log.js';

const config = loadConfig();

const sender = new SimulatedSender({ delayMs: config.sendDelayMs, failureRate: config.sendFailureRate });
const { service, dispatcher } = createContainer({
  senders: { email: sender, sms: sender, push: sender },
  concurrency: config.workerConcurrency,
});

const server = createApp({ service }).listen(config.port, () => {
  log('server.listening', { port: config.port });
});

// Below Docker's and Kubernetes' default 10s grace period, so the exit is ours, not a SIGKILL.
const SHUTDOWN_TIMEOUT_MS = 8_000;

// Stop taking requests, let in-flight requests finish, then finish queued sends.
// A hung send would otherwise keep the process alive until it is killed.
async function shutdown(signal: string): Promise<void> {
  log('server.shutdown', { signal });
  const timer = setTimeout(() => {
    log('server.shutdown_timeout', { timeoutMs: SHUTDOWN_TIMEOUT_MS, abandoned: dispatcher.pending });
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  timer.unref();

  await new Promise<void>((resolve) => server.close(() => resolve()));
  await dispatcher.drain();
  log('server.stopped');
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
