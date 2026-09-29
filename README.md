# Sign in with ChatGPT DevKit

Add Sign in with ChatGPT to apps that run on a user's local machine. The DevKit includes a Node.js SDK, React components, and Paste Perfect, a macOS example app that transforms copied text and pastes the result into another app.

Users can sign in with their ChatGPT account and, when eligible and with their permission, use their ChatGPT plan to power your app's AI features.

## Resources

- **[Developer documentation](https://developers.openai.com/siwc)** — Integration options, availability, authentication, ChatGPT plan usage, and UI guidelines.
- **[Paste Perfect cookbook](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)** — A walkthrough of adding Sign in with ChatGPT to a local app using this DevKit.
- **[Sign in with ChatGPT for users](https://learn.chatgpt.com/docs/sign-in-with-chatgpt)** — How sign-in and ChatGPT plan usage work, including user controls.
- **[Interest form](https://openai.com/form/sign-in-with-chatgpt-interest/)** — Tell us what you're building and request access.

## What's included

| Folder | Contents |
| --- | --- |
| [`packages/local`](packages/local) | OAuth, credential storage, account profiles, model discovery, and streaming Responses. |
| [`packages/react`](packages/react) | Sign-in button, connection status, usage links, and recovery UI. |
| [`assets`](assets) | Figma-exported ChatGPT marks and icons, plus locally bundled fonts. |
| [`examples/component-gallery`](examples/component-gallery) | Interactive previews of component variants and connection states. |
| [`examples/paste-perfect`](examples/paste-perfect) | A native macOS paste menu with an Electron settings dashboard. |

## Run Paste Perfect

Requires macOS 14 or later, Node.js 22.12 or later, and Xcode Command Line Tools.

```sh
git clone https://github.com/openai/sign-in-with-chatgpt-devkit.git
cd sign-in-with-chatgpt-devkit
npm ci
npm run build
npm start
```

1. Sign in with ChatGPT from the dashboard.
2. Enable native paste and grant Accessibility access to the native helper.
3. Copy text, focus an editable field in another app, press **⌘⇧Space**, then right-click within eight seconds.
4. Choose Spreadsheet, Message, Translate, Checklist, Clean up, or a saved recipe.

The result is pasted into the destination app. Use the Electron dashboard to manage accounts, settings, recipes, and activity. Paste Perfect currently supports text on macOS; compatibility varies by destination app.

## Use the DevKit in your app

Start with the [cookbook](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt) and [Paste Perfect's implementation](examples/paste-perfect) to connect the SDK and components to your app. The packages are included as local workspaces in this repository.

Run `@siwc/local` in your local Node process and supply an OS-backed credential encryption provider. Paste Perfect uses [Electron `safeStorage`](examples/paste-perfect/electron/credential-encryption.ts); on macOS, its encryption key is protected by Keychain. Storage fails closed if OS encryption is unavailable. The React components receive connection state and callbacks, never tokens. See [credential storage and application boundaries](docs/security.md) for migration behaviour and limitations.

Import `@siwc/react/styles.css` once in your app to load the components' default styles and visual assets. Use `@siwc/react/tokens.css` for the component tokens separately. See the [UI/UX guidelines](https://developers.openai.com/siwc/ui-ux-guidelines) for sign-in and usage controls, and [design assets](assets/README.md) for asset usage and attribution.

## Component gallery

```sh
npm run dev:gallery
```

Open the local URL printed by Vite to explore sign-in buttons, connection cards, usage controls, and recovery states. The gallery uses simulated state and makes no authentication or API requests. It labels Figma reference designs separately from added interaction and recovery states.

Optional comparison images can be placed in `examples/component-gallery/public/references/`. This directory is ignored by Git and excluded from production builds.

## Development

```sh
npm run typecheck
npm test
npm run licenses:check
npm run build
```

Use `npm run dev:web` to preview the React dashboard in a browser. Native clipboard actions require the desktop app.

For an opt-in credential-storage test using real Electron OS encryption and synthetic data, see [runtime verification](docs/security.md#verification).

After changing dependencies or bundled font files, run `npm ci` and `npm run licenses:generate`, then review the updated notices and inventory.

External pull requests are not accepted; see [contribution policy](CONTRIBUTING.md).

## Licence

OpenAI-authored code and documentation are licensed under the [Sign-in with ChatGPT DevKit Noncommercial License v1.0](LICENSE). Third-party fonts and dependencies retain their own licences; see [third-party notices](THIRD_PARTY_NOTICES.md) and the [dependency inventory](docs/dependency-inventory.json). OpenAI trademarks remain subject to the [OpenAI brand guidelines](https://openai.com/brand/).

Bundled Inter and Open Sans fonts include their licence files. SF Pro uses the system font on Apple platforms and falls back on other platforms.
