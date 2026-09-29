import { useEffect, useState, type FormEvent } from 'react';
import type { AppState } from '../shared';
import { bridge, isBrowserPreview } from './bridge';
import { Modal } from './Modal';

export function SettingsModal({ state, onClose }: { state: AppState; onClose: () => void }) {
  const [model, setModel] = useState(state.settings.model);
  const [shortcut, setShortcut] = useState(state.settings.shortcut);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const catalog = state.modelCatalog;
  const canChooseModel = !state.accountBusy && catalog.status === 'ready' && catalog.models.length > 0;
  useEffect(() => { setModel(state.settings.model); }, [state.session.profileId, state.settings.model]);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await bridge.updateSettings({ ...(canChooseModel ? { model } : {}), shortcut: shortcut.trim() }); onClose(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not save settings.'); }
    finally { setBusy(false); }
  }
  async function reloadModels() {
    setError('');
    try { await bridge.refreshModels(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not load models.'); }
  }
  return <Modal title="Settings" onClose={onClose}><form onSubmit={event => void save(event)}>
    <label className="field-label" htmlFor="shortcut">Arm the paste menu</label><input id="shortcut" className="text-input" value={shortcut} onChange={event => setShortcut(event.target.value)} placeholder="CommandOrControl+Shift+V" required />
    <p className="field-hint">Press this shortcut in your destination app, then right-click to choose a recipe.</p>
    <label className="field-label" htmlFor="model">ChatGPT model{state.session.profileLabel ? ` · ${state.session.profileLabel}` : ''}</label>
    <select id="model" className="text-input" value={canChooseModel ? model : ''} onChange={event => setModel(event.target.value)} disabled={!canChooseModel}>
      {!canChooseModel && <option value="">{catalog.status === 'loading' ? 'Loading models…' : 'No models loaded'}</option>}
      {catalog.models.map(option => <option key={option.slug} value={option.slug}>{option.displayName}</option>)}
    </select>
    <p className="field-hint">{catalog.status === 'idle' ? 'Connect ChatGPT and enable usage sharing to load this account’s models.' : catalog.status === 'loading' ? 'Checking models for your selected account.' : catalog.status === 'error' ? 'Models could not be loaded. Your saved connection is still available.' : catalog.models.length === 0 ? 'This account returned no models available for display.' : 'Models are supplied by your selected ChatGPT account. A completed transformation confirms access.'}</p>
    {catalog.error && <p className="inline-error" role="alert">{catalog.error.message}</p>}
    {state.session.status === 'connected' && state.session.sharing && <button type="button" className="text-button" disabled={state.accountBusy || catalog.status === 'loading'} onClick={() => void reloadModels()}>Refresh models</button>}
    {isBrowserPreview && <p className="preview-note">Browser preview: native paste and the ChatGPT connection require the desktop app.</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}<footer className="modal-actions"><span className="flex-space" /><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button></footer>
  </form></Modal>;
}
