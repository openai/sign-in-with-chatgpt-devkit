import { useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import type { Recipe, RecipeInput } from '../shared';
import { Modal } from './Modal';

export function RecipeEditor({ recipe, onSave, onDelete, onClose }: {
  recipe?: Recipe;
  onSave: (input: RecipeInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(recipe?.name ?? '');
  const [instruction, setInstruction] = useState(recipe?.instruction ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await onSave({ ...(recipe ? { id: recipe.id } : {}), name: name.trim(), instruction: instruction.trim() }); onClose(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not save the recipe.'); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!recipe) return;
    setBusy(true);
    try { await onDelete(recipe.id); onClose(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not delete the recipe.'); }
    finally { setBusy(false); }
  }
  return <Modal title={recipe ? 'Edit recipe' : 'Make it your own'} onClose={onClose}>
    <p className="modal-intro">A little instruction you can use again and again.</p>
    <form onSubmit={event => void save(event)}>
      <label className="field-label" htmlFor="recipe-name">Recipe name</label>
      <input id="recipe-name" className="text-input" placeholder="My weekly update" autoFocus required maxLength={60} value={name} onChange={e => setName(e.target.value)} />
      <label className="field-label" htmlFor="recipe-instruction">What should it do?</label>
      <textarea id="recipe-instruction" className="text-input recipe-instruction" placeholder="Turn these notes into three sections: shipped, next, blocked. Keep it under 150 words." required maxLength={4000} value={instruction} onChange={e => setInstruction(e.target.value)} />
      <p className="field-hint">Your copied text will be included automatically.</p>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <footer className="modal-actions">
        {recipe && <button type="button" className="text-button danger" disabled={busy} onClick={() => confirmDelete ? void remove() : setConfirmDelete(true)}><Trash2 size={15} />{confirmDelete ? 'Confirm delete' : 'Delete recipe'}</button>}
        <span className="flex-space" />
        <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="primary-button" disabled={busy || !name.trim() || !instruction.trim()}>{busy ? 'Saving…' : 'Save recipe'}</button>
      </footer>
    </form>
  </Modal>;
}
