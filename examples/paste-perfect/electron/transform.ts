import type { ChatGPTClient } from '@siwc/local';
import type { NativeInvocation, NativePaste } from './native.js';

export async function transformAndSend(
  chatgpt: ChatGPTClient,
  native: Pick<NativePaste, 'send'>,
  input: NativeInvocation,
  options: { model: string; instructions: string; signal: AbortSignal },
): Promise<void> {
  // @siwc/local uses the OpenAI Node SDK with the selected account's refreshed
  // OAuth token. It resolves only after response.completed; never paste deltas.
  const result = input.recipeId === 'original'
    ? { text: input.text }
    : await chatgpt.streamResponse({ ...options, input: input.text });
  if (options.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  if (!result.text.trim() || result.text.length > 500_000) throw new Error('Empty or oversized result');
  if (!native.send({ type: 'result', id: input.id, text: result.text })) throw new Error('Native paste unavailable');
}
