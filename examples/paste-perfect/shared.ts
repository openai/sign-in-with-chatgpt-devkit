import type { ChatGPTModel, LoginProfile, SessionError, SessionState } from '@siwc/local';

export interface Recipe {
  id: string;
  name: string;
  description?: string;
  instruction: string;
  builtin: boolean;
}

export interface AppSettings {
  model: string;
  shortcut: string;
}

export interface AppError extends SessionError {}

export interface NativeIntegrationState {
  supported: boolean;
  available: boolean;
  accessibilityGranted: boolean;
  armed: boolean;
  message?: string;
}

export interface ActivityEntry {
  id: string;
  profileId?: string;
  recipeName: string;
  targetApp: string;
  status: 'running' | 'pasted' | 'ready' | 'copied' | 'error' | 'cancelled';
  startedAt: number;
  completedAt?: number;
  error?: string;
  errorCode?: string;
  errorDetails?: AppError;
}

export interface AppState {
  session: SessionState;
  profiles: LoginProfile[];
  accountBusy: boolean;
  modelCatalog: {
    status: 'idle' | 'loading' | 'ready' | 'error';
    models: ChatGPTModel[];
    error?: AppError;
  };
  recipes: Recipe[];
  settings: AppSettings;
  native: NativeIntegrationState;
  activity: ActivityEntry[];
  notice?: string;
}

export interface RecipeInput {
  id?: string;
  name: string;
  instruction: string;
}

export interface TransformInput {
  recipeId: string;
  text: string;
  targetLanguage?: string;
}

export interface PastePerfectBridge {
  getState(): Promise<AppState>;
  cancelTransform(): Promise<void>;
  armPasteMenu(): Promise<void>;
  enableNativeIntegration(): Promise<void>;
  signIn(): Promise<void>;
  addAccount(): Promise<void>;
  resumeSignIn(id: string): Promise<void>;
  selectProfile(id: string): Promise<void>;
  reconnectSharing(): Promise<void>;
  refreshModels(): Promise<void>;
  cancelSignIn(): Promise<void>;
  disconnect(): Promise<void>;
  openUsage(): Promise<void>;
  saveRecipe(input: RecipeInput): Promise<void>;
  deleteRecipe(id: string): Promise<void>;
  updateSettings(settings: Partial<AppSettings>): Promise<void>;
  onState(callback: (state: AppState) => void): () => void;
}

export const MAX_INPUT_LENGTH = 60_000;

export const BUILTIN_RECIPES: Recipe[] = [
  {
    id: 'spreadsheet', name: 'Spreadsheet', builtin: true,
    description: 'Messy text → clean rows and columns',
    instruction: 'Convert the supplied text into a clean tab-separated table that can be pasted into a spreadsheet. Infer useful column headings and include one header row. Use literal tabs between columns and newlines between rows. Preserve dates, times, names, and links. Leave missing values empty. Do not invent information. Return only the table, with no Markdown fences or explanation.',
  },
  {
    id: 'message', name: 'Message', builtin: true,
    description: 'Rough notes → a ready-to-send message',
    instruction: 'Turn the supplied notes into a concise, friendly, ready-to-send workplace message. Preserve the facts, names, links, and intent. Use short paragraphs or bullets when useful. Do not invent commitments or details. Return only the message.',
  },
  {
    id: 'translate', name: 'Translate', builtin: true,
    description: 'Another language, the same meaning',
    instruction: 'Translate the supplied text into the requested target language. Preserve names, URLs, line breaks, list structure, and technical identifiers. Keep the original meaning and tone. Return only the translated text.',
  },
  {
    id: 'checklist', name: 'Checklist', builtin: true,
    description: 'Long emails → clear next steps',
    instruction: 'Extract actionable tasks from the supplied text as a concise checklist. Begin each item with [ ]. Preserve assignees and deadlines when explicitly stated. Do not invent tasks, owners, or deadlines. If there are no actionable tasks, say so briefly. Return only the checklist.',
  },
  {
    id: 'cleanup', name: 'Clean up', builtin: true,
    description: 'Inconsistent formatting → a clean finish',
    instruction: 'Clean up the formatting of the supplied text. Standardize whitespace, bullets, capitalization, and unambiguous dates consistently. Preserve names, addresses, URLs, meaning, and all facts. Do not guess ambiguous dates or add information. Return only the cleaned text.',
  },
];

export const INITIAL_CUSTOM_RECIPES: Recipe[] = [{
  id: 'weekly-update', name: 'My weekly update', builtin: false,
  description: 'Shipped, next, blocked',
  instruction: 'Turn these notes into three sections: shipped, next, blocked. Keep it under 150 words. Preserve the facts and do not invent progress, plans, or blockers.',
}];
