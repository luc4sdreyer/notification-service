/**
 * Minimal structured logging. Callers pass ids, channels and statuses only;
 * never recipient or message content.
 */
export function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ time: new Date().toISOString(), event, ...fields }));
}
