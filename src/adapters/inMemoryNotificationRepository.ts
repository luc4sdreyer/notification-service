import type { Notification, Status } from '../domain/notification.js';
import type { NotificationRepository } from '../ports/notificationRepository.js';

/**
 * Every Date gets its own instance: the service creates a record with one Date
 * for both timestamps, and a copy that kept that sharing would let a change to
 * one field change the other. Update this if Notification gains object fields.
 */
function copy(n: Notification): Notification {
  return { ...n, createdAt: new Date(n.createdAt), updatedAt: new Date(n.updatedAt) };
}

export class InMemoryNotificationRepository implements NotificationRepository {
  private readonly items = new Map<string, Notification>();

  async save(notification: Notification): Promise<void> {
    this.items.set(notification.id, copy(notification));
  }

  async findById(id: string): Promise<Notification | undefined> {
    const found = this.items.get(id);
    return found ? copy(found) : undefined;
  }

  async updateStatus(id: string, status: Status): Promise<void> {
    const found = this.items.get(id);
    if (!found) throw new Error(`Notification ${id} not found`);
    this.items.set(id, { ...found, status, updatedAt: new Date() });
  }
}
