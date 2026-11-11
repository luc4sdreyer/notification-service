import type { components } from '../generated/api.js';
import { IllegalTransitionError } from './errors.js';

// Derived from the OpenAPI contract so the domain cannot drift from the spec.
export type Channel = components['schemas']['Channel'];
export type Status = components['schemas']['Status'];

export interface Notification {
  id: string;
  recipient: string;
  channel: Channel;
  message: string;
  status: Status;
  createdAt: Date;
  updatedAt: Date;
}

const allowedTransitions: Record<Status, readonly Status[]> = {
  queued: ['sent', 'failed'],
  sent: [],
  failed: [],
};

/** The single place status transitions are decided. Throws on anything not allowed. */
export function assertTransition(from: Status, to: Status): void {
  if (!allowedTransitions[from].includes(to)) {
    throw new IllegalTransitionError(from, to);
  }
}
