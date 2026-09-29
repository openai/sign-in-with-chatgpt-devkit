import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const check = process.argv.includes('--check');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const lockBytes = await readFile(new URL('package-lock.json', root));
const lock = JSON.parse(lockBytes);
const compare = ([a], [b]) => a < b ? -1 : a > b ? 1 : 0;
const entries = Object.entries(lock.packages).sort(compare);
const noticeFiles = new Map();
const noticeSections = [];

// The non-dev lockfile entries are the workspace runtime dependency closure.
// Vite can emit runtime helpers; retain its complete upstream notice file too.
// Electron's package licence is recorded separately from its binary licences.
for (const [path, entry] of entries) {
  if (!path.includes('node_modules/') || entry.link) continue;
  if (entry.dev && path !== 'node_modules/vite' && path !== 'node_modules/electron') continue;
  const directory = new URL(`${path}/`, root);
  let pkg;
  try {
    pkg = JSON.parse(await readFile(new URL('package.json', directory), 'utf8'));
  } catch (cause) {
    throw new Error(`Run npm ci before generating notices: ${path} is missing.`, { cause });
  }
  if (pkg.version !== entry.version) {
    throw new Error(`${path} is ${pkg.version}, but package-lock.json specifies ${entry.version}. Run npm ci.`);
  }
  const filenames = (await readdir(directory, { withFileTypes: true }))
    .filter((file) => file.isFile() && /^(licen[cs]e|notice|copying)([.-]|$)/i.test(file.name))
    .map((file) => file.name).sort();
  if (!filenames.length) throw new Error(`No top-level licence/notice file found for ${path}; review it before release.`);
  const files = [];
  const body = [];
  for (const filename of filenames) {
    const content = await readFile(new URL(filename, directory));
    files.push({ path: `${path}/${filename}`, sha256: sha256(content) });
    body.push(`### ${filename}\n\n\`\`\`text\n${content.toString('utf8').trimEnd()}\n\`\`\``);
  }
  noticeFiles.set(path, files);
  const repository = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  noticeSections.push(`## ${pkg.name} ${entry.version}\n\nDeclared licence: ${entry.license ?? 'not specified'}.\n\nPackage: ${entry.resolved}\n\n${repository ? `Upstream repository (package metadata): ${repository}\n\n` : ''}${body.join('\n\n')}`);
}

const { fonts: fontInputs, ...fontSource } = JSON.parse(
  await readFile(new URL('assets/fonts/provenance.json', root), 'utf8'),
);
if (sha256(await readFile(new URL(fontSource.cssSelectionSnapshot, root))) !== fontSource.cssSelectionSha256) {
  throw new Error('The recorded Google Fonts CSS selection has changed; review its provenance.');
}
const fonts = [];
for (const font of fontInputs) {
  const fontBytes = await readFile(new URL(font.path, root));
  const licenceBytes = await readFile(new URL(font.licensePath, root));
  if (sha256(fontBytes) !== font.sha256 || fontBytes.length !== font.bytes) {
    throw new Error(`${font.path} differs from its recorded upstream download; review its provenance.`);
  }
  if (sha256(licenceBytes) !== font.licenseSha256) {
    throw new Error(`${font.licensePath} differs from its recorded upstream licence; review its provenance.`);
  }
  fonts.push(font);
  noticeSections.push(`## ${font.name} font\n\nBundled file: \`${font.path}\`.\n\nInternal version: ${font.fontVersion}. Google Fonts distribution version: ${font.distributionVersion}. Subset: ${font.subset}; style: ${font.style}; weight range: ${font.axes.find((axis) => axis.tag === 'wght').minimum}–${font.axes.find((axis) => axis.tag === 'wght').maximum}.\n\nDownloaded on ${font.downloadedOn} from ${font.downloadUrl}\n\nSHA-256: \`${font.sha256}\`.\n\nUpstream family metadata: ${font.googleFontsMetadataUrl}\n\nExact licence source: ${font.licenseUrl}\n\nLicence SHA-256: \`${font.licenseSha256}\`.\n\n${font.modifications}\n\n### ${font.licensePath}\n\n\`\`\`text\n${licenceBytes.toString('utf8').trimEnd()}\n\`\`\``);
}

