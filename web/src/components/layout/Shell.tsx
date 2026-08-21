/** App chrome: sidebar on desktop, bottom nav on mobile, focus banner on top. */
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/Icon';
import { useApp } from '../../store/context';
import { blockingActive, requiredRemaining } from '../../lib/selectors';
import { formatClock } from '../../lib/time';
import { ThemeToggle } from './ThemeToggle';
import { RecoveryNotice } from './RecoveryNotice';
import { Modal } from '../ui/Modal';
import { TextInput } from '../ui/Field';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
}

/**
 * Five destinations, and no more.
 *
 * Phase 16 cut seven to six by folding Exams into Plan and Activity into
 * Progress. Phase 18 cuts six to five: **Progress folds into Home** and
 * **Integrations into Settings**, and the slot they free goes to Grades —
 * which is the question students actually open a study app to ask, and the
 * one LockIn could not answer at all until now.
 *
 * Both old routes still exist and still work; they are simply not competing
 * for a place in the bar. Nothing a student had bookmarked breaks.
 *
 * Parent and Settings sit apart at the bottom: they are not destinations you
 * move between, they are somewhere you go for a reason and come back from.
 */
const NAV: NavItem[] = [
  { to: '/home', label: 'Home', icon: 'home' },
  { to: '/assignments', label: 'Work', icon: 'list' },
  { to: '/grades', label: 'Grades', icon: 'badge' },
  { to: '/planner', label: 'Plan', icon: 'calendar' },
  { to: '/focus', label: 'Focus', icon: 'timer' },
];

