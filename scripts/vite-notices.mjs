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
        let source;
        try {
          source = readFileSync(new URL(`../${fileName}`, import.meta.url), 'utf8');
        } catch (error) {
          // A first-party licence is pending; third-party notices remain required.
          if (fileName === 'LICENSE' && error.code === 'ENOENT') continue;
          throw error;
        }
        this.emitFile({
          type: 'asset',
          fileName,
          source,
        });
      }
    },
  };
}
