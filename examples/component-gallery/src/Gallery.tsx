import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ChatGPTConnectionCard,
  ChatGPTManageUsageButton,
  ChatGPTUsageCallout,
  ChatGPTUsageIndicator,
  ContinueWithChatGPTButton,
} from '@siwc/react';
import type {
  ChatGPTConnectionStatus,
  ChatGPTLimitWindow,
  ChatGPTUsageSource,
} from '@siwc/react';

const families = [
  { id: 'buttons', title: 'Sign-in buttons', number: '01', description: 'Two labels. Two appearances. One familiar action.' },
  { id: 'connection', title: 'Connection cards', number: '02', description: 'From the first connection to reconnecting an account.' },
  { id: 'composer', title: 'Composer indicators', number: '03', description: 'Make the source of usage visible where people work.' },
  { id: 'usage', title: 'Usage access', number: '04', description: 'A consistent way to review and manage ChatGPT usage.' },
] as const;

type Family = typeof families[number]['id'];
type Action = (message: string) => void;
type SpecimenKind = 'source' | 'adapted' | 'implementation';

function initialFamily(): Family {
  const fragment = window.location.hash.slice(1);
  return families.find(({ id }) => id === fragment)?.id ?? 'buttons';
}

function Specimen({ title, detail, kind = 'source', children, surface = 'neutral' }: {
  title: string;
  detail?: string;
  kind?: SpecimenKind;
  children: ReactNode;
  surface?: 'neutral' | 'white';
}) {
  const titleId = useId();
  const status = kind === 'source' ? 'Source design' : kind === 'adapted' ? 'Adapted for integration' : 'Implementation state';
  return (
    <article className="specimen" aria-labelledby={titleId}>
      <header className="specimen__heading">
        <div><h3 id={titleId}>{title}</h3>{detail && <p>{detail}</p>}</div>
        <span className={`specimen__status specimen__status--${kind}`}>{status}</span>
      </header>
      <div className={`specimen__canvas specimen__canvas--${surface}`}>
        <div className="specimen__viewport">{children}</div>
      </div>
    </article>
  );
}

function ReferenceImage({ filename, title }: { filename: string; title: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <figure className="reference">
      <figcaption><span>Local reference</span><strong>{title}</strong></figcaption>
      {failed ? <p className="reference__missing">Reference image is not installed in this checkout.</p> :
        <img src={`${import.meta.env.BASE_URL}references/${filename}`} alt={`${title} design reference`} onError={() => setFailed(true)} />}
    </figure>
  );
}

function References({ enabled, items }: { enabled: boolean; items: [string, string][] }) {
  if (!enabled) return null;
  return <aside className="references" aria-label="Design references">{items.map(([filename, title]) => <ReferenceImage key={filename} filename={filename} title={title} />)}</aside>;
}

function ButtonGallery({ action, references }: { action: Action; references: boolean }) {
  const focusTarget = useRef<HTMLButtonElement>(null);
  return <>
    <div className="specimen-grid specimen-grid--buttons">
      {(['continue', 'sign-in'] as const).flatMap((label) => (['black', 'white'] as const).map((appearance) =>
        <Specimen key={`${label}-${appearance}`} title={`${label === 'continue' ? 'Continue' : 'Sign-in'} · ${appearance}`} detail="242 × 45 · radius 12 · mark 21">
          <ContinueWithChatGPTButton label={label} appearance={appearance} onClick={() => action(`${label === 'continue' ? 'Continue' : 'Sign-in'} with ChatGPT · ${appearance}`)} />
        </Specimen>,
      ))}
    </div>
    <Specimen title="Pending and disabled" detail="Both appearances and labels retain the same button geometry." kind="implementation">
      <div className="button-state-grid">
        {(['continue', 'sign-in'] as const).flatMap((label) => (['black', 'white'] as const).map((appearance) =>
          <div className="button-state" key={`${label}-${appearance}`}>
            <span>{label === 'continue' ? 'Continue' : 'Sign-in'} · {appearance}</span>
            <ContinueWithChatGPTButton label={label} appearance={appearance} loading />
            <ContinueWithChatGPTButton label={label} appearance={appearance} disabled />
          </div>,
        ))}
      </div>
    </Specimen>
    <Specimen title="Try the interaction" detail="Hover, hold the pointer down, or use Tab and Enter. Focus is a real browser state." kind="implementation">
      <div className="interaction-demo">
        <ContinueWithChatGPTButton ref={focusTarget} onClick={() => action('Keyboard or pointer activated Continue with ChatGPT')} />
        <button className="gallery-button gallery-button--quiet" onClick={() => focusTarget.current?.focus()}>Focus this button</button>
      </div>
    </Specimen>
    <References enabled={references} items={[["signin-buttons.png", "Four standard sign-in buttons"]]} />
  </>;
}

