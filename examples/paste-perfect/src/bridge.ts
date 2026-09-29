import { BUILTIN_RECIPES, INITIAL_CUSTOM_RECIPES } from '../shared';
import type { AppState, PastePerfectBridge, Recipe, RecipeInput } from '../shared';

declare global {
  interface Window { pastePerfect?: PastePerfectBridge }
}

export const isBrowserPreview = !window.pastePerfect;

function previewBridge(): PastePerfectBridge {
  let customRecipes: Recipe[] = [...INITIAL_CUSTOM_RECIPES];
  try {
    const saved: unknown = JSON.parse(localStorage.getItem('paste-perfect-preview-recipes') ?? 'null');
    if (Array.isArray(saved) && saved.every((recipe: unknown) => typeof recipe === 'object' && recipe !== null && 'id' in recipe && 'name' in recipe && 'instruction' in recipe && typeof recipe.id === 'string' && typeof recipe.name === 'string' && typeof recipe.instruction === 'string')) {
      customRecipes = saved.map((recipe: Recipe) => ({ ...recipe, builtin: false }));
    }
  } catch { /* A fresh preview works even when browser storage is unavailable. */ }

  let state: AppState = {
    session: { status: 'disconnected', sharing: false },
    profiles: [],
    accountBusy: false,
    modelCatalog: { status: 'idle', models: [] },
    recipes: [...BUILTIN_RECIPES, ...customRecipes],
    settings: { model: '', shortcut: 'CommandOrControl+Shift+V' },
    native: { supported: false, available: false, accessibilityGranted: false, armed: false },
    activity: [],
  };
  const listeners = new Set<(next: AppState) => void>();
  const publish = () => listeners.forEach(listener => listener(structuredClone(state)));
  const saveRecipes = () => {
    localStorage.setItem('paste-perfect-preview-recipes', JSON.stringify(state.recipes.filter(recipe => !recipe.builtin)));
    publish();
  };
  const desktopOnly = async () => { throw new Error('Open the desktop app to use native paste and connect ChatGPT. This browser preview does not send requests.'); };

  return {
    getState: async () => structuredClone(state),
    cancelTransform: async () => {},
    signIn: desktopOnly,
    addAccount: desktopOnly,
    resumeSignIn: desktopOnly,
    selectProfile: desktopOnly,
    reconnectSharing: desktopOnly,
    refreshModels: desktopOnly,
    cancelSignIn: async () => {},
    disconnect: async () => {},
    openUsage: desktopOnly,
    enableNativeIntegration: desktopOnly,
    armPasteMenu: desktopOnly,
    saveRecipe: async (input: RecipeInput) => {
      const recipe: Recipe = { id: input.id ?? crypto.randomUUID(), name: input.name.trim(), instruction: input.instruction.trim(), builtin: false };
      if (input.id) state.recipes = state.recipes.map(current => current.id === input.id && !current.builtin ? recipe : current);
      else state.recipes = [...state.recipes, recipe];
      saveRecipes();
    },
    deleteRecipe: async id => { state.recipes = state.recipes.filter(recipe => recipe.builtin || recipe.id !== id); saveRecipes(); },
    updateSettings: async settings => { state = { ...state, settings: { ...state.settings, ...settings } }; publish(); },
    onState: callback => { listeners.add(callback); return () => listeners.delete(callback); },
  };
}

export const bridge = window.pastePerfect ?? previewBridge();
