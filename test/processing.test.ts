import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { ChannelSender } from '../src/ports/channelSender.js';
import { alwaysFails, alwaysSucceeds, gatedSender, gatedSenders, setup, validBody } from './helpers.js';

async function create(app: Parameters<typeof request>[0], body: object = validBody): Promise<string> {
  const res = await request(app).post('/v0/notifications').send(body);
  expect(res.status).toBe(202);
  return res.body.id;
}

async function statusOf(app: Parameters<typeof request>[0], id: string): Promise<string> {
  const res = await request(app).get(`/v0/notifications/${id}`);
  return res.body.status;
}

describe('processing', () => {
  it('marks a notification sent when the sender succeeds', async () => {
    const { app, dispatcher } = setup(alwaysSucceeds);
    const id = await create(app);

    await dispatcher.drain();

    expect(await statusOf(app, id)).toBe('sent');
  });

  it('marks a notification failed when the sender throws', async () => {
    const { app, dispatcher } = setup(alwaysFails);
    const id = await create(app);

    await dispatcher.drain();

    expect(await statusOf(app, id)).toBe('failed');
  });

  it('reports queued until the sender completes', async () => {
    const { sender, release } = gatedSender();
    const { app, dispatcher } = setup(sender);
    const id = await create(app);

    expect(await statusOf(app, id)).toBe('queued');

    release();
    await dispatcher.drain();
    expect(await statusOf(app, id)).toBe('sent');
  });

  it('resolves every drain() caller, and waits again once the queue refills', async () => {
    const { sender, sendStarted } = gatedSenders();
    const { app, dispatcher } = setup(sender);
    // True if p has not settled once the microtask queue is empty (event-loop order, not time).
    const isPending = (p: Promise<void>) =>
      Promise.race([p.then(() => false), new Promise<boolean>((r) => setImmediate(() => r(true)))]);

    // A behaviour check: every waiter is released, however drain() is implemented.
    const first = await create(app);
    const waiters = [dispatcher.drain(), dispatcher.drain()];
    (await sendStarted(0))();
    await Promise.all(waiters);
    expect(await statusOf(app, first)).toBe('sent');

    // The regression check: a second cycle must not reuse the already-resolved promise.
    const second = await create(app);
    const nextDrain = dispatcher.drain();
    expect(await isPending(nextDrain)).toBe(true);
    (await sendStarted(1))();
    await nextDrain;
    expect(await statusOf(app, second)).toBe('sent');
  });

  it('keeps processing the queue after a failure', async () => {
    // Fails the first message only; concurrency 1 forces strict ordering.
    const failsFirst: ChannelSender = {
      send: async (n) => {
        if (n.message === 'first') throw new Error('provider unavailable');
      },
    };
    const { app, dispatcher } = setup(failsFirst, 1);
    const first = await create(app, { ...validBody, message: 'first' });
    const second = await create(app, { ...validBody, message: 'second' });

    await dispatcher.drain();

    expect(await statusOf(app, first)).toBe('failed');
    expect(await statusOf(app, second)).toBe('sent');
  });
});
