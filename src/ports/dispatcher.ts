/** Seam for a real broker (Pub/Sub, SQS). Producers only enqueue ids; the record lives in the repository. */
export interface Dispatcher {
  enqueue(id: string): void;
  /** Resolves when the queue is empty and nothing is in flight. */
  drain(): Promise<void>;
}
