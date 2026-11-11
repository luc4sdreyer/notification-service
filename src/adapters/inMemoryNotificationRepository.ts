import type { Notification, Status } from '../domain/notification.js';
import type { NotificationRepository } from '../ports/notificationRepository.js';

export class InMemoryNotificationRepository implements NotificationRepository {
  private readonly items = new Map<string, Notification>();

  async save(notification: Notification): Promise<void> {
    this.items.set(notification.id, { ...notification });
  }

  async findById(id: string): Promise<Notification | undefined> {
    const found = this.items.get(id);
    return found ? { ...found } : undefined;
  }

  async updateStatus(id: string, status: Status): Promise<void> {
    const found = this.items.get(id);
    if (!found) throw new Error(`Notification ${id} not found`);
    this.items.set(id, { ...found, status, updatedAt: new Date() });
  }
}
