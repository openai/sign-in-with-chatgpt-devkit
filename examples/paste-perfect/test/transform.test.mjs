import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createChatGPT } from '@siwc/local';
import { ConnectionStore } from '../../../packages/local/dist/storage.js';
import { transformAndSend } from '../electron/transform.ts';

const input = { type: 'invoke', id: 'test-invocation', recipeId: 'cleanup', text: 'Copied text', targetApp: 'Test app' };
const options = { model: 'test-model', instructions: 'Clean up the text.' };
const delta = { type: 'response.output_text.delta', delta: 'Clean text' };
const completed = { type: 'response.completed', response: { status: 'completed' } };
const frame = (event) => new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'paste-perfect-transform-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // Ephemeral authenticated encryption for synthetic credentials only.
  const key = randomBytes(32);
  const credentialEncryption = {
    id: 'test-transform-aes-gcm',
    isAvailable: () => true,
    encrypt(text) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      return Buffer.concat([iv, cipher.update(text, 'utf8'), cipher.final(), cipher.getAuthTag()]);
    },
    decrypt(value) {
      const bytes = Buffer.from(value);
      const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      cipher.setAuthTag(bytes.subarray(-16));
      return Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]).toString('utf8');
    },
  };
  const store = new ConnectionStore(directory, credentialEncryption);
  await store.withLock(() => store.write({
    version: 2, activeProfileId: 'test-profile', pendingRegistrations: [],
    profiles: [{ version: 1, id: 'test-profile', label: 'Test account', clientId: 'test_client',
      status: 'connected', scopes: ['chatgpt.tokens.use.direct'], savedAt: new Date().toISOString(),
      credentials: { accessToken: 'synthetic-oauth-token', expiresAt: Date.now() + 3_600_000 } }],
  }));
  const chatgpt = createChatGPT({ appName: 'Transform Test', appId: 'transform-test', redirectPort: 0,
    storageDir: directory, credentialEncryption, openBrowser: () => assert.fail('Must not sign in during a transform') });
  const sent = [];
  const native = { send: (command) => { sent.push(command); return true; } };
  const controller = new AbortController();
  const run = (invocation = input) => transformAndSend(chatgpt, native, invocation, { ...options, signal: controller.signal });
  return { chatgpt, native, sent, controller, run };
}

test('the example sends one completed SDK response to native paste, never a partial delta', { timeout: 5_000 }, async (t) => {
  const { chatgpt, sent, run } = await fixture(t);
  const deltaRead = Promise.withResolvers();
  const streamResponse = chatgpt.streamResponse;
  // Observe the real SDK stream without replacing its request or parser.
  t.mock.method(chatgpt, 'streamResponse', (request) => streamResponse({ ...request,
    onDelta: (delta) => { request.onDelta?.(delta); deltaRead.resolve(delta); },
  }));
  let body;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(String(url), 'https://api.openai.com/v1/responses');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer synthetic-oauth-token');
    assert.deepEqual(JSON.parse(init.body), { ...options, input: [{ role: 'user', content: input.text }], store: false, stream: true });
    return new Response(new ReadableStream({ start(controller) { body = controller; controller.enqueue(frame(delta)); } }),
      { headers: { 'content-type': 'text/event-stream' } });
  });
  const result = run();
  await deltaRead.promise;
  assert.deepEqual(sent, []);
  body.enqueue(frame(completed));
  body.close();
  await result;
  assert.deepEqual(sent, [{ type: 'result', id: input.id, text: delta.delta }]);
});

for (const [name, ending, code] of [
  ['interrupted', undefined, 'stream_interrupted'],
  ['incomplete', { type: 'response.incomplete' }, 'response_incomplete'],
  ['failed', { type: 'response.failed', response: { error: { code: 'model_not_found' } } }, 'model_not_found'],
]) {
  test(`the example does not send ${name} output to native paste`, async (t) => {
    const { sent, run } = await fixture(t);
    t.mock.method(globalThis, 'fetch', async () => new Response(Buffer.concat([frame(delta), ...(ending ? [frame(ending)] : [])]),
      { headers: { 'content-type': 'text/event-stream' } }));
    await assert.rejects(run(), { code });
    assert.deepEqual(sent, []);
  });
}

test('cancelling during an SDK stream prevents native paste', { timeout: 5_000 }, async (t) => {
  const { chatgpt, controller, sent, run } = await fixture(t);
  const streamResponse = chatgpt.streamResponse;
  t.mock.method(chatgpt, 'streamResponse', (request) => streamResponse({ ...request,
    onDelta: (delta) => { request.onDelta?.(delta); controller.abort(); },
  }));
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => new Response(new ReadableStream({
    start(body) {
      body.enqueue(frame(delta));
      signal.addEventListener('abort', () => body.error(new DOMException('Cancelled', 'AbortError')), { once: true });
    },
  }), { headers: { 'content-type': 'text/event-stream' } }));
  await assert.rejects(run(), { code: 'cancelled' });
  assert.deepEqual(sent, []);
});

test('the original-text recipe bypasses the API and still honors cancellation', async (t) => {
  const { sent, controller, run } = await fixture(t);
  t.mock.method(globalThis, 'fetch', () => assert.fail('Original text must not call the API'));
  const original = { ...input, recipeId: 'original' };
  await run(original);
  assert.deepEqual(sent, [{ type: 'result', id: input.id, text: input.text }]);
  controller.abort();
  await assert.rejects(run(original), { name: 'AbortError' });
  assert.equal(sent.length, 1);
});
