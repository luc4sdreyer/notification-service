import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { specPath } from '../src/app.js';
import { setup, validBody } from './helpers.js';

// Read with regexes so the check needs no YAML parser dependency.
const spec = readFileSync(specPath, 'utf8');
const major = spec.match(/^info:\n(?:\s+.*\n)*?\s+version:\s*['"]?(\d+)\./m)?.[1];
const paths = [...spec.matchAll(/^ {2}(\/\S*):\s*$/gm)].map((m) => m[1]!);
const unversioned = new Set(['/health']);

describe('API versioning', () => {
  it('prefixes every API path with the major version of info.version', () => {
    expect(major).toBeDefined();
    const apiPaths = paths.filter((p) => !unversioned.has(p));
    expect(apiPaths.length).toBeGreaterThan(0);
    for (const path of apiPaths) {
      expect(path).toMatch(new RegExp(`^/v${major}/`));
    }
  });

  it('serves the API under that prefix and nowhere else', async () => {
    const { app } = setup();

    const versioned = await request(app).post(`/v${major}/notifications`).send(validBody);
    const unprefixed = await request(app).post('/notifications').send(validBody);

    expect(versioned.status).toBe(202);
    expect(unprefixed.status).toBe(404);
    expect(unprefixed.headers['content-type']).toMatch(/^application\/problem\+json/);
  });
});
