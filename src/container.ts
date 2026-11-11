import type { Channel } from './domain/notification.js';
import type { ChannelSender } from './ports/channelSender.js';
import { InMemoryNotificationRepository } from './adapters/inMemoryNotificationRepository.js';
import { InMemoryDispatcher } from './adapters/inMemoryDispatcher.js';
import { NotificationService } from './service/notificationService.js';

export interface ContainerOptions {
  senders: Record<Channel, ChannelSender>;
  concurrency?: number;
}

/**
 * Wires the in-memory adapters. Shared by server.ts and the tests so both run
 * the same object graph. The dispatcher calls back into the service, hence the closure.
 */
export function createContainer({ senders, concurrency }: ContainerOptions) {
  const repository = new InMemoryNotificationRepository();
  const dispatcher = new InMemoryDispatcher((id): Promise<void> => service.process(id), concurrency);
  const service: NotificationService = new NotificationService(repository, dispatcher, senders);
  return { repository, dispatcher, service };
}
