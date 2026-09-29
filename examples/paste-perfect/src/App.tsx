import { useEffect, useState } from 'react';
import { Activity, CheckCheck, Clipboard, Feather, FlaskConical, House, LoaderCircle, MoreHorizontal, Plus, Settings2, UserRound, X } from 'lucide-react';
import { ChatGPTConnectionCard, ChatGPTManageUsageButton, ChatGPTRecoveryDialog, ChatGPTRecoveryNotice, ChatGPTUsageCallout, ChatGPTUsageIndicator, type ChatGPTRecoveryKind } from '@siwc/react';
import type { AppState, Recipe } from '../shared';
import { bridge, isBrowserPreview } from './bridge';
import { RecipeEditor } from './RecipeEditor';
import { SettingsModal } from './SettingsModal';
import { ActivityList, NativeSetup, Overview, RecipeLibrary } from './Dashboard';

type Page = 'home' | 'recipes' | 'activity' | 'account';
const pages = [
  { id: 'home', name: 'Home', icon: House },
  { id: 'recipes', name: 'Recipes', icon: Feather },
  { id: 'activity', name: 'Activity', icon: Activity },
  { id: 'account', name: 'Account', icon: UserRound },
] as const;

function recoveryKind(state: AppState): ChatGPTRecoveryKind | undefined {
  if (state.session.status === 'reauth_required') return 'reauth_required';
  if (state.session.status === 'connected' && !state.session.sharing) return 'sharing_declined';
  if (state.session.status !== 'connected') return undefined;
  const latest = state.activity.filter(entry => entry.profileId === state.session.profileId).sort((a, b) => b.startedAt - a.startedAt)[0];
  const code = state.session.error?.code ?? (latest?.status === 'error' ? latest.errorCode : undefined) ?? '';
  if (code === 'subscription_sharing_usage_limit_exceeded') return 'usage_limit';
  return undefined;
}

function usageLimitKey(state: AppState): string | undefined {
  if (recoveryKind(state) !== 'usage_limit') return undefined;
  const sessionRequestId = state.session.error?.requestId;
  const failure = state.activity
    .filter(entry => entry.profileId === state.session.profileId
      && entry.status === 'error'
      && entry.errorCode === 'subscription_sharing_usage_limit_exceeded'
      && (!sessionRequestId || entry.errorDetails?.requestId === sessionRequestId))
    .sort((a, b) => b.startedAt - a.startedAt)[0];
  const requestId = sessionRequestId ?? failure?.errorDetails?.requestId;
  return `${state.session.profileId ?? 'current'}:${requestId ?? failure?.id ?? 'usage-limit'}`;
}

