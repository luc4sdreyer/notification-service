import { isUtf8 } from 'node:buffer';
import express, { type RequestHandler } from 'express';

// JSON between systems must be UTF-8 (RFC 8259 section 8.1). Without these
// checks, Node turns undecodable input into U+FFFD and the corrupted text is
// stored and sent.

class BodyEncodingError extends Error {
  readonly expose = true;
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const NOT_UTF8 = 'Request body is not valid UTF-8';

/** Decided from the header alone, so the body is never read for a charset we refuse. */
const requireUtf8Charset: RequestHandler = (req, _res, next) => {
  const charset = /;\s*charset\s*=\s*"?([^";\s]+)/i.exec(req.headers['content-type'] ?? '')?.[1]?.toLowerCase();
  if (charset !== undefined && charset !== 'utf-8') {
    return next(new BodyEncodingError(415, `unsupported charset "${charset.toUpperCase()}"; JSON must be UTF-8`));
  }
  next();
};

/** Raw bytes: catches invalid sequences before the decoder replaces them. */
function verifyUtf8Bytes(_req: unknown, _res: unknown, body: Buffer): void {
  if (!isUtf8(body)) throw new BodyEncodingError(400, NOT_UTF8);
}

function isWellFormed(value: unknown): boolean {
  if (typeof value === 'string') return value.isWellFormed();
  if (Array.isArray(value)) return value.every(isWellFormed);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).every(([key, v]) => key.isWellFormed() && isWellFormed(v));
  }
  return true;
}

/** Parsed strings: catches lone surrogates written as JSON escapes (\ud83d), which are valid bytes but cannot be encoded as UTF-8. */
const requireWellFormedStrings: RequestHandler = (req, _res, next) => {
  next(isWellFormed(req.body) ? undefined : new BodyEncodingError(400, NOT_UTF8));
};

/** express.json() that only accepts text that survives a round trip through UTF-8. */
export function utf8Json(): RequestHandler[] {
  return [requireUtf8Charset, express.json({ verify: verifyUtf8Bytes }), requireWellFormedStrings];
}
