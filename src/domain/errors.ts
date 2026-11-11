export interface FieldError {
  path: string;
  message: string;
}

/** Input rejected by a domain rule. Mapped to 400 in the same shape as spec validation errors. */
export class ValidationError extends Error {
  constructor(readonly errors: FieldError[]) {
    super('Request validation failed');
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class IllegalTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Illegal status transition ${from} -> ${to}`);
    this.name = 'IllegalTransitionError';
  }
}