export default function App() {
  const [state, setState] = useState<AppState>();
  const [page, setPage] = useState<Page>('home');
  const [editor, setEditor] = useState<Recipe | 'new' | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dismissedUsageLimits, setDismissedUsageLimits] = useState<Set<string>>(() => new Set());
  const [actionError, setActionError] = useState('');
  const [enabling, setEnabling] = useState(false);

  useEffect(() => {
    let disposed = false;
    const receive = (next: AppState) => { if (!disposed) setState(next); };
    const offState = bridge.onState(receive);
    void bridge.getState().then(receive).catch(error => {
      if (!disposed) setActionError(error instanceof Error ? error.message : 'Could not load Paste Perfect.');
    });
    return () => { disposed = true; offState(); };
  }, []);

  async function perform(action: () => Promise<void>) {
    setActionError('');
    try { await action(); }
    catch (error) { setActionError(error instanceof Error ? error.message : 'Something went wrong. Please try again.'); }
  }
  async function enableNative() {
    setEnabling(true);
    await perform(() => bridge.enableNativeIntegration());
    setEnabling(false);
  }
  function dismissUsageLimit(key: string) {
    setDismissedUsageLimits(previous => new Set(previous).add(key));
  }
  function reopenUsageLimit(key: string) {
    setDismissedUsageLimits(previous => {
      const next = new Set(previous);
      next.delete(key);
      return next;
    });
  }

  if (!state) return <div className="boot-state"><span className="app-mark"><Clipboard size={25} /></span><h1>Paste Perfect</h1>{actionError ? <p role="alert">{actionError}</p> : <LoaderCircle className="spin" size={20} />}</div>;

  const connected = state.session.status === 'connected' && state.session.sharing;
  const connecting = state.session.status === 'connecting';
  const currentRecovery = recoveryKind(state);
  const currentUsageLimit = usageLimitKey(state);
  const runtimeError = state.session.error;
  const title = pages.find(item => item.id === page)?.name ?? 'Home';
  const activity = [...state.activity].sort((a, b) => b.startedAt - a.startedAt);
  const nativeReady = state.native.available && state.native.accessibilityGranted;
  const activeProfile = state.profiles.find(profile => profile.id === state.session.profileId);
  const savedProfiles = state.profiles.filter(profile => !profile.pending);
  const pendingProfiles = state.profiles.filter(profile => profile.pending);
  const legacyRegistration = activeProfile?.requiresNewRegistration === true;
  const connectAccount = () => legacyRegistration ? bridge.addAccount() : state.session.status === 'connected' || state.session.status === 'reauth_required'
    ? bridge.reconnectSharing()
    : bridge.signIn();

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="app-mark"><Clipboard size={22} strokeWidth={1.7} /></span><div><h1>Paste Perfect</h1><span>A better way to paste.</span></div></div>
      <nav aria-label="Dashboard" className="main-nav">
        {pages.map(item => <button className={`nav-button ${page === item.id ? 'selected' : ''}`} key={item.id} onClick={() => setPage(item.id)} aria-current={page === item.id ? 'page' : undefined}><item.icon size={18} strokeWidth={1.7} /><span>{item.name}</span>{page === item.id && <span className="selected-dot" />}</button>)}
      </nav>
      <div className="sidebar-tip"><span className="tip-icon"><CheckCheck size={18} strokeWidth={1.5} /></span><strong>Stay in your flow.</strong><p>Paste Perfect works in the apps you already use.</p></div>
      <div className="sidebar-bottom">
        <button className="nav-button settings-nav" onClick={() => setSettingsOpen(true)}><Settings2 size={17} strokeWidth={1.7} /><span>Settings</span></button>
        <button className="account-button" onClick={() => setPage('account')}><span className="account-label"><strong>{state.session.profileLabel ?? 'ChatGPT'}</strong><span><i className={connected ? 'status-dot connected' : 'status-dot'} />{connecting ? 'Connecting…' : connected ? 'Connected' : state.session.status === 'connected' ? 'Sharing is off' : 'Not connected'}</span></span><MoreHorizontal size={18} /></button>
      </div>
    </aside>

    <main className="dashboard">
      <header className="dashboard-topbar"><span>{title}</span><div className="topbar-actions">{isBrowserPreview ? <span className="preview-label"><FlaskConical size={12} />Browser preview</span> : <span className={`native-status ${nativeReady ? 'ready' : ''}`}><i />{state.native.armed ? 'Waiting for your right-click' : nativeReady ? 'Native paste enabled' : 'Native paste needs setup'}</span>}</div></header>
      <div className="dashboard-content">
        {page === 'home' && <>
          <Overview state={state} onViewActivity={() => setPage('activity')} onSettings={() => setSettingsOpen(true)} />
          <NativeSetup native={state.native} enabling={enabling} onEnable={() => void enableNative()} />
          {(!legacyRegistration || connected) && <ConnectionSummary state={state} connected={connected} connecting={connecting} onSignIn={() => void perform(connectAccount)} onCancel={() => void perform(() => bridge.cancelSignIn())} onUsage={() => void perform(() => bridge.openUsage())} />}
          {connected && (state.modelCatalog.status !== 'ready' || !state.modelCatalog.models.length) && <p className="runtime-notice" role="status">{state.modelCatalog.status === 'loading' ? 'Loading models for your ChatGPT connection…' : 'Load your account’s models in Settings before using a recipe.'} <button className="text-button" onClick={() => setSettingsOpen(true)}>Open settings</button></p>}
          <div className="section-heading"><div><h3>Recent activity</h3><p>Native paste activity from this app session.</p></div><button className="text-button" onClick={() => setPage('activity')}>View all</button></div>
          <ActivityList activity={activity.slice(0, 4)} compact />
        </>}
        {page === 'recipes' && <>
          <div className="page-heading"><div><div className="eyebrow">MAKE IT YOURS</div><h2>A recipe for every little task.</h2><p>Your saved instructions, one right-click away.</p></div><button className="primary-button" onClick={() => setEditor('new')}><Plus size={15} />New recipe</button></div>
          <RecipeLibrary recipes={state.recipes} onEdit={setEditor} onCreate={() => setEditor('new')} />
        </>}
        {page === 'activity' && <>
          <div className="page-heading"><div><div className="eyebrow">THIS SESSION</div><h2>A little work, well done.</h2><p>See what ran and where. Copied text and results aren’t stored in this activity list.</p></div></div>
          <ActivityList activity={activity} />
        </>}
        {page === 'account' && <>
          <div className="page-heading"><div><div className="eyebrow">YOUR CONNECTION</div><h2>Your ChatGPT, across your desktop.</h2><p>Manage your account, usage, and native paste integration.</p></div></div>
          <section className="profile-picker" aria-label="Saved ChatGPT accounts">
            <div className="profile-selection"><label className="field-label" htmlFor="chatgpt-profile">Active connection</label><select id="chatgpt-profile" className="text-input" value={state.session.profileId ?? ''} disabled={state.accountBusy || !savedProfiles.length} onChange={event => void perform(() => bridge.selectProfile(event.target.value))}>
              {!state.session.profileId && <option value="">No connection selected</option>}
              {savedProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.label}{profile.identity?.email ? ` · ${profile.identity.email}` : ''}{profile.status === 'connected' ? profile.sharing ? '' : ' · sharing off' : ' · signed out'}</option>)}
            </select></div>
            <button className="secondary-button" disabled={state.accountBusy} onClick={() => void perform(() => bridge.addAccount())}><Plus size={15} />Add account</button>
          </section>
          {pendingProfiles.map(profile => <div className="pending-connection" key={profile.id}><span>{profile.label} · sign-in incomplete</span><button className="text-button" disabled={state.accountBusy} onClick={() => void perform(() => bridge.resumeSignIn(profile.id))}>Finish connection</button></div>)}
          <fieldset className="connection-actions-group" disabled={state.accountBusy}>
            <ChatGPTConnectionCard appName="Paste Perfect" status={state.session.status} sharing={state.session.sharing} {...(state.session.identity ? { identity: state.session.identity } : {})} onConnect={() => void perform(connectAccount)} onDisconnect={() => void perform(() => bridge.disconnect())} onManageUsage={() => void perform(() => bridge.openUsage())} />
          </fieldset>
          {connecting && <button className="text-button" onClick={() => void perform(() => bridge.cancelSignIn())}>Cancel sign-in</button>}
          {connected && !legacyRegistration && <button className="text-button reconnect-sharing" disabled={state.accountBusy} onClick={() => void perform(() => bridge.reconnectSharing())}>Reconnect usage sharing</button>}
          {connected && <div className="account-usage"><ChatGPTUsageIndicator source="unknown" onManageUsage={() => void perform(() => bridge.openUsage())} limitReached={currentRecovery === 'usage_limit'} limitWindow="unknown" /><ChatGPTUsageCallout onManageUsage={() => void perform(() => bridge.openUsage())} /></div>}
          <NativeSetup native={state.native} enabling={enabling} onEnable={() => void enableNative()} />
          <p className="privacy-note">Disconnecting removes the selected connection’s saved credentials. Other accounts and recipes stay on this device.</p>
        </>}
        {legacyRegistration && <div className="action-error"><span>This saved connection uses an older sign-in callback. Add an account to create an updated connection. The saved connection will remain here.</span><button className="text-button" disabled={state.accountBusy} onClick={() => void perform(() => bridge.addAccount())}>Add account</button></div>}
        {currentRecovery && (!legacyRegistration || currentRecovery === 'usage_limit') && <ChatGPTRecoveryNotice kind={currentRecovery} appName="Paste Perfect" limitWindow="unknown" busy={state.accountBusy} onPrimaryAction={() => void perform(() => currentRecovery === 'usage_limit' ? bridge.openUsage() : bridge.reconnectSharing())} {...(currentUsageLimit ? { onSecondaryAction: () => reopenUsageLimit(currentUsageLimit), secondaryActionLabel: 'View details' } : {})} />}
        {runtimeError && !currentRecovery && runtimeError.code !== 'cancelled' && <div className="action-error" role="alert"><span>{runtimeError.message}</span>{runtimeError.code === 'model_not_found' && <button className="text-button" onClick={() => setSettingsOpen(true)}>Choose model</button>}</div>}
        {actionError && <div className="action-error" role="alert"><span>{actionError}</span><button className="tiny-icon" aria-label="Dismiss message" onClick={() => setActionError('')}><X size={16} /></button></div>}
        {state.notice && <p className="runtime-notice" role="status">{state.notice}</p>}
      </div>
      <footer className="dashboard-footer"><span>PASTE PERFECT <span>·</span> AT HOME IN EVERY APP</span></footer>
    </main>

    {editor && <RecipeEditor {...(editor !== 'new' ? { recipe: editor } : {})} onSave={input => bridge.saveRecipe(input)} onDelete={id => bridge.deleteRecipe(id)} onClose={() => setEditor(null)} />}
    {settingsOpen && <SettingsModal state={state} onClose={() => setSettingsOpen(false)} />}
    {currentUsageLimit && <ChatGPTRecoveryDialog open={!dismissedUsageLimits.has(currentUsageLimit)} kind="usage_limit" appName="Paste Perfect" limitWindow="unknown" primaryActionLabel="Manage usage" onPrimaryAction={() => void perform(async () => { await bridge.openUsage(); dismissUsageLimit(currentUsageLimit); })} onDismiss={() => dismissUsageLimit(currentUsageLimit)} />}
  </div>;
}

function ConnectionSummary({ state, connected, connecting, onSignIn, onCancel, onUsage }: { state: AppState; connected: boolean; connecting: boolean; onSignIn: () => void; onCancel: () => void; onUsage: () => void }) {
  if (connected) return <div className="connection-summary connected-summary"><div className="connection-heading"><div><strong>{state.session.profileLabel ?? 'Connected with ChatGPT'}</strong><span>{state.session.identity?.email ?? 'Ready to transform the text you choose.'}</span></div></div><ChatGPTManageUsageButton appearance="secondary" onClick={onUsage} /></div>;
  if (state.session.status === 'reauth_required' || state.session.status === 'connected') return null;
  return <div className="home-connection"><ChatGPTConnectionCard appName="Paste Perfect" context="setup" status={state.session.status} sharing={state.session.sharing} onConnect={onSignIn} />{connecting && <button className="text-button" onClick={onCancel}>Cancel sign-in</button>}</div>;
}
