import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

if (process.platform !== 'darwin') {
  console.log('Paste Perfect native context menus are available on macOS.');
  process.exit(0);
}

const directory = dirname(fileURLToPath(import.meta.url));
const app = join(directory, 'build', 'PastePerfectNative.app');
const contents = join(app, 'Contents');
const executable = join(contents, 'MacOS', 'PastePerfectNative');
const source = join(directory, 'PastePerfectNative.swift');
const plist = join(directory, 'Info.plist');
const stamp = join(directory, 'build', '.source-hash');
const digest = createHash('sha256').update(readFileSync(source)).update(readFileSync(plist))
  .update(readFileSync(fileURLToPath(import.meta.url))).update(process.arch).digest('hex');

// Avoid needless re-signing: Accessibility consent is tied to the built helper.
if (!process.argv.includes('--force') && existsSync(executable) && existsSync(stamp) && readFileSync(stamp, 'utf8') === digest) {
  console.log(executable);
  process.exit(0);
}
mkdirSync(join(contents, 'MacOS'), { recursive: true });
copyFileSync(plist, join(contents, 'Info.plist'));
execFileSync('xcrun', ['swiftc', '-swift-version', '5', '-O', '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx13.0`,
  '-module-cache-path', join(directory, 'build', 'ModuleCache'),
  '-framework', 'AppKit', '-framework', 'ApplicationServices', '-framework', 'CoreGraphics', source, '-o', executable], { stdio: 'inherit' });
execFileSync('codesign', ['--force', '--sign', '-', '--identifier', 'com.openai.siwc.paste-perfect.native', '--timestamp=none', app], { stdio: 'inherit' });
writeFileSync(stamp, digest);
console.log(executable);
