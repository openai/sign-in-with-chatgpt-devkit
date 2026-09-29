import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { NativeIntegrationState, Recipe } from '../shared.js';

export interface NativeInvocation {
  type: 'invoke';
  id: string;
  recipeId: string;
  text: string;
  targetLanguage?: string;
  targetApp: string;
}

export type NativeEvent =
  | NativeInvocation
  | { type: 'status'; available: boolean; accessibilityGranted: boolean; armed: boolean; message?: string }
  | { type: 'dashboard' }
  | { type: 'result_ready'; id?: string; copied?: boolean }
  | { type: 'pasted' | 'cancelled'; id?: string }
  | { type: 'error'; id?: string; message: string };

function isEvent(value: unknown): value is NativeEvent {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  switch (v.type) {
    case 'status': return typeof v.available === 'boolean' && typeof v.accessibilityGranted === 'boolean' && typeof v.armed === 'boolean' && (v.message === undefined || typeof v.message === 'string');
    case 'dashboard': return true;
    case 'result_ready': return (v.id === undefined || typeof v.id === 'string') && (v.copied === undefined || typeof v.copied === 'boolean');
    case 'pasted': case 'cancelled': return v.id === undefined || typeof v.id === 'string';
    case 'error': return typeof v.message === 'string' && (v.id === undefined || typeof v.id === 'string');
    case 'invoke': return typeof v.id === 'string' && /^[A-Za-z0-9-]{1,80}$/.test(v.id)
      && typeof v.recipeId === 'string' && v.recipeId.length <= 100
      && typeof v.text === 'string' && v.text.length <= 60_000
      && typeof v.targetApp === 'string' && v.targetApp.length <= 300
      && (v.targetLanguage === undefined || typeof v.targetLanguage === 'string' && v.targetLanguage.length <= 80);
    default: return false;
  }
}

/** Private transport: credentials never enter the helper; clipboard content never enters the renderer. */
export class NativePaste {
  private child: ChildProcessWithoutNullStreams | undefined;
  private buffer = '';
  private stopping = false;

  constructor(private readonly executable: string, private readonly onEvent: (event: NativeEvent) => void) {}

  static initialState(): NativeIntegrationState {
    return {
      supported: process.platform === 'darwin', available: false, accessibilityGranted: false, armed: false,
      message: process.platform === 'darwin' ? 'Starting native paste…' : 'Native paste is currently available on macOS.',
    };
  }

  start(): void {
    if (process.platform !== 'darwin' || this.child) return;
    this.stopping = false;
    const child = spawn(this.executable, [], { stdio: 'pipe' });
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      if (this.buffer.length > 1_000_000) { this.fail('The native helper returned an invalid response.'); this.stop(); return; }
      let newline: number;
      while ((newline = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        try {
          const event: unknown = JSON.parse(line);
          if (isEvent(event)) this.onEvent(event);
        } catch { /* Ignore non-protocol output without exposing clipboard content. */ }
      }
    });
    // Drain diagnostics without putting native state or clipboard data in logs.
    child.stderr.resume();
    child.stdin.on('error', () => this.fail('The native paste helper disconnected. Restart Paste Perfect.'));
    child.on('error', () => this.fail('The native paste helper could not start. Run npm run build and reopen Paste Perfect.'));
    child.on('exit', () => {
      if (this.child === child) this.child = undefined;
      if (!this.stopping) this.fail('The native paste helper stopped. Restart Paste Perfect.');
    });
  }

  configure(recipes: Recipe[], connected: boolean): void {
    if (this.child) this.send({ type: 'configure', recipes: recipes.map(({ id, name }) => ({ id, name })), connected });
  }

  send(command: Record<string, unknown>): boolean {
    if (!this.child?.stdin.writable) { this.fail('Native paste is not available. Check its setup in the dashboard.'); return false; }
    try { this.child.stdin.write(`${JSON.stringify(command)}\n`); return true; }
    catch { this.fail('The native paste helper disconnected. Restart Paste Perfect.'); return false; }
  }

  stop(): void {
    this.stopping = true;
    const child = this.child;
    this.child = undefined;
    if (child) { child.stdin.end(); child.kill(); }
  }

  private fail(message: string): void {
    if (!this.stopping) this.onEvent({ type: 'status', available: false, accessibilityGranted: false, armed: false, message });
  }
}
