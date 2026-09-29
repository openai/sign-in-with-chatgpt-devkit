import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const version = process.platform === 'darwin'
  ? spawnSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).stdout.trim() : '';
const enabled = process.platform === 'darwin' && Number(version.split('.')[0]) >= 14;

test('macOS enforces exact library hashes with the Team-ID validation exception', { skip: !enabled }, async (suite) => {
  const directory = mkdtempSync(join(tmpdir(), 'paste-perfect-library-constraint-'));
  suite.after(() => rmSync(directory, { recursive: true, force: true }));
  const architecture = process.arch === 'arm64' ? 'arm64' : 'x86_64';
  suite.diagnostic(`Runtime proof on macOS ${version}, ${architecture}; no GUI or Accessibility permission used.`);
  const run = (command, args) => spawnSync(command, args, { encoding: 'utf8', timeout: 30_000 });
  const successful = (command, args) => {
    const result = run(command, args);
    assert.equal(result.status, 0, `${command} failed: ${result.error ?? result.stderr}`);
    return result;
  };
  const signing = ['--force', '--sign', '-', '--timestamp=none'];
  const hashOf = (path) => {
    const result = successful('/usr/bin/codesign', ['--display', '--verbose=4', '--arch', architecture, path]);
    const hash = result.stderr.match(/^CDHash=([a-f0-9]{40})$/m)?.[1];
    assert.ok(hash, 'The selected architecture must have a code directory hash');
    return hash;
  };

  const source = join(directory, 'library.c');
  const allowed = join(directory, 'allowed.dylib');
  const different = join(directory, 'different.dylib');
  const resigned = join(directory, 'resigned.dylib');
  for (const [path, value] of [[allowed, 42], [different, 7]]) {
    writeFileSync(source, `int answer(void) { return ${value}; }\n`);
    successful('/usr/bin/xcrun', ['clang', '-arch', architecture, '-mmacosx-version-min=14.0', '-dynamiclib', source, '-o', path]);
    successful('/usr/bin/codesign', [...signing, path]);
  }
  copyFileSync(allowed, resigned);
  successful('/usr/bin/codesign', [...signing, '--identifier', 'unrelated-library-identity', resigned]);
  const allowedHash = hashOf(allowed);
  const differentHash = hashOf(different);
  const resignedHash = hashOf(resigned);
  assert.notEqual(differentHash, allowedHash);
  assert.notEqual(resignedHash, allowedHash);
  suite.diagnostic(`Allowed CDHash=${allowedHash}; different CDHash=${differentHash}; re-signed CDHash=${resignedHash}`);
  for (const path of [allowed, different, resigned]) successful('/usr/bin/codesign', ['--verify', '--strict', path]);

  const loaderSource = join(directory, 'loader.c');
  const loader = join(directory, 'loader');
  writeFileSync(loaderSource, `#include <dlfcn.h>\n#include <stdio.h>\n
int main(int argc, char **argv) {
  if (argc != 2) return 64;
  void *library = dlopen(argv[1], RTLD_NOW);
  if (!library) { fprintf(stderr, "LOAD_REJECTED: %s\\n", dlerror()); return 70; }
  int (*answer)(void) = (int (*)(void))dlsym(library, "answer");
  if (!answer) return 71;
  printf("ANSWER=%d\\n", answer());
  dlclose(library);
  return 0;
}\n`);
  successful('/usr/bin/xcrun', ['clang', '-arch', architecture, '-mmacosx-version-min=14.0', loaderSource, '-o', loader]);
  const entitlements = join(directory, 'entitlements.plist');
  writeFileSync(entitlements, '<plist version="1.0"><dict><key>com.apple.security.cs.disable-library-validation</key><true/></dict></plist>');
  const constraint = join(directory, 'libraries.coderequirement');
  writeFileSync(constraint, '<plist version="1.0"><dict><key>cdhash</key><dict><key>$in</key><array><data>' +
    Buffer.from(allowedHash, 'hex').toString('base64') + '</data></array></dict></dict></plist>');
  successful('/usr/bin/codesign', ['--validate-constraint', constraint]);
  successful('/usr/bin/codesign', [...signing, '--options', 'runtime', '--entitlements', entitlements,
    '--library-constraint', constraint, '--enforce-constraint-validity', loader]);
  successful('/usr/bin/codesign', ['--verify', '--strict', loader]);

  await suite.test('the running loader has hardened runtime and the explicit validation exception', () => {
    const signature = successful('/usr/bin/codesign', ['--display', '--verbose=6', loader]);
    assert.match(signature.stderr, /flags=.*runtime/);
    assert.match(signature.stderr, /Has Library Load Constraints/);
    const entitlement = successful('/usr/bin/codesign', ['--display', '--entitlements', '-', '--xml', loader]);
    assert.match(entitlement.stdout, /<key>com\.apple\.security\.cs\.disable-library-validation<\/key>\s*<true\s*\/>/);
    suite.diagnostic(signature.stderr.split('\n').filter(line => /flags=|[Cc]onstraint/.test(line)).join('; '));
  });
  await suite.test('the exact allowed ad-hoc signed library loads successfully', () => {
    const result = successful(loader, [allowed]);
    assert.equal(result.stdout, 'ANSWER=42\n');
  });
  for (const [name, path] of [['different valid signed code', different], ['identical code re-signed with another identity', resigned]]) {
    await suite.test(`${name} is rejected by the library constraint`, () => {
      const result = run(loader, [path]);
      assert.equal(result.status, 70, result.stderr);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /LOAD_REJECTED:/);
      // macOS 26.7 spells "constraint" as "contraint" in this kernel diagnostic.
      const reason = result.stderr.match(/Library violates process' library load cons?traint/i)?.[0];
      assert.ok(reason, result.stderr);
      suite.diagnostic(`${name}: exit=${result.status}; ${reason}`);
    });
  }
});
