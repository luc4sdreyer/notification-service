import { randomUUID } from 'node:crypto';
import type { components } from '../generated/api.js';
import { assertTransition, type Channel, type Notification, type Status } from '../domain/notification.js';
import { NotFoundError } from '../domain/errors.js';
import { validateRecipient } from '../domain/recipientValidation.js';
import type { NotificationRepository } from '../ports/notificationRepository.js';
import type { Dispatcher } from '../ports/dispatcher.js';
import type { ChannelSender } from '../ports/channelSender.js';
import { log } from '../log.js';

export type CreateNotificationInput = components['schemas']['CreateNotificationRequest'];

export class NotificationService {
  constructor(
    private readonly repository: NotificationRepository,
    private readonly dispatcher: Dispatcher,
    private readonly senders: Record<Channel, ChannelSender>,
  ) {}

  async create(input: CreateNotificationInput): Promise<Notification> {
    validateRecipient(input.channel, input.recipient);
    const now = new Date();
    const notification: Notification = {
      id: randomUUID(),
      recipient: input.recipient,
      channel: input.channel,
      message: input.message,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.save(notification);
    this.dispatcher.enqueue(notification.id);
    log('notification.queued', { id: notification.id, channel: notification.channel });
    return notification;
  }

  async get(id: string): Promise<Notification> {
    const notification = await this.repository.findById(id);
    if (!notification) throw new NotFoundError(`Notification ${id} not found`);
    return notification;
  }

  /** Worker entry point. Never throws: every outcome ends in a log line. */
  async process(id: string): Promise<void> {
    try {
      const notification = await this.repository.findById(id);
      if (!notification) {
        log('notification.missing', { id });
        return;
      }

      let next: Status;
      let error: string | undefined;
      try {
        await this.senders[notification.channel].send(notification);
        next = 'sent';
      } catch (err) {
        next = 'failed';
        error = err instanceof Error ? err.message : String(err);
      }

      assertTransition(notification.status, next);
      await this.repository.updateStatus(id, next);
      log(`notification.${next}`, { id, channel: notification.channel, status: next, error });
    } catch (err) {
      log('notification.process_error', { id, error: String(err) });
    }
  }
}
