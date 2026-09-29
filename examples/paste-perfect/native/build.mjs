import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, cpSync, rmSync, readdirSync, openSync, readSync, closeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { createPackage, getRawHeader } from '@electron/asar';
import { flipFuses, FuseVersion, FuseV1Options } from '@electron/fuses';
import { embedAsarIntegrity } from './asar-integrity.mjs';

if (process.platform !== 'darwin') {
  console.log('Paste Perfect native context menus are available on macOS.');
  process.exit(0);
}

if (Number(execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim().split('.')[0]) < 14) {
  throw new Error('Native Paste Perfect requires macOS 14 or later for enforced library constraints.');
}
const architecture = process.arch === 'arm64' ? 'arm64' : 'x86_64';
const require = createRequire(import.meta.url);
const directory = dirname(fileURLToPath(import.meta.url));
const example = dirname(directory);
const app = join(directory, 'build', 'PastePerfectNative.app');
const contents = join(app, 'Contents');
const executable = join(contents, 'MacOS', 'PastePerfectNative');
const source = join(directory, 'PastePerfectNative.swift');
const plist = join(directory, 'Info.plist');
const stamp = join(directory, 'build', '.source-hash');
const electron = require('electron');
const electronApp = dirname(dirname(dirname(electron)));
const hash = createHash('sha256');
function hashTree(path) {
  for (const item of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = join(path, item.name);
    if (item.isDirectory()) hashTree(file);
    else { hash.update(file); hash.update(readFileSync(file)); }
  }
}
hashTree(join(example, 'dist'));
hashTree(join(example, 'dist-electron'));
for (const file of [source, plist, fileURLToPath(import.meta.url), join(directory, 'desktop.entitlements.plist'), require.resolve('electron/package.json'), require.resolve('@electron/asar'), require.resolve('@electron/fuses'), join(directory, 'asar-integrity.mjs'), join(directory, 'build-desktop.mjs'), join(dirname(electronApp), 'LICENSE'), join(dirname(electronApp), 'LICENSES.chromium.html'), join(example, '../../THIRD_PARTY_NOTICES.md')]) hash.update(readFileSync(file));
const digest = hash.update(process.arch).digest('hex');

// An unchanged sealed build keeps its ad-hoc identity and Accessibility consent.
if (!process.argv.includes('--force') && existsSync(executable) && existsSync(stamp) && readFileSync(stamp, 'utf8') === digest) {
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  console.log(executable);
  process.exit(0);
}
rmSync(app, { recursive: true, force: true });
mkdirSync(join(contents, 'MacOS'), { recursive: true });
copyFileSync(plist, join(contents, 'Info.plist'));
const notices = join(contents, 'Resources', 'ThirdPartyNotices');
mkdirSync(notices, { recursive: true });
for (const name of ['LICENSE', 'LICENSES.chromium.html']) copyFileSync(join(dirname(electronApp), name), join(notices, name));
copyFileSync(join(example, '../../THIRD_PARTY_NOTICES.md'), join(notices, 'THIRD_PARTY_NOTICES.md'));
execFileSync('xcrun', ['swiftc', '-swift-version', '5', '-O', '-target', `${architecture}-apple-macosx14.0`,
  '-module-cache-path', join(directory, 'build', 'ModuleCache'),
  '-framework', 'AppKit', '-framework', 'ApplicationServices', '-framework', 'CoreGraphics', '-framework', 'Security', source, '-o', executable], { stdio: 'inherit' });

