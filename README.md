# Sign-in with ChatGPT DevKit

Add Sign in with ChatGPT to apps that run on a user's local machine. Includes a Node.js SDK, React components, and a desktop example.

| Folder | Contents |
| --- | --- |
| [`packages/local`](packages/local) | OAuth, credential storage, account profiles, model discovery, and streaming Responses. |
| [`packages/react`](packages/react) | Sign-in button, connection status, usage links, and recovery UI. |
| [`assets`](assets) | Figma-exported ChatGPT marks and icons, plus locally bundled fonts. |
| [`examples/component-gallery`](examples/component-gallery) | Interactive previews of component variants and connection states. |
| [`examples/paste-perfect`](examples/paste-perfect) | A native macOS paste menu with an Electron settings dashboard. |

## Run Paste Perfect

Requires macOS 13 or later, Node.js 22.12 or later, and Xcode Command Line Tools.

```sh
npm ci
npm run build
npm start
```

Sign in with ChatGPT from the dashboard and grant Accessibility access to the native helper. Copy text, focus an editable field in another app, press **⌘⇧Space**, then right-click within eight seconds. Choose Spreadsheet, Message, Translate, Checklist, Clean up, or a saved recipe.

Paste Perfect transforms the copied text and pastes the result into the destination app. The Electron dashboard manages accounts, settings, recipes, and activity. The example currently supports text on macOS; compatibility varies by destination app.

OAuth credentials stay in the local Node process. Paste Perfect encrypts the saved connection state using Electron `safeStorage`; on macOS, its encryption key is protected by Keychain. Storage fails closed if OS encryption is unavailable. The React components receive connection state and callbacks, never tokens. See [credential storage and application boundaries](docs/security.md) for migration behaviour and limitations.

React components include their default visual assets. Import `@siwc/react/styles.css` once in your app; `@siwc/react/tokens.css` exposes the component tokens separately. See [design assets](assets/README.md) for usage and attribution. OpenAI marks are subject to the [OpenAI brand guidelines](https://openai.com/brand/). Bundled Inter and Open Sans fonts include their licence files; SF Pro uses the system font on Apple platforms and falls back on other platforms.

## Component gallery

```sh
npm run dev:gallery
```

Open the local URL printed by Vite to inspect buttons, connection cards, usage indicators, usage actions, and recovery cards and dialogs. The gallery uses simulated state and makes no authentication or API requests. It labels Figma reference designs separately from added interaction and recovery states.

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

A custom licence for this repository is pending. First-party package metadata is marked `UNLICENSED` until that licence is provided. Third-party fonts and dependencies retain their own licences; see [third-party notices](THIRD_PARTY_NOTICES.md) and the [dependency inventory](docs/dependency-inventory.json). OpenAI trademarks remain subject to the [OpenAI brand guidelines](https://openai.com/brand/).
