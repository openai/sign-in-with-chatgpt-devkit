import { ArrowRight, Check, Clipboard, Clock3, Feather, FileText, Keyboard, Languages, ListChecks, LoaderCircle, MousePointer2, MousePointerClick, Plus, Settings2, ShieldCheck, Sparkles, Table2, WandSparkles } from 'lucide-react';
import type { AppState, Recipe } from '../shared';
import { isBrowserPreview } from './bridge';

const recipeIcons = { spreadsheet: Table2, message: FileText, translate: Languages, checklist: ListChecks, cleanup: WandSparkles };
type ActivityEntry = NonNullable<AppState['activity']>[number];

export function shortcutLabel(shortcut: string) {
  return shortcut.replace(/CommandOrControl|CmdOrCtrl|Command|Cmd/g, '⌘').replace(/Control|Ctrl/g, '⌃').replace(/Shift/g, '⇧').replace(/Alt|Option/g, '⌥').replaceAll('+', ' ');
}

export function Overview({ state, onViewActivity, onSettings }: { state: AppState; onViewActivity: () => void; onSettings: () => void }) {
  const activity = state.activity ?? [];
  const pasted = activity.filter(entry => entry.status === 'pasted').length;
  const nativeReady = state.native.available && state.native.accessibilityGranted;
  return <>
    <div className="page-heading"><div><div className="eyebrow">A LITTLE LESS FRICTION</div><h2>Stay right where you are.</h2><p>Turn what you copied into what you need. In the app you’re already using.</p></div><span className="hero-mark"><Sparkles size={28} strokeWidth={1.3} /></span></div>
    <section className="how-it-works" aria-label="How to use Paste Perfect">
      <div className="how-header"><h3>Your next paste, upgraded.</h3><span>NO TRIP TO A CHAT WINDOW</span></div>
      <div className="workflow-steps">
        <div><span className="workflow-icon"><Clipboard size={20} /></span><strong>Copy text</strong><span>From any app</span></div><ArrowRight size={14} className="workflow-arrow" />
        <div><span className="workflow-icon"><MousePointer2 size={20} /></span><strong>Focus a destination</strong><span>Click where you’ll paste</span></div><ArrowRight size={14} className="workflow-arrow" />
        <div><button className="workflow-key" onClick={onSettings} title="Change keyboard shortcut"><kbd>{shortcutLabel(state.settings.shortcut)}</kbd></button><strong>Press your shortcut</strong><span>Arm the next right-click</span></div><ArrowRight size={14} className="workflow-arrow" />
        <div><span className="workflow-icon"><MousePointerClick size={20} /></span><strong>Right-click</strong><span>Open Paste Perfect</span></div><ArrowRight size={14} className="workflow-arrow" />
        <div><span className="workflow-icon final-step"><Sparkles size={20} /></span><strong>Choose a recipe</strong><span>Transform and paste</span></div>
      </div>
      <p className="invocation-note">Text is sent to ChatGPT only after you choose a recipe.</p>
    </section>
    <div className="summary-cards">
      <button className="summary-card" onClick={onViewActivity}><span><Check size={15} />PASTES SENT THIS SESSION</span><strong>{pasted}<small>{pasted === 1 ? 'paste sent' : 'pastes sent'}</small></strong></button>
      <div className="summary-card"><span><Feather size={15} />AT YOUR FINGERTIPS</span><strong>{state.recipes.length}<small>{state.recipes.length === 1 ? 'recipe' : 'recipes'}</small></strong></div>
      <div className="summary-card"><span><Keyboard size={15} />NATIVE INTEGRATION</span><strong className="native-summary-value">{state.native.armed ? 'Armed' : nativeReady ? 'Enabled' : 'Needs setup'}<small>{isBrowserPreview ? 'desktop app required' : nativeReady ? 'ready for your right-click' : 'finish setup below'}</small></strong></div>
    </div>
  </>;
}

