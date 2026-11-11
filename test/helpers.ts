import { createApp } from '../src/app.js';
import { createContainer } from '../src/container.js';
import type { ChannelSender } from '../src/ports/channelSender.js';

export const alwaysSucceeds: ChannelSender = { send: async () => {} };

export const alwaysFails: ChannelSender = {
  send: async () => {
    throw new Error('provider unavailable');
  },
};

/** A sender that does not complete until the test calls release(). */
export function gatedSender(): { sender: ChannelSender; release: () => void } {
  const { promise, resolve } = Promise.withResolvers<void>();
  return { sender: { send: () => promise }, release: resolve };
}

/** The real app and object graph, with one sender for every channel. */
export function setup(sender: ChannelSender = alwaysSucceeds, concurrency?: number) {
  const container = createContainer({
    senders: { email: sender, sms: sender, push: sender },
    concurrency,
  });
  const app = createApp({ service: container.service, validateResponses: true });
  return { ...container, app };
}

export const validBody = { recipient: 'user@example.com', channel: 'email', message: 'Hello' };
