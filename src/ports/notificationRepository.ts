import type { Notification, Status } from '../domain/notification.js';

/**
 * Records cross this boundary by value: save() must not keep the caller's object,
 * and findById() must return one the caller can change without affecting what is
 * stored. A database adapter gets this for free; an in-memory one has to copy.
 */
export interface NotificationRepository {
  save(notification: Notification): Promise<void>;
  findById(id: string): Promise<Notification | undefined>;
  updateStatus(id: string, status: Status): Promise<void>;
}
