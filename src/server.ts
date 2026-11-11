import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createContainer } from './container.js';
import { SimulatedSender } from './adapters/simulatedSender.js';
import { log } from './log.js';

const config = loadConfig();

const sender = new SimulatedSender({ delayMs: config.sendDelayMs, failureRate: config.sendFailureRate });
const { service } = createContainer({
  senders: { email: sender, sms: sender, push: sender },
  concurrency: config.workerConcurrency,
});

const app = createApp({ service });
app.listen(config.port, () => {
  log('server.listening', { port: config.port });
});
