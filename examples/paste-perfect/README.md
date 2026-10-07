# Paste Perfect

Paste Perfect transforms copied text using the selected ChatGPT account. It pastes the completed result into another app. See the [repository setup](../../README.md#running-the-example-paste-perfect-app-with-sign-in-with-chatgpt) and [native packaging notes](native/README.md) to build and run it on macOS.

## Responses with the OpenAI SDK

The [Electron main process](electron/main.ts) manages sign-in and passes each recipe to [transformAndSend](electron/transform.ts). That function calls `chatgpt.streamResponse` from `@siwc/local`. The [DevKit implementation](../../packages/local/src/responses.ts) uses the official [OpenAI Node SDK](https://github.com/openai/openai-node) to send and read the stream. It calls `client.responses.create` with `stream: true`, sending `POST https://api.openai.com/v1/responses`.

The DevKit refreshes the selected account's OAuth token before each request as needed. No Platform API key is required. Tokens stay in the main process and never reach the renderer or native paste helper. Requests use `store: false`.

Only a `response.completed` event allows the result to reach native paste. Partial, interrupted, failed, or cancelled responses are not pasted. The original-text recipe skips the API and sends the copied text unchanged.

Run `npm test` from the repository root to check this path with synthetic credentials and streamed responses. These tests do not call the live API or use the clipboard.