const desktop = join(contents, 'Frameworks', 'Paste Perfect Desktop.app');
mkdirSync(dirname(desktop), { recursive: true });
cpSync(electronApp, desktop, { recursive: true, verbatimSymlinks: true });
// This development example has no autoUpdater integration. Do not include its
// independently launchable installer tool in the privileged app's package.
rmSync(join(desktop, 'Contents/Frameworks/Squirrel.framework/Versions/A/Resources/ShipIt'), { force: true });
const resources = join(desktop, 'Contents', 'Resources');
rmSync(join(resources, 'default_app.asar'), { force: true });
const staging = join(directory, 'build', 'desktop-source');
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
cpSync(join(example, 'dist'), join(staging, 'dist'), { recursive: true });
cpSync(join(example, 'dist-electron'), join(staging, 'dist-electron'), { recursive: true });
writeFileSync(join(staging, 'package.json'), JSON.stringify({ name: 'paste-perfect', productName: 'Paste Perfect', version: '0.1.0', type: 'module', main: 'dist-electron/main.js' }));
const asar = join(resources, 'app.asar');
await createPackage(staging, asar);
const asarHash = createHash('sha256').update(getRawHeader(asar).headerString).digest('hex');
const desktopPlist = join(desktop, 'Contents', 'Info.plist');
execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleIdentifier com.openai.siwc.paste-perfect.desktop', desktopPlist]);
execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleName Paste Perfect', desktopPlist]);
const integrity = { 'Resources/app.asar': { algorithm: 'SHA256', hash: asarHash } };
execFileSync('/usr/bin/plutil', ['-replace', 'ElectronAsarIntegrity', '-json', JSON.stringify(integrity), desktopPlist]);
await flipFuses(desktop, {
  version: FuseVersion.V1,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  [FuseV1Options.WasmTrapHandlers]: false,
  strictlyRequireAllFuses: true,
});
embedAsarIntegrity(desktop, integrity);
// Ad-hoc signatures have no Team ID. Replace Electron's Team-ID matching
// with a stricter kernel-enforced allowlist of the exact bundled libraries.
// https://developer.apple.com/documentation/security/applying-launch-environment-and-library-constraints
const entitlements = join(directory, 'desktop.entitlements.plist');
const machos = [];
function machoKind(path) {
  const descriptor = openSync(path, 'r');
  const header = Buffer.alloc(32);
  try {
    if (readSync(descriptor, header, 0, 32, 0) < 4) return undefined;
    const magic = header.readUInt32BE(0);
    if (![0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca].includes(magic)) return undefined;
    if ([0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca].includes(magic)) {
      const little = [0xbebafeca, 0xbfbafeca].includes(magic);
      const fat64 = [0xcafebabf, 0xbfbafeca].includes(magic);
      const read32 = (buffer, offset) => little ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
      const slices = read32(header, 4);
      if (slices < 1 || slices > 64) throw new Error('Invalid universal Mach-O header.');
      let found = false;
      for (let index = 0; index < slices; index++) {
        const entry = Buffer.alloc(fat64 ? 32 : 20);
        if (readSync(descriptor, entry, 0, entry.length, 8 + index * entry.length) !== entry.length) throw new Error('Truncated Mach-O header.');
        if (read32(entry, 0) !== (architecture === 'arm64' ? 0x0100000c : 0x01000007)) continue;
        const offset = fat64 ? Number(little ? entry.readBigUInt64LE(8) : entry.readBigUInt64BE(8)) : read32(entry, 8);
        if (!Number.isSafeInteger(offset) || readSync(descriptor, header, 0, 32, offset) !== 32) throw new Error('Invalid Mach-O slice.');
        found = true;
        break;
      }
      if (!found) throw new Error('A bundled Mach-O does not contain the target architecture.');
    }
    const thinMagic = header.readUInt32BE(0);
    if (![0xfeedfacf, 0xcffaedfe].includes(thinMagic)) throw new Error('Unsupported Mach-O slice.');
    const type = thinMagic === 0xcffaedfe ? header.readUInt32LE(12) : header.readUInt32BE(12);
    const kind = { 2: 'EXECUTE', 6: 'DYLIB', 8: 'BUNDLE' }[type];
    if (!kind) throw new Error('Unrecognized packaged Mach-O file type.');
    return kind;
  } finally { closeSync(descriptor); }
}
const frameworks = [];
const apps = [];
function collectCode(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      collectCode(child);
      if (entry.name.endsWith('.framework')) frameworks.push(child);
      if (entry.name.endsWith('.app')) apps.push(child);
    } else if (entry.isFile()) {
      const kind = machoKind(child);
      if (!kind) continue;
      // Non-app tools (currently crashpad) retain full hardened library
      // validation; only system libraries are allowed in their load commands.
      if (kind === 'EXECUTE' && !child.includes('/Contents/MacOS/')) {
        const links = execFileSync('/usr/bin/otool', ['-arch', architecture, '-L', child], { encoding: 'utf8' }).trim().split('\n').slice(1);
        if (links.some(line => !/^\s+\/(?:System\/Library|usr\/lib)\//.test(line))) throw new Error('A standalone native tool depends on a non-system library.');
      }
      machos.push({ path: child, kind });
    }
  }
}
collectCode(desktop);
for (const code of machos) execFileSync('codesign', ['--force', '--sign', '-', '--options', 'runtime', '--timestamp=none', code.path], { stdio: 'inherit' });
for (const framework of frameworks) execFileSync('codesign', ['--force', '--sign', '-', '--options', 'runtime', '--timestamp=none', framework], { stdio: 'inherit' });
const hashes = machos.filter(code => code.kind !== 'EXECUTE').map(code => {
  const result = spawnSync('codesign', ['--display', '--verbose=4', '--arch', architecture, code.path], { encoding: 'utf8' });
  const hash = result.stderr.match(/^CDHash=([a-f0-9]{40})$/m)?.[1];
  if (result.status !== 0 || !hash) throw new Error('Could not read a packaged library code hash.');
  return hash;
});
if (!hashes.length) throw new Error('The desktop library allowlist is empty.');
const constraint = join(directory, 'build', 'desktop-libraries.coderequirement');
writeFileSync(constraint, '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>cdhash</key><dict><key>$in</key><array>' +
  [...new Set(hashes)].sort().map(hash => '<data>' + Buffer.from(hash, 'hex').toString('base64') + '</data>').join('') + '</array></dict></dict></plist>');
execFileSync('codesign', ['--validate-constraint', constraint], { stdio: 'inherit' });
for (const consumer of [...apps, desktop]) {
  execFileSync('codesign', ['--force', '--sign', '-', '--options', 'runtime', '--entitlements', entitlements,
    '--library-constraint', constraint, '--enforce-constraint-validity', '--timestamp=none', consumer], { stdio: 'inherit' });
}
execFileSync('codesign', ['--force', '--sign', '-', '--options', 'runtime', '--identifier', 'com.openai.siwc.paste-perfect.native', '--timestamp=none', app], { stdio: 'inherit' });
execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
execFileSync(executable, ['--verify-bundle'], { stdio: 'inherit' });
writeFileSync(stamp, digest);
rmSync(staging, { recursive: true, force: true });
console.log(executable);
