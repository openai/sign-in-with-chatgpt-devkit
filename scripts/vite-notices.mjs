import { readFileSync } from 'node:fs';

// Vite follows CSS font URLs but does not copy adjacent licence files.
/** @returns {import('vite').Plugin} */
export function includeThirdPartyNotices() {
  return {
    name: 'include-third-party-notices',
    apply: 'build',
    generateBundle() {
      for (const fileName of [
        'LICENSE',
        'THIRD_PARTY_NOTICES.md',
        'docs/dependency-inventory.json',
        'assets/fonts/inter-OFL.txt',
        'assets/fonts/open-sans-OFL.txt',
      ]) {
        const source = readFileSync(new URL(`../${fileName}`, import.meta.url), 'utf8');
        this.emitFile({
          type: 'asset',
          fileName,
          source,
        });
      }
    },
  };
}
