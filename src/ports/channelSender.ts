import type { Notification } from '../domain/notification.js';

export interface ChannelSender {
  /** Resolves when delivered; throws on failure. */
  send(notification: Notification): Promise<void>;
}
