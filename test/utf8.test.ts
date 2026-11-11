import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Notification } from '../src/domain/notification.js';
import type { ChannelSender } from '../src/ports/channelSender.js';
import { setup, validBody } from './helpers.js';

const path = '/v0/notifications';

/** Sends raw bytes. supertest's send() would turn a Buffer into a JSON object. */
function postRaw(app: Parameters<typeof request>[0], body: Buffer, contentType = 'application/json') {
  const req = request(app).post(path).set('Content-Type', contentType);
  req.write(body);
  return req;
}

describe('UTF-8 input', () => {
  it('delivers non-ASCII text unchanged', async () => {
    const sent: Notification[] = [];
    const capture: ChannelSender = { send: async (n) => void sent.push(n) };
    const { app, dispatcher } = setup(capture);
    const message = 'Grüße, 你好, مرحبا, 🎉👍🏽';
    const recipient = 'jürgen@bücher.de';

    const res = await request(app).post(path).send({ ...validBody, recipient, message });
    await dispatcher.drain();

    expect(res.status).toBe(202);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ recipient, message });
  });

  // JSON Schema counts code points: one per emoji, though each is two UTF-16 units and four bytes.
  it('counts maxLength in code points', async () => {
    const { app } = setup();

    const atLimit = await request(app).post(path).send({ ...validBody, message: '🎉'.repeat(1000) });
    const overLimit = await request(app).post(path).send({ ...validBody, message: '🎉'.repeat(1001) });

    expect(atLimit.status).toBe(202);
    expect(overLimit.status).toBe(400);
    expect(overLimit.body.errors).toEqual([{ path: '/body/message', message: expect.stringContaining('1000') }]);
  });

  it.each([
    ['no-break space', '  '],
    ['ideographic space', '　'],
    ['byte order mark', '﻿'],
  ])('rejects a message of only %s', async (_label, message) => {
    const { app } = setup();
    const res = await request(app).post(path).send({ ...validBody, message });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ path: '/body/message', message: expect.any(String) }]);
  });

  it.each([
    ['a truncated sequence', [0xc3, 0x28]],
    ['a byte that never occurs in UTF-8', [0xff, 0xfe]],
  ])('rejects a body containing %s with 400', async (_label, bytes) => {
    const { app } = setup();
    const body = Buffer.concat([
      Buffer.from('{"recipient":"user@example.com","channel":"email","message":"x'),
      Buffer.from(bytes),
      Buffer.from('"}'),
    ]);

    const res = await postRaw(app, body);

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.body.detail).toBe('Request body is not valid UTF-8');
  });

  it.each(['utf-16le', 'iso-8859-1'])('rejects charset=%s with 415', async (charset) => {
    const { app } = setup();
    const json = JSON.stringify(validBody);
    const body = Buffer.from(json, charset === 'utf-16le' ? 'utf16le' : 'latin1');

    const res = await postRaw(app, body, `application/json; charset=${charset}`);

    expect(res.status).toBe(415);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
  });
});
