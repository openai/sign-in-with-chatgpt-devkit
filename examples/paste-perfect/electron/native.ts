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

/** Pipes are created by the sealed native parent, never by an arbitrary launcher. */
export class NativePaste {
  private started = false;
  private buffer = '';
  private stopping = false;
  private commandToken?: string;
  private pendingConfiguration?: Record<string, unknown>;

  constructor(private readonly onEvent: (event: NativeEvent) => void, private readonly onDisconnect: () => void,
    private readonly onAuthenticated: () => void = () => {}) {}

  static initialState(): NativeIntegrationState {
    return {
      supported: process.platform === 'darwin', available: false, accessibilityGranted: false, armed: false,
      message: process.platform === 'darwin' ? 'Starting native paste…' : 'Native paste is currently available on macOS.',
    };
  }

  start(): void {
    if (process.platform !== 'darwin' || this.started) return;
    if (process.env.PASTE_PERFECT_NATIVE_HOST !== '1') {
      this.fail('Open the built Paste Perfect app using npm start.');
      return;
    }
    // The marker only selects a transport. Forging it cannot connect to a
    // running native app: only the parent has the other ends of these pipes.
    this.stopping = false;
    this.started = true;
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      this.buffer += chunk;
      if (this.buffer.length > 1_000_000) { this.disconnect(); return; }
      let newline: number;
      while ((newline = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        try {
          const event: unknown = JSON.parse(line);
          if (event && typeof event === 'object' && (event as Record<string, unknown>).type === 'transport-auth') {
            const token = (event as Record<string, unknown>).token;
            if (this.commandToken || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) { this.disconnect(); return; }
            this.commandToken = token;
            if (this.pendingConfiguration) {
              this.send(this.pendingConfiguration);
              this.pendingConfiguration = undefined;
            }
            this.onAuthenticated();
            continue;
          }
          if (!this.commandToken) { this.disconnect(); return; }
          if (isEvent(event)) this.onEvent(event);
        } catch { this.disconnect(); return; }
      }
    });
    process.stdin.on('end', () => this.disconnect());
    process.stdin.on('error', () => this.disconnect());
    process.stdout.on('error', () => this.disconnect());
  }

  configure(recipes: Recipe[], connected: boolean): void {
    if (!this.started) return;
    const command = { type: 'configure', recipes: recipes.map(({ id, name }) => ({ id, name })), connected };
    if (this.commandToken) this.send(command);
    else this.pendingConfiguration = command;
  }

  send(command: Record<string, unknown>): boolean {
    if (!this.started || !this.commandToken || !process.stdout.writable) { this.fail('Native paste is not available. Check its setup in the dashboard.'); return false; }
    try { process.stdout.write(`${JSON.stringify({ ...command, token: this.commandToken })}\n`); return true; }
    catch { this.disconnect(); return false; }
  }

  stop(): void {
    this.stopping = true;
    this.started = false;
    this.commandToken = undefined;
    this.pendingConfiguration = undefined;
    process.stdin.pause();
  }

  private disconnect(): void {
    if (this.stopping) return;
    this.fail('The native app disconnected. Restart Paste Perfect.');
    this.stop();
    this.onDisconnect();
  }

  private fail(message: string): void {
    if (!this.stopping) this.onEvent({ type: 'status', available: false, accessibilityGranted: false, armed: false, message });
  }
}
