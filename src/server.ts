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

// Stop taking requests, let in-flight requests finish, then finish queued sends.
async function shutdown(signal: string): Promise<void> {
  log('server.shutdown', { signal });
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await dispatcher.drain();
  log('server.stopped');
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
