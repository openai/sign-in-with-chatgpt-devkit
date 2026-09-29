import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BUILTIN_RECIPES, INITIAL_CUSTOM_RECIPES,
  type AppSettings, type Recipe, type RecipeInput,
} from '../shared.js';

interface Preferences {
  version: 1;
  settings: AppSettings;
  recipes: Recipe[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  model: 'gpt-5.6-sol',
  shortcut: 'CommandOrControl+Shift+Space',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requiredText(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`${name} must contain between 1 and ${maxLength.toLocaleString()} characters.`);
  }
  return value.trim();
}

export class PreferenceStore {
  private value: Preferences = {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    recipes: structuredClone(INITIAL_CUSTOM_RECIPES),
  };
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly directory: string) {}

  async load(): Promise<void> {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(join(this.directory, 'preferences.json'), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new Error('Saved recipes could not be read. The existing preferences file has been preserved.');
    }
    if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.settings) || !Array.isArray(raw.recipes)) {
      throw new Error('Saved recipes use an unsupported format. The existing preferences file has been preserved.');
    }
    const settings = {
      model: requiredText(raw.settings.model, 'Model', 100),
      shortcut: requiredText(raw.settings.shortcut, 'Shortcut', 100),
    };
    const ids = new Set(BUILTIN_RECIPES.map((recipe) => recipe.id));
    const recipes = raw.recipes.map((recipe: unknown): Recipe => {
      if (!isRecord(recipe)) throw new Error('A saved recipe has an invalid format.');
      const id = requiredText(recipe.id, 'Recipe ID', 100);
      if (ids.has(id)) throw new Error('Saved recipes contain duplicate identifiers.');
      ids.add(id);
      return {
        id, name: requiredText(recipe.name, 'Recipe name', 64),
        instruction: requiredText(recipe.instruction, 'Recipe instructions', 4000),
        builtin: false,
      };
    });
    this.value = { version: 1, settings, recipes };
  }

  get settings(): AppSettings { return { ...this.value.settings }; }
  get recipes(): Recipe[] { return structuredClone([...BUILTIN_RECIPES, ...this.value.recipes]); }

  saveRecipe(input: RecipeInput): Promise<void> {
    if (!isRecord(input)) throw new Error('Recipe details are required.');
    const name = requiredText(input.name, 'Recipe name', 64);
    const instruction = requiredText(input.instruction, 'Recipe instructions', 4000);
    const id = input.id === undefined ? randomUUID() : requiredText(input.id, 'Recipe ID', 100);
    if (BUILTIN_RECIPES.some((recipe) => recipe.id === id)) throw new Error('Built-in recipes cannot be changed.');
    return this.commit((current) => {
      if (input.id !== undefined && !current.recipes.some((recipe) => recipe.id === id)) {
        throw new Error('The recipe no longer exists.');
      }
      if (input.id === undefined && current.recipes.length >= 100) throw new Error('You can save up to 100 custom recipes.');
      const recipes = current.recipes.filter((recipe) => recipe.id !== id);
      recipes.push({ id, name, instruction, builtin: false });
      return { ...current, recipes };
    });
  }

  deleteRecipe(id: string): Promise<void> {
    requiredText(id, 'Recipe ID', 100);
    if (BUILTIN_RECIPES.some((recipe) => recipe.id === id)) throw new Error('Built-in recipes cannot be deleted.');
    return this.commit((current) => ({ ...current, recipes: current.recipes.filter((recipe) => recipe.id !== id) }));
  }

  updateSettings(input: Partial<AppSettings>): Promise<void> {
    if (!isRecord(input)) throw new Error('Settings are required.');
    const changes: Partial<AppSettings> = {};
    if (input.model !== undefined) changes.model = requiredText(input.model, 'Model', 100);
    if (input.shortcut !== undefined) changes.shortcut = requiredText(input.shortcut, 'Shortcut', 100);
    return this.commit((current) => ({ ...current, settings: { ...current.settings, ...changes } }));
  }

  private commit(update: (current: Preferences) => Preferences): Promise<void> {
    // Publish changes only after the atomic replacement succeeds.
    const write = this.writes.then(async () => {
      const next = update(this.value);
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const path = join(this.directory, 'preferences.json');
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
        await rename(temporary, path);
        this.value = next;
      } finally {
        await unlink(temporary).catch(() => {});
      }
    });
    this.writes = write.catch(() => {});
    return write;
  }
}
