import { setTimeout as sleep } from 'node:timers/promises';
import type { Notification } from '../domain/notification.js';
import type { ChannelSender } from '../ports/channelSender.js';

export interface SimulatedSenderOptions {
  delayMs: number;
  /** 0..1, fraction of sends that fail. */
  failureRate: number;
  random?: () => number;
}

/** Stands in for a real provider (SMTP, SMS gateway, FCM/APNs). */
export class SimulatedSender implements ChannelSender {
  private readonly random: () => number;

  constructor(private readonly options: SimulatedSenderOptions) {
    this.random = options.random ?? Math.random;
  }

  async send(_notification: Notification): Promise<void> {
    if (this.options.delayMs > 0) await sleep(this.options.delayMs);
    if (this.random() < this.options.failureRate) {
      throw new Error('Simulated delivery failure');
    }
  }
}
