import type { Dispatcher } from '../ports/dispatcher.js';
import { log } from '../log.js';

type Handler = (id: string) => Promise<void>;

/** FIFO queue with bounded concurrency. Lost on restart; see README. */
export class InMemoryDispatcher implements Dispatcher {
  private readonly queue: string[] = [];
  private inFlight = 0;
  private idleWaiters: Array<() => void> = [];

  constructor(
    private readonly handler: Handler,
    private readonly concurrency = 5,
  ) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error('concurrency must be a positive integer');
    }
  }

  enqueue(id: string): void {
    this.queue.push(id);
    this.pump();
  }

  drain(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private isIdle(): boolean {
    return this.queue.length === 0 && this.inFlight === 0;
  }

  private pump(): void {
    while (this.inFlight < this.concurrency && this.queue.length > 0) {
      const id = this.queue.shift()!;
      this.inFlight++;
      void this.run(id);
    }
    if (this.isIdle()) {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const resolve of waiters) resolve();
    }
  }

  private async run(id: string): Promise<void> {
    try {
      await this.handler(id);
    } catch (err) {
      // The handler should not throw; if it does, keep the worker alive.
      log('dispatch.handler_error', { id, error: String(err) });
    } finally {
      this.inFlight--;
      this.pump();
    }
  }
}
