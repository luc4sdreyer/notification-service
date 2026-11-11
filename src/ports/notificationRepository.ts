import type { Notification, Status } from '../domain/notification.js';

export interface NotificationRepository {
  save(notification: Notification): Promise<void>;
  findById(id: string): Promise<Notification | undefined>;
  updateStatus(id: string, status: Status): Promise<void>;
}