const inventory = {
  schemaVersion: 1,
  source: 'package-lock.json',
  lockfileVersion: lock.lockfileVersion,
  lockfileSha256: sha256(lockBytes),
  scope: 'All lockfile entries, including workspaces and platform-specific optional dependencies. Declared licences are upstream metadata, not legal clearance. Full notice text is included for runtime dependencies, Vite, the Electron npm package, and bundled fonts.',
  electronBinaryScope: 'The Electron npm package MIT licence does not cover all code in an Electron/Chromium binary. Before distributing a packaged desktop application, preserve the licences shipped in that exact Electron distribution, including LICENSE and LICENSES.chromium.html, and review any additional bundled components.',
  packages: entries.map(([path, entry]) => ({
    path,
    name: entry.name ?? (path.includes('node_modules/') ? path.split('node_modules/').at(-1) : null),
    version: entry.version ?? null,
    declaredLicense: entry.license ?? null,
    resolved: entry.resolved ?? null,
    integrity: entry.integrity ?? null,
    workspaceLink: entry.link ?? false,
    developmentOnly: entry.dev ?? false,
    optional: entry.optional ?? false,
    os: entry.os ?? [],
    cpu: entry.cpu ?? [],
    dependencies: entry.dependencies ?? {},
    optionalDependencies: entry.optionalDependencies ?? {},
    peerDependencies: entry.peerDependencies ?? {},
    includedNoticeFiles: noticeFiles.get(path) ?? [],
  })),
  fontSource,
  fonts,
};

const header = `# Third-party notices

Generated by \`node scripts/generate-third-party-notices.mjs\` from the committed lockfile, installed packages, and committed font licence files. Run \`npm ci\` first. Use \`--check\` to check that the generated files are current.

This file preserves full top-level licence and notice text for the runtime npm dependency closure, Vite (which can emit runtime helpers), the Electron npm package, and the bundled fonts. Some packages may not appear in every build. [The dependency inventory](docs/dependency-inventory.json) records all lockfile entries, including development tools and platform-specific optional dependencies. Its declared licence fields are upstream metadata, not a completed legal review. Additional notices bundled within Vite's upstream licence file are preserved verbatim.

The Inter and Open Sans files remain under SIL OFL 1.1. They are unchanged downloads from the versioned Google Fonts CDN URLs recorded below, with SHA-256 hashes, download dates, internal versions, and licence sources pinned to a Google Fonts Git commit. The dependency inventory also contains the CSS request, subset, axes, and upstream family metadata. The generator checks the recorded font, licence, and CSS selection hashes. This provenance record does not establish Legal or Design clearance. The React package and both Vite builds retain these notices and the separate OFL files.

The OpenAI and ChatGPT names, marks, and exported product designs are not licensed by this third-party notice file. This file does not grant trademark rights or establish clearance for those assets or the Paste Perfect name. Follow the applicable OpenAI brand terms and obtain the required release clearances.

## Electron distribution scope

This release contains source, not a packaged Electron application. The MIT licence of the Electron npm package is included below; it is not a complete licence inventory for the Electron/Chromium binary downloaded during installation. Before distributing a desktop binary, retain the licence files shipped with that exact Electron distribution, including \`LICENSE\` and \`LICENSES.chromium.html\`, and review all other packaged components. The source dependency inventory does not complete that binary-distribution review.
`;

const outputs = [
  ['THIRD_PARTY_NOTICES.md', `${header}\n${noticeSections.join('\n\n')}\n`],
  ['docs/dependency-inventory.json', `${JSON.stringify(inventory, null, 2)}\n`],
];
for (const [path, expected] of outputs) {
  const url = new URL(path, root);
  if (check) {
    const actual = await readFile(url, 'utf8').catch(() => null);
    if (actual !== expected) throw new Error(`${path} is stale. Run node scripts/generate-third-party-notices.mjs.`);
  } else {
    await mkdir(new URL('./', url), { recursive: true });
    await writeFile(url, expected);
  }
  console.log(`${check ? 'Verified' : 'Generated'} ${fileURLToPath(url)}`);
}