const connectionStates: { name: string; status: ChatGPTConnectionStatus; sharing: boolean; identity?: { name: string; email: string } }[] = [
  { name: 'Opening the browser', status: 'connecting', sharing: false },
  { name: 'Connected · plan sharing on', status: 'connected', sharing: true, identity: { name: 'Alex Morgan', email: 'alex@example.com' } },
  { name: 'Connected · plan sharing off', status: 'connected', sharing: false, identity: { name: 'Alex Morgan', email: 'alex@example.com' } },
  { name: 'Reconnect required', status: 'reauth_required', sharing: false },
  { name: 'Connected · no profile details', status: 'connected', sharing: true },
];

function ConnectionGallery({ appName, action, references }: { appName: string; action: Action; references: boolean }) {
  const connectionActions = {
    appName,
    onConnect: () => action('Connect with ChatGPT'),
    onDisconnect: () => action('Disconnect ChatGPT'),
    onManageUsage: () => action('Manage ChatGPT usage'),
  };
  return <>
    <Specimen title="Connect a ChatGPT plan" detail="Default connection prompt · 500 × 172">
      <ChatGPTConnectionCard {...connectionActions} status="disconnected" sharing={false} />
    </Specimen>
    <Specimen title="With a secondary Codex connection" detail="Continue with ChatGPT stays primary · 500 × 219">
      <ChatGPTConnectionCard {...connectionActions} status="disconnected" sharing={false} onConnectCodex={() => action('Connect through Codex')} />
    </Specimen>
    <Specimen title="During setup" detail="Connection offered alongside app setup · 577 × 180">
      <ChatGPTConnectionCard {...connectionActions} status="disconnected" sharing={false} context="setup" />
    </Specimen>
    {connectionStates.map(({ name, ...state }) => <Specimen key={name} title={name} kind="implementation">
      <ChatGPTConnectionCard {...connectionActions} {...state} />
    </Specimen>)}
    <References enabled={references} items={[["partner-connection-cards.png", "Connection cards"], ["partner-setup-card.png", "Setup connection"]]} />
  </>;
}

function ComposerGallery({ action }: { action: Action }) {
  const manageUsage = () => action('Manage ChatGPT usage from composer');
  const [source, setSource] = useState<Extract<ChatGPTUsageSource, 'plan' | 'unknown'>>('plan');
  const [limitReached, setLimitReached] = useState(false);
  const [limitWindow, setLimitWindow] = useState<ChatGPTLimitWindow>('five_hour');
  const [disabled, setDisabled] = useState(false);
  return <>
    <Specimen title="Using the ChatGPT plan" detail="Confirmed plan usage · 325 × 40" surface="white">
      <ChatGPTUsageIndicator source="plan" onManageUsage={manageUsage} />
    </Specimen>
    <Specimen title="Plan limit reached" detail="Show only the limit context supplied by the runtime." kind="adapted" surface="white">
      <ChatGPTUsageIndicator source="plan" limitReached limitWindow="weekly" onManageUsage={manageUsage} />
    </Specimen>
    <Specimen title="Unknown attribution" detail="Being connected does not establish whether a request used the ChatGPT plan." kind="implementation" surface="white">
      <ChatGPTUsageIndicator source="unknown" onManageUsage={manageUsage} />
    </Specimen>
    <Specimen title="Usage action unavailable" detail="Disabled actions remain visible in each usage state." kind="implementation" surface="white">
      <div className="specimen-stack">
        <ChatGPTUsageIndicator source="plan" disabled onManageUsage={manageUsage} />
        <ChatGPTUsageIndicator source="unknown" disabled onManageUsage={manageUsage} />
      </div>
    </Specimen>
    <div className="case-controls" aria-label="Usage indicator scenario">
      <label>Usage source<select value={source} onChange={(event) => setSource(event.target.value === 'plan' ? 'plan' : 'unknown')}><option value="plan">ChatGPT plan</option><option value="unknown">Unknown</option></select></label>
      <label>Limit window<select value={limitWindow} disabled={!limitReached} onChange={(event) => setLimitWindow(event.target.value as ChatGPTLimitWindow)}><option value="five_hour">Five-hour</option><option value="weekly">Weekly</option><option value="unknown">Not specified</option></select></label>
      <label className="checkbox-label"><input type="checkbox" checked={limitReached} onChange={(event) => setLimitReached(event.target.checked)} />Limit reached</label>
      <label className="checkbox-label"><input type="checkbox" checked={disabled} onChange={(event) => setDisabled(event.target.checked)} />Disabled action</label>
    </div>
    <Specimen title="Inspect a usage state" detail="Combine a confirmed or unknown source with the available limit context." kind="implementation" surface="white">
      <ChatGPTUsageIndicator source={source} limitReached={limitReached} limitWindow={limitWindow} disabled={disabled} onManageUsage={manageUsage} />
    </Specimen>
  </>;
}

