import { STATUS_CODES } from 'node:http';
import type { ErrorRequestHandler } from 'express';
import { NotFoundError, ValidationError, type FieldError } from '../domain/errors.js';
import { log } from '../log.js';

/** RFC 9457 problem details. */
interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  errors?: FieldError[];
}

/** Shape shared by express-openapi-validator's HttpError and body-parser errors. */
interface HttpLikeError {
  status: number;
  message: string;
  errors?: Array<{ path: string; message: string }>;
  headers?: Record<string, string>;
  type?: string;
}

function isHttpLikeError(err: unknown): err is HttpLikeError {
  return err instanceof Error && typeof (err as Partial<HttpLikeError>).status === 'number';
}

function problem(status: number, detail: string, errors?: FieldError[]): Problem {
  return { type: 'about:blank', title: STATUS_CODES[status] ?? 'Error', status, detail, ...(errors && { errors }) };
}

function toProblem(err: unknown): { body: Problem; headers?: Record<string, string> } {
  if (err instanceof ValidationError) {
    return { body: problem(400, err.message, err.errors) };
  }
  if (err instanceof NotFoundError) {
    return { body: problem(404, err.message) };
  }
  if (isHttpLikeError(err) && err.status >= 400 && err.status < 500) {
    if (err.type === 'entity.parse.failed') {
      return { body: problem(400, 'Malformed JSON in request body') };
    }
    const errors = err.errors?.map(({ path, message }) => ({ path, message })) ?? [];
    if (err.status === 400 && errors.length > 0) {
      return { body: problem(400, 'Request validation failed', errors) };
    }
    // Other validator errors (404 unknown route, 405, 415) carry a single readable message.
    return { body: problem(err.status, errors[0]?.message ?? err.message), ...(err.headers && { headers: err.headers }) };
  }
  return { body: problem(500, 'An unexpected error occurred') };
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const { body, headers } = toProblem(err);
  if (body.status >= 500) {
    log('http.unhandled_error', { method: req.method, path: req.path, error: String(err) });
  }
  if (headers) res.set(headers);
  res.status(body.status).type('application/problem+json').json(body);
};
