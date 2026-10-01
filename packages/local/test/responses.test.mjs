import assert from 'node:assert/strict';
import test from 'node:test';
import { streamResponse } from '../dist/responses.js';

const delta = (text) => ({ type: 'response.output_text.delta', delta: text });
const completed = { type: 'response.completed', response: { status: 'completed' } };
const frame = (event) => `data: ${JSON.stringify(event)}\r\n\r\n`;
const request = (options = {}, signal = new AbortController().signal) =>
  streamResponse('synthetic-oauth-token', { model: 'test-model', input: 'private clipboard text', ...options }, signal);

function sse(wire, headers = { 'content-type': 'text/event-stream', 'x-request-id': 'req_test' }) {
  return new Response(new TextEncoder().encode(wire), { headers });
}

test('streams text safely with OAuth and explicit direct-route settings, ignoring API-key environment', async (t) => {
  const ambient = {
    OPENAI_API_KEY: 'ambient-key', OPENAI_ADMIN_KEY: 'ambient-admin-key', OPENAI_BASE_URL: 'https://wrong.invalid/v1',
    OPENAI_ORG_ID: 'org-ambient', OPENAI_PROJECT_ID: 'proj-ambient', OPENAI_LOG: 'debug',
    OPENAI_CUSTOM_HEADERS: 'Authorization: Bearer header-key\nOpenAI-Organization: org-header\nOpenAI-Project: proj-header',
  };
  const previous = Object.fromEntries(Object.keys(ambient).map((key) => [key, process.env[key]]));
  Object.assign(process.env, ambient);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const logs = [];
  for (const method of ['debug', 'log', 'info', 'warn', 'error']) t.mock.method(console, method, (...args) => logs.push(args));
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url: String(url), ...init, headers: new Headers(init.headers), body: JSON.parse(init.body) });
    return sse(frame(delta('Caf')) + frame(delta('é ☕')) + frame(completed));
  });
  const deltas = [];
  assert.deepEqual(await request({ instructions: 'private recipe text', onDelta: (value) => deltas.push(value) }), { text: 'Café ☕' });
  assert.deepEqual(deltas, ['Caf', 'é ☕']);
  assert.equal(calls.length, 1);
  const sent = calls[0];
  assert.equal(sent.url, 'https://api.openai.com/v1/responses');
  assert.equal(sent.method, 'POST');
  assert.equal(sent.headers.get('authorization'), 'Bearer synthetic-oauth-token');
  assert.equal(sent.headers.get('openai-organization'), null);
  assert.equal(sent.headers.get('openai-project'), null);
  assert.equal(sent.redirect, 'error');
  assert.deepEqual(sent.body, {
    model: 'test-model', input: [{ role: 'user', content: 'private clipboard text' }],
    instructions: 'private recipe text', store: false, stream: true,
  });
  assert.deepEqual(logs, []);
});

test('accepts valid SSE without Content-Type and discards extra caller message fields', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body).input, [{ role: 'developer', content: 'Hello' }]);
    return sse(frame(delta('answer')) + frame(completed), {});
  });
  assert.deepEqual(await request({ input: [{ role: 'developer', content: 'Hello', tools: 'not allowed' }] }), { text: 'answer' });
});

for (const [name, wire, expected] of [
  ['abrupt EOF', frame(delta('partial')), { code: 'stream_interrupted', retryable: true }],
  ['done before completion', frame(delta('partial')) + 'data: [DONE]\n\n', { code: 'stream_interrupted', retryable: true }],
  ['incomplete', frame(delta('partial')) + frame({ type: 'response.incomplete' }), { code: 'response_incomplete', retryable: true }],
  ['failed', frame({ type: 'response.failed', response: { error: { code: 'model_not_found', message: 'private clipboard text' } } }),
    { code: 'model_not_found', requestId: 'req_test', retryable: false }],
  ['error event', frame({ type: 'error', code: 'subscription_sharing_usage_unavailable', message: 'private clipboard text' }),
    { code: 'subscription_sharing_usage_unavailable', requestId: 'req_test', retryable: true }],
  ['invalid JSON', 'data: {"private clipboard text"\n\n', { code: 'invalid_stream', retryable: true }],
]) {
  test(`${name} never reports success or exposes server error text`, async (t) => {
    const logs = [];
    for (const method of ['debug', 'log', 'info', 'warn', 'error']) t.mock.method(console, method, (...args) => logs.push(args));
    t.mock.method(globalThis, 'fetch', async () => sse(wire));
    await assert.rejects(request(), (error) => {
      for (const [key, value] of Object.entries(expected)) assert.equal(error[key], value);
      assert.equal(JSON.stringify(error.toJSON()).includes('private clipboard text'), false);
      return true;
    });
    assert.equal(JSON.stringify(logs).includes('private clipboard text'), false);
  });
}

test('cancellation while waiting for another event is not stream_interrupted', async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => new Response(new ReadableStream({
    start(body) {
      body.enqueue(new TextEncoder().encode(frame(delta('partial'))));
      signal.addEventListener('abort', () => body.error(new DOMException('Cancelled', 'AbortError')), { once: true });
    },
  }), { headers: { 'content-type': 'text/event-stream' } }));
  await assert.rejects(request({ onDelta: () => controller.abort() }, controller.signal), { code: 'cancelled', retryable: false });
});

test('rejects non-SSE success and cancels its body', async (t) => {
  let cancelled = false;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    cancel() { cancelled = true; },
  }), { headers: { 'content-type': 'application/json' } }));
  await assert.rejects(request(), { code: 'invalid_stream', status: 200 });
  assert.equal(cancelled, true);
});

test('HTTP admission and validation errors keep safe diagnostics and are never retried', async (t) => {
  const replies = [
    { status: 401, body: { error: 'invalid_token', error_description: 'private clipboard text' },
      expected: { code: 'invalid_token', retryable: false } },
    { status: 429, body: { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'private clipboard text' } },
      expected: { code: 'subscription_sharing_usage_limit_exceeded', retryable: false } },
    { status: 422, body: { detail: [{ loc: ['body', 'input'], type: 'list_type', input: 'private clipboard text' }] },
      expected: { code: 'api_error', retryable: false, message: 'ChatGPT requires input as a list of messages. Update the app\'s request format.' } },
    { status: 503, body: '<html>private clipboard text</html>', expected: { code: 'api_error', retryable: true } },
  ];
  let calls = 0;
  for (const { status, body, expected } of replies) {
    t.mock.method(globalThis, 'fetch', async () => {
      calls++;
      return typeof body === 'string'
        ? new Response(body, { status, headers: { 'x-request-id': 'req_safe' } })
        : Response.json(body, { status, headers: { 'x-request-id': 'req_safe' } });
    });
    await assert.rejects(request(), (error) => {
      for (const [key, value] of Object.entries({ ...expected, status, requestId: 'req_safe' })) assert.equal(error[key], value);
      assert.equal(JSON.stringify(error.toJSON()).includes('private clipboard text'), false);
      return true;
    });
  }
  assert.equal(calls, replies.length);
});