/** Bottom of the sidebar, and behind a "More" row on a phone. */
const SECONDARY: NavItem[] = [
  { to: '/progress', label: 'Progress', icon: 'activity' },
  { to: '/integrations', label: 'Integrations', icon: 'link' },
  { to: '/parent', label: 'Parent', icon: 'shield' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

export function Shell({ children }: { children: ReactNode }) {
  const location = useLocation();
  return (
    <div className="lk-app-shell min-h-dvh lk-surface">
      <div className="lk-atmosphere" aria-hidden="true">
        <span className="lk-orb lk-orb-one" />
        <span className="lk-orb lk-orb-two" />
        <span className="lk-orb lk-orb-three" />
        <span className="lk-light-beam" />
      </div>
      <Sidebar />
      <div className="lg:pl-64">
        <FocusBanner />
        <ProtectionBanner />
        <main
          key={location.pathname}
          className="lk-page relative z-10 mx-auto w-full max-w-5xl px-4 pt-5 pb-28 sm:px-6 lg:pb-10"
        >
          <RecoveryNotice />
          {children}
        </main>
      </div>
      <BottomNav />
      <CommandPalette />
    </div>
  );
}

function CommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  useEffect(() => {
    const openPalette = () => setOpen(true);
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT';
      if (((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') || (event.key === '/' && !typing)) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('lockin:command', openPalette);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('lockin:command', openPalette);
    };
  }, []);
  const commands = [
    ['Add assignment', '/assignments?new=1'],
    ['Check Canvas', '/assignments'],
    ['Start Focus', '/focus'],
    ['Open today’s plan', '/planner'],
    ['View grades', '/grades'],
    ['Review class schedule', '/settings#school-schedule'],
    ['Canvas settings', '/settings#canvas-checks'],
  ].filter(([label]) => label.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <Modal open={open} title="Jump anywhere" onClose={() => { setOpen(false); setQuery(''); }}>
      <TextInput autoFocus value={query} placeholder="Search actions…" onChange={(event) => setQuery(event.target.value)} />
      <div className="mt-3 space-y-1">
        {commands.map(([label, to]) => (
          <button key={label} type="button" className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-body font-bold lk-strong hover:lk-sunken" onClick={() => { navigate(to); setOpen(false); setQuery(''); }}>
            {label}<span className="text-caption lk-muted">↵</span>
          </button>
        ))}
      </div>
      <p className="mt-3 text-caption lk-muted">Open anytime with ⌘K, Ctrl+K, or /.</p>
    </Modal>
  );
}

function Wordmark({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="lk-wordmark-mark grid h-9 w-9 place-items-center rounded-xl text-white">
        <Icon name="lock" size={18} />
      </span>
      {!compact && (
        <span className="text-lg font-extrabold tracking-tight lk-strong">LockIn</span>
      )}
    </div>
  );
}

function Sidebar() {
  const { state } = useApp();
  return (
    <aside className="lk-sidebar fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r lk-border px-4 py-5 lg:flex">
      <div className="px-2">
        <Wordmark />
        <p className="mt-2 px-0.5 text-xs leading-snug lk-muted">
          Finish what matters before distractions take over.
        </p>
      </div>

      <nav className="mt-7 flex flex-1 flex-col gap-1" aria-label="Main">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cx(
                'lk-nav-item flex items-center gap-3 rounded-xl px-3 py-2.5 text-body font-semibold',
                'transition-colors duration-150',
                isActive
                  ? 'lk-nav-active bg-brand-600 text-white shadow-sm shadow-brand-900/25'
                  : 'lk-muted hover:lk-sunken hover:lk-strong',
              )
            }
          >
            <Icon name={item.icon} size={19} />
            {item.label === 'Work' ? 'Assignments' : item.label}
          </NavLink>
        ))}
        <button
          type="button"
          className="mt-2 flex items-center justify-between rounded-xl px-3 py-2 text-caption font-bold lk-muted hover:lk-sunken hover:lk-strong"
          onClick={() => window.dispatchEvent(new Event('lockin:command'))}
        >
          <span className="flex items-center gap-3"><Icon name="search" size={16} />Quick actions</span>
          <span>⌘K</span>
        </button>
      </nav>

      <div className="mt-4 space-y-3 border-t lk-border pt-4">
        <div className="flex flex-col gap-0.5">
          {SECONDARY.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-3 rounded-xl px-3 py-2 text-caption font-bold',
                  'transition-colors duration-150',
                  isActive ? 'lk-sunken lk-strong' : 'lk-muted hover:lk-strong',
                )
              }
            >
              <Icon name={item.icon} size={16} />
              {item.label}
            </NavLink>
          ))}
        </div>
        {/* Help and Privacy sit here rather than in NAV: the bottom bar on a
            375px phone already carries seven destinations, and an eighth makes
            every tap target too small to hit reliably. */}
        <div className="flex gap-3 px-1 text-xs font-semibold lk-muted">
          <NavLink to="/help" className="hover:lk-strong">
            Help
          </NavLink>
          <NavLink to="/privacy" className="hover:lk-strong">
            Privacy
          </NavLink>
        </div>
        <ThemeToggle />
        {state.profile && (
          <div className="flex items-center gap-2.5 rounded-xl px-1 py-1">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-700 dark:bg-brand-900/60 dark:text-brand-200">
              {state.profile.firstName.charAt(0).toUpperCase()}
            </span>
            <span className="truncate text-sm font-semibold lk-strong">
              {state.profile.firstName}
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}

/**
 * The phone bar.
 *
 * Six destinations plus a More sheet. The sheet is not a nicety: Parent,
 * Settings, Help and Privacy live in the sidebar on desktop, and without it
 * they would be unreachable on a phone entirely — which is exactly what
 * happened when the sidebar gained a secondary row and this bar did not.
 * Caught by opening the app at 375px, not by a test.
 */
function BottomNav() {
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();

  // Any navigation closes the sheet; leaving it open over the new page is the
  // classic bottom-sheet bug.
  useEffect(() => setMoreOpen(false), [location.pathname]);

  return (
    <>
      {moreOpen && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
            className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          />
          <div
            className="animate-rise fixed inset-x-0 bottom-[4.25rem] z-50 mx-3 rounded-2xl border lk-border lk-raised p-2 shadow-lg lg:hidden"
            role="dialog"
            aria-label="More"
          >
            {[
              // Demoted from the bar in Phase 18, not removed: still one tap
              // away, and every old link still resolves.
              { to: '/progress', label: 'Progress', icon: 'activity' as IconName },
              { to: '/integrations', label: 'Integrations', icon: 'link' as IconName },
              ...SECONDARY,
              { to: '/help', label: 'Help', icon: 'search' as IconName },
              { to: '/privacy', label: 'Privacy', icon: 'shield' as IconName },
            ].map(
              (item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-body font-semibold lk-strong hover:lk-sunken"
                >
                  <Icon name={item.icon} size={17} />
                  {item.label}
                </NavLink>
              ),
            )}
            <div className="border-t lk-border p-2 pt-3">
              <ThemeToggle />
            </div>
          </div>
        </>
      )}

      <nav
        className="lk-bottom-nav fixed inset-x-0 bottom-0 z-40 border-t lk-border pb-[env(safe-area-inset-bottom)] lg:hidden"
        aria-label="Main"
      >
      <div className="mx-auto flex max-w-lg items-stretch justify-between px-1">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cx(
                'flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[0.66rem] font-bold transition-colors',
                isActive ? 'text-brand-600 dark:text-brand-300' : 'lk-muted',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={cx(
                    'rounded-lg px-3 py-1 transition-colors',
                    isActive && 'bg-brand-100 dark:bg-brand-900/60',
                  )}
                >
                  <Icon name={item.icon} size={19} />
                </span>
                {item.label}
              </>
            )}
          </NavLink>
        ))}

        <button
          type="button"
          onClick={() => setMoreOpen((open) => !open)}
          aria-expanded={moreOpen}
          aria-label="More"
          className={cx(
            'flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[0.66rem] font-bold transition-colors',
            moreOpen ? 'text-brand-600 dark:text-brand-300' : 'lk-muted',
          )}
        >
          <span
            className={cx(
              'rounded-lg px-3 py-1 transition-colors',
              moreOpen && 'bg-brand-100 dark:bg-brand-900/60',
            )}
          >
            <Icon name="settings" size={19} />
          </span>
          More
        </button>
      </div>
      </nav>
    </>
  );
}

