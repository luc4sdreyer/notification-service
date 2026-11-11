import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { setup, validBody } from './helpers.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function expectProblem(res: request.Response, status: number) {
  expect(res.status).toBe(status);
  expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
  expect(res.body).toMatchObject({ type: 'about:blank', status, title: expect.any(String) });
}

function errorPaths(res: request.Response): string[] {
  return (res.body.errors ?? []).map((e: { path: string }) => e.path);
}

describe('POST /notifications', () => {
  it('accepts a valid notification with 202, a uuid, queued status and a Location header', async () => {
    const { app } = setup();
    const res = await request(app).post('/notifications').send(validBody);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ id: expect.stringMatching(UUID), status: 'queued' });
    expect(res.headers.location).toBe(`/notifications/${res.body.id}`);
  });

  it.each(['recipient', 'channel', 'message'])('rejects a body missing %s', async (field) => {
    const { app } = setup();
    const body: Record<string, string> = { ...validBody };
    delete body[field];

    const res = await request(app).post('/notifications').send(body);

    expectProblem(res, 400);
    expect(errorPaths(res)).toContain(`/body/${field}`);
  });

  it('rejects an unsupported channel', async () => {
    const { app } = setup();
    const res = await request(app).post('/notifications').send({ ...validBody, channel: 'fax' });

    expectProblem(res, 400);
    expect(errorPaths(res)).toEqual(['/body/channel']);
  });

  it.each([
    ['empty', ''],
    ['whitespace-only', '  \n\t '],
  ])('rejects an %s message', async (_label, message) => {
    const { app } = setup();
    const res = await request(app).post('/notifications').send({ ...validBody, message });

    expectProblem(res, 400);
    expect(errorPaths(res)).toContain('/body/message');
  });

  it('rejects unknown properties', async () => {
    const { app } = setup();
    const res = await request(app).post('/notifications').send({ ...validBody, priority: 'high' });

    expectProblem(res, 400);
    expect(res.body.errors).toHaveLength(1);
  });

  it('reports every problem in one response', async () => {
    const { app } = setup();
    const res = await request(app).post('/notifications').send({ channel: 'fax', message: '' });

    expectProblem(res, 400);
    expect(errorPaths(res)).toEqual(expect.arrayContaining(['/body/recipient', '/body/channel', '/body/message']));
  });

  it.each([
    ['email', 'not-an-email'],
    ['email', 'user@localhost'],
    ['sms', '0612345678'],
    ['sms', '+0123456'],
    ['push', 'token with spaces'],
  ])('rejects an invalid %s recipient %j', async (channel, recipient) => {
    const { app } = setup();
    const res = await request(app).post('/notifications').send({ ...validBody, channel, recipient });

    expectProblem(res, 400);
    expect(res.body.detail).toBe('Request validation failed');
    expect(errorPaths(res)).toEqual(['/body/recipient']);
  });

  it.each([
    ['email', 'first.last+tag@example.co.uk'],
    ['sms', '+14155550123'],
    ['push', 'fcm:APA91bH-abc_123'],
  ])('accepts a valid %s recipient %j', async (channel, recipient) => {
    const { app } = setup();
    const res = await request(app).post('/notifications').send({ ...validBody, channel, recipient });

    expect(res.status).toBe(202);
  });

  it('rejects malformed JSON with a problem response', async () => {
    const { app } = setup();
    const res = await request(app)
      .post('/notifications')
      .set('Content-Type', 'application/json')
      .send('{"recipient": ');

    expectProblem(res, 400);
    expect(res.body.detail).toBe('Malformed JSON in request body');
  });

  it('rejects a non-JSON content type with 415', async () => {
    const { app } = setup();
    const res = await request(app).post('/notifications').set('Content-Type', 'text/plain').send('hello');

    expectProblem(res, 415);
  });
});

describe('GET /notifications/{id}', () => {
  it('returns id, channel and status only', async () => {
    const { app } = setup();
    const created = await request(app).post('/notifications').send(validBody);

    const res = await request(app).get(`/notifications/${created.body.id}`);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['channel', 'id', 'status']);
    expect(res.body).toMatchObject({ id: created.body.id, channel: 'email' });
  });

  it('returns 404 for an unknown uuid', async () => {
    const { app } = setup();
    const res = await request(app).get('/notifications/6f1c2a8e-3b4d-4c5e-8f9a-0b1c2d3e4f5a');

    expectProblem(res, 404);
  });

  it('returns 400 for an id that is not a uuid', async () => {
    const { app } = setup();
    const res = await request(app).get('/notifications/123');

    expectProblem(res, 400);
    expect(errorPaths(res)).toEqual(['/params/id']);
  });
});

describe('GET /health', () => {
  it('returns ok', async () => {
    const { app } = setup();
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
