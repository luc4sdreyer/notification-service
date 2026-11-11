import { describe, expect, it } from 'vitest';
import { assertTransition, type Status } from '../src/domain/notification.js';
import { IllegalTransitionError } from '../src/domain/errors.js';

describe('status transitions', () => {
  it.each<[Status, Status]>([
    ['queued', 'sent'],
    ['queued', 'failed'],
  ])('allows %s -> %s', (from, to) => {
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  it.each<[Status, Status]>([
    ['sent', 'failed'],
    ['failed', 'sent'],
    ['sent', 'queued'],
    ['failed', 'queued'],
    ['queued', 'queued'],
  ])('rejects %s -> %s', (from, to) => {
    expect(() => assertTransition(from, to)).toThrow(IllegalTransitionError);
  });
});
