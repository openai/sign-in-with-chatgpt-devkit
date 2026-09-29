import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  console.error('Paste Perfect native paste is available on macOS. Use npm run dev:web for the dashboard preview.');
  process.exit(1);
}
if (Number(execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim().split('.')[0]) < 14) {
  console.error('Paste Perfect native paste requires macOS 14 or later.');
  process.exit(1);
}
// The native app launches the sealed Electron dashboard. No caller-supplied
// arguments or stdin are forwarded to the privileged command channel.
const executable = fileURLToPath(new URL('./build/PastePerfectNative.app/Contents/MacOS/PastePerfectNative', import.meta.url));
const child = spawn(executable, [], { stdio: ['ignore', 'ignore', 'inherit'] });
child.on('error', () => { console.error('Run npm run build before starting Paste Perfect.'); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