export function NativeSetup({ native, enabling, onEnable }: { native: AppState['native']; enabling: boolean; onEnable: () => void }) {
  const ready = native.available && native.accessibilityGranted;
  if (ready) return <div className={`native-ready-banner ${native.armed ? 'armed-banner' : ''}`} role="status"><span className="ready-check"><Check size={15} /></span><div><strong>{native.armed ? 'Your next right-click opens Paste Perfect.' : 'Native paste is enabled.'}</strong><p>{native.armed ? 'Right-click in the app where you want to paste, then choose a recipe.' : 'Copy text, focus your destination, press the shortcut, then right-click.'}</p></div></div>;
  const unavailable = isBrowserPreview || !native.supported;
  return <section className="native-setup"><div className="setup-icon"><ShieldCheck size={23} strokeWidth={1.5} /></div><div className="setup-copy"><h3>{isBrowserPreview ? 'Native paste lives in the desktop app.' : !native.supported ? 'Native paste is available on macOS.' : 'Let Paste Perfect work in your apps.'}</h3><p>{isBrowserPreview ? 'Use the desktop app for the global shortcut and right-click menu. This preview can manage recipes.' : !native.supported ? 'Recipes and account settings are available here. The native paste menu currently requires macOS.' : 'Accessibility access lets Paste Perfect show its menu and paste into the app you choose.'}</p>{native.message && <p className="native-message">{native.message}</p>}</div>{!unavailable && <button className="primary-button" onClick={onEnable} disabled={enabling}>{enabling ? <LoaderCircle size={15} className="spin" /> : <ShieldCheck size={15} />}{enabling ? 'Opening setup…' : 'Enable native paste'}</button>}</section>;
}

export function ActivityList({ activity, compact = false }: { activity: ActivityEntry[]; compact?: boolean }) {
  if (!activity.length) return <div className={`empty-activity ${compact ? 'compact' : ''}`}><span className="empty-activity-icon"><Clock3 size={22} strokeWidth={1.3} /></span><div><strong>Your next paste starts the story.</strong><p>Choose a recipe from the native menu. You’ll see its status here.</p></div><span className="empty-activity-detail">No activity this session</span></div>;
  return <div className="activity-list" role="list" aria-label="Native paste activity">{activity.map(entry => {
    const status = { running: 'Transforming', pasted: 'Paste sent', ready: 'Ready to paste', copied: 'Copied', error: 'Failed', cancelled: 'Cancelled' }[entry.status];
    return <article className="activity-row" role="listitem" key={entry.id}><span className={`activity-symbol ${entry.status}`}>{entry.status === 'running' ? <LoaderCircle size={16} className="spin" /> : entry.status === 'pasted' ? <Check size={16} /> : <Clipboard size={16} />}</span><div className="activity-description"><strong>{entry.recipeName}</strong><span>{entry.targetApp || 'Destination app'}{entry.error ? ` · ${entry.error}` : ''}</span></div><span className={`activity-status ${entry.status}`}>{status}</span><time dateTime={new Date(entry.startedAt).toISOString()}>{new Date(entry.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></article>;
  })}</div>;
}

export function RecipeLibrary({ recipes, onEdit, onCreate }: { recipes: Recipe[]; onEdit: (recipe: Recipe) => void; onCreate: () => void }) {
  return <>
    <div className="section-heading"><div><h3>Made for everyday things</h3><p>Five built-in recipes, available in your paste menu.</p></div><span className="count-label">BUILT IN</span></div>
    <div className="builtin-recipes">{recipes.filter(recipe => recipe.builtin).map(recipe => {
      const Icon = recipeIcons[recipe.id as keyof typeof recipeIcons] ?? Feather;
      return <div className="builtin-recipe" key={recipe.id}><span><Icon size={20} strokeWidth={1.6} /></span><div><strong>{recipe.name}</strong><p>{recipe.description}</p></div></div>;
    })}</div>
    <div className="section-heading recipes-heading"><div><h3>Your recipes</h3><p>Instructions that work the way you do.</p></div></div>
    <div className="custom-recipes">{recipes.filter(recipe => !recipe.builtin).map(recipe => <button className="custom-recipe" key={recipe.id} onClick={() => onEdit(recipe)}><div className="custom-recipe-title"><span className="recipe-feather"><Feather size={20} /></span><Settings2 size={16} /></div><strong>{recipe.name}</strong><p>{recipe.instruction}</p><span className="recipe-edit-label">Edit recipe <ArrowRight size={13} /></span></button>)}<button className="new-recipe-card" onClick={onCreate}><Plus size={22} strokeWidth={1.4} /><strong>Make your own</strong><span>A little instruction you can use again.</span></button></div>
  </>;
}
