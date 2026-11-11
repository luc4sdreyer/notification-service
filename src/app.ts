import { fileURLToPath } from 'node:url';
import express from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import type { NotificationService } from './service/notificationService.js';
import { notificationRoutes } from './http/notificationRoutes.js';
import { errorHandler } from './http/errorHandler.js';
import { requireUtf8 } from './http/requireUtf8.js';

// Same relative location from src/ (tsx) and dist/ (compiled).
export const specPath = fileURLToPath(new URL('../openapi.yaml', import.meta.url));

export interface AppDeps {
  service: NotificationService;
  /** Check responses against the spec too. Used in tests. */
  validateResponses?: boolean;
}

export function createApp({ service, validateResponses = false }: AppDeps): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ verify: requireUtf8 }));
  app.use(
    OpenApiValidator.middleware({
      apiSpec: specPath,
      validateRequests: { allErrors: true }, // report every problem, not just the first
      validateResponses,
    }),
  );

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  // Major version of info.version in openapi.yaml; test/contract.test.ts keeps them in step.
  app.use('/v0', notificationRoutes(service));

  app.use(errorHandler);
  return app;
}
