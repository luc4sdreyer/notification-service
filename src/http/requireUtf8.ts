import type { IncomingMessage, ServerResponse } from 'node:http';

class BodyEncodingError extends Error {
  readonly expose = true;
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const decoder = new TextDecoder('utf-8', { fatal: true });

/**
 * `verify` hook for express.json(). JSON between systems must be UTF-8
 * (RFC 8259 section 8.1). Without this, invalid bytes are silently replaced
 * with U+FFFD and the corrupted text is stored and sent.
 */
export function requireUtf8(_req: IncomingMessage, _res: ServerResponse, body: Buffer, encoding: string): void {
  if (encoding !== 'utf-8') {
    throw new BodyEncodingError(415, `unsupported charset "${encoding.toUpperCase()}"; JSON must be UTF-8`);
  }
  try {
    decoder.decode(body);
  } catch {
    throw new BodyEncodingError(400, 'Request body is not valid UTF-8');
  }
}