function UsageGallery({ action, references }: { action: Action; references: boolean }) {
  const manageUsage = () => action('Manage ChatGPT usage');
  return <>
    <Specimen title="Manage usage actions" detail="Primary and secondary appearances · 123 × 28 · external icon 16">
      <div className="action-pair"><ChatGPTManageUsageButton appearance="primary" onClick={manageUsage} /><ChatGPTManageUsageButton appearance="secondary" onClick={manageUsage} /></div>
    </Specimen>
    <Specimen title="Usage-page callout" detail="650 × 52 · radius 16 · mark 24" surface="white">
      <ChatGPTUsageCallout onManageUsage={manageUsage} />
    </Specimen>
    <Specimen title="Disabled actions" kind="implementation">
      <div className="action-pair"><ChatGPTManageUsageButton appearance="primary" disabled onClick={manageUsage} /><ChatGPTManageUsageButton appearance="secondary" disabled onClick={manageUsage} /></div>
    </Specimen>
    <Specimen title="Callout with an unavailable action" kind="implementation" surface="white">
      <ChatGPTUsageCallout disabled onManageUsage={manageUsage} />
    </Specimen>
    <References enabled={references} items={[["partner-usage-callout.png", "Usage-page callout"]]} />
  </>;
}

export function Gallery() {
  const [family, setFamily] = useState<Family>(initialFamily);
  const [appName, setAppName] = useState('Paste Perfect');
  const [compact, setCompact] = useState(false);
  const [references, setReferences] = useState(false);
  const [lastAction, setLastAction] = useState('Try a component to see its action here.');
  const actionNumber = useRef(0);
  const current = families.find(({ id }) => id === family)!;
  const action: Action = (message) => setLastAction(`${++actionNumber.current}. ${message}`);
  const effectiveAppName = appName.trim() || 'Your app';

  useEffect(() => {
    const update = () => {
      const next = families.find(({ id }) => id === window.location.hash.slice(1));
      if (next) setFamily(next.id);
    };
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);

  return <div className={`gallery${compact ? ' gallery--compact' : ''}`}>
    <a className="skip-link" href="#gallery-content">Skip to components</a>
    <aside className="sidebar">
      <a className="wordmark" href="#buttons" aria-label="Sign in with ChatGPT DevKit home"><span>Sign in with ChatGPT</span><strong>DevKit</strong></a>
      <div className="sidebar__caption">Component gallery</div>
      <nav aria-label="Component families">{families.map(({ id, title, number }) => <a key={id} href={`#${id}`} aria-current={family === id ? 'page' : undefined}><span>{number}</span>{title}</a>)}</nav>
      <div className="sidebar__note"><span className="demo-dot" />Local preview<p>Synthetic states.<br />No account required.</p></div>
    </aside>
    <div className="workspace">
      <header className="workspace__header"><span>React components</span><span className="version-tag">DEVKIT / 0.1</span></header>
      <main id="gallery-content" tabIndex={-1}>
        <div className="page-heading"><span className="eyebrow">{current.number} / THE COMPONENTS</span><h1>{current.title}</h1><p>{current.description}</p></div>
        <div className="toolbar" aria-label="Preview settings">
          <label className="app-name">App name<input value={appName} onChange={(event) => setAppName(event.target.value)} placeholder="Your app" /></label>
          <div className="viewport-control"><span>Container</span><div className="segmented"><button aria-pressed={!compact} onClick={() => setCompact(false)}>Wide</button><button aria-pressed={compact} onClick={() => setCompact(true)}>320 px</button></div></div>
          <label className="checkbox-label"><input type="checkbox" checked={references} onChange={(event) => setReferences(event.target.checked)} />Compare references</label>
        </div>
        <div className="gallery-legend"><span><i className="legend-dot legend-dot--source" />Source design</span><span><i className="legend-dot legend-dot--adapted" />Adapted for integration</span><span><i className="legend-dot legend-dot--implementation" />Implementation state</span></div>
        <div className="family-content" key={family}>
          {family === 'buttons' && <ButtonGallery action={action} references={references} />}
          {family === 'connection' && <ConnectionGallery appName={effectiveAppName} action={action} references={references} />}
          {family === 'composer' && <ComposerGallery action={action} />}
          {family === 'usage' && <UsageGallery action={action} references={references} />}
        </div>
        <footer className="gallery-footer"><p>Source designs reproduce the supplied default layouts. App-name changes and narrow containers exercise integration behaviour. Hover, keyboard focus, disabled and busy states are implementation additions.</p><p>Components use Inter, Open Sans and the system font for platform-specific text. A different system font may change text measurements.</p></footer>
      </main>
      <div className="activity-bar"><span>Preview action</span><output aria-live="polite" aria-atomic="true">{lastAction}</output><span className="activity-bar__note">Nothing is sent</span></div>
    </div>
  </div>;
}
