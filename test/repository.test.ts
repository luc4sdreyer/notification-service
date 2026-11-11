import { describe, expect, it } from 'vitest';
import { InMemoryNotificationRepository } from '../src/adapters/inMemoryNotificationRepository.js';
import type { Notification } from '../src/domain/notification.js';

function sample(): Notification {
  const now = new Date('2026-01-01T00:00:00Z');
  return {
    id: '6f1c2a8e-3b4d-4c5e-8f9a-0b1c2d3e4f5a',
    recipient: 'user@example.com',
    channel: 'email',
    message: 'Hello',
    status: 'queued',
    createdAt: now,
    updatedAt: now,
  };
}

describe('InMemoryNotificationRepository', () => {
  it('is not affected by changes to a returned record, including its dates', async () => {
    const repo = new InMemoryNotificationRepository();
    await repo.save(sample());

    const returned = (await repo.findById(sample().id))!;
    returned.status = 'sent';
    returned.createdAt.setUTCFullYear(2000);

    const stored = (await repo.findById(sample().id))!;
    expect(stored.status).toBe('queued');
    expect(stored.createdAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('is not affected by changes to the saved object after save', async () => {
    const repo = new InMemoryNotificationRepository();
    const original = sample();
    await repo.save(original);

    original.updatedAt.setUTCFullYear(2000);

    const stored = (await repo.findById(original.id))!;
    expect(stored.updatedAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});
