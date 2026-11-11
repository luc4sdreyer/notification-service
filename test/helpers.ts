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

/**
 * A sender where every call waits for its own release. sendStarted(i) resolves
 * once send has been called for the i-th time (0-based), with that call's
 * release function, so tests wait on the event itself instead of polling.
 */
export function gatedSenders(): { sender: ChannelSender; sendStarted: (i: number) => Promise<() => void> } {
  const started: Array<PromiseWithResolvers<() => void>> = [];
  const slot = (i: number) => (started[i] ??= Promise.withResolvers<() => void>());
  let calls = 0;
  const sender: ChannelSender = {
    send: () => {
      const gate = Promise.withResolvers<void>();
      slot(calls++).resolve(gate.resolve);
      return gate.promise;
    },
  };
  return { sender, sendStarted: (i) => slot(i).promise };
}

/** The real app and object graph, with one sender for every channel. */
export function setup(sender: ChannelSender = alwaysSucceeds, concurrency?: number) {
  const container = createContainer({
    senders: { email: sender, sms: sender, push: sender },
    ...(concurrency !== undefined && { concurrency }),
  });
  const app = createApp({ service: container.service, validateResponses: true });
  return { ...container, app };
}

export const validBody = { recipient: 'user@example.com', channel: 'email', message: 'Hello' };