/**
 * Says out loud when Focus Mode is running but nothing is actually being
 * blocked.
 *
 * This is the single most important honesty surface in the app. A student who
 * believes YouTube is blocked, and works next to a YouTube tab that opens
 * fine, has been misled by LockIn — so whenever the extension is not answering
 * while blocking is supposed to be on, that gets said plainly instead of being
 * left to the small "Not connected" badge three screens away in Settings.
 */
function ProtectionBanner() {
  const { state, extension } = useApp();
  const fm = state.focusMode;

  const shouldBeBlocking = fm.active && state.settings.blockingEnabled;
  const nothingToBlock = state.settings.blockedDomains.length === 0;
  if (!shouldBeBlocking || nothingToBlock) return null;
  // 'checking' is the first second after a page load; claiming a failure then
  // would make every refresh flash a scary banner.
  if (extension.status !== 'disconnected') return null;

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 bg-amber-500 px-4 py-2 text-center text-sm font-bold text-amber-950"
    >
      <Icon name="alert" size={16} aria-hidden />
      <span>
        {extension.everConnected
          ? 'Browser Protection isn’t responding — websites are not being blocked.'
          : 'Browser Protection isn’t installed — websites are not being blocked.'}
      </span>
      <NavLink to="/settings#browser-protection" className="underline underline-offset-2">
        Fix this
      </NavLink>
    </div>
  );
}

function FocusBanner() {
  const { state, now } = useApp();
  const fm = state.focusMode;
  if (!fm.active) return null;

  const unlocked = fm.temporaryUnlockUntil !== null && fm.temporaryUnlockUntil > now;
  const remaining = requiredRemaining(state);
  const blocking = blockingActive(state, now);

  return (
    <div
      className={cx(
        'sticky top-0 z-20 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-center text-sm font-bold text-white',
        unlocked ? 'bg-mint-600' : fm.isTest ? 'bg-amber-600' : 'bg-brand-700',
      )}
    >
      {unlocked ? (
        <>
          <span>Temporary unlock active</span>
          <span className="font-mono text-xs opacity-90">
            {formatClock((fm.temporaryUnlockUntil ?? 0) - now)} left
          </span>
        </>
      ) : (
        <>
          <span>{fm.isTest ? 'TEST MODE — blocking active' : 'FOCUS MODE ACTIVE'}</span>
          {fm.isTest && fm.testExpiresAt ? (
            <span className="font-mono text-xs opacity-90">
              {formatClock(fm.testExpiresAt - now)} left
            </span>
          ) : fm.requiredCompletionCount > 0 ? (
            <span className="text-xs font-semibold opacity-90">
              {fm.completedCount}/{fm.requiredCompletionCount} required ·{' '}
              {remaining} to unlock
            </span>
          ) : null}
          {!blocking && (
            <span className="text-xs font-semibold opacity-90">(blocking paused)</span>
          )}
        </>
      )}
    </div>
  );
}
