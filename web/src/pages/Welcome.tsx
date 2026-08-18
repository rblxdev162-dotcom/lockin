import { useNavigate } from 'react-router-dom';
import { useApp } from '../store/context';
import { useTheme } from '../hooks/useTheme';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';

export function Welcome() {
  useTheme();
  const navigate = useNavigate();
  const { state } = useApp();

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden px-5 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-brand-400/25 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-52 right-[-8rem] h-[28rem] w-[28rem] rounded-full bg-mint-400/20 blur-3xl"
      />

      <div className="animate-rise relative w-full max-w-lg text-center">
        <span className="mx-auto mb-7 grid h-16 w-16 place-items-center rounded-3xl bg-brand-600 text-white shadow-xl shadow-brand-900/30">
          <Icon name="lock" size={30} />
        </span>

        <h1 className="text-5xl font-extrabold tracking-tight lk-strong sm:text-6xl">LockIn</h1>
        <p className="mx-auto mt-4 max-w-sm text-lg leading-snug lk-muted">
          Finish what matters before distractions take over.
        </p>

        <div className="mt-9 flex flex-col gap-3 sm:mx-auto sm:max-w-xs">
          <Button
            size="lg"
            block
            onClick={() => navigate('/onboarding')}
          >
            Get Started
          </Button>
          {/* Only shown when there is something to continue *to*. A button
              whose entire job is to tell you it doesn't work is worse than no
              button, and this is the first screen a new student ever sees. */}
          {state.profile && (
            <Button
              size="lg"
              variant="secondary"
              block
              onClick={() => navigate(state.profile!.onboarded ? '/home' : '/onboarding')}
            >
              Continue as {state.profile.firstName}
            </Button>
          )}
        </div>

        <div className="mt-12 grid gap-3 text-left sm:grid-cols-3">
          {[
            { icon: 'list', title: 'Track the work', body: 'Canvas, Edgenuity, everything else.' },
            { icon: 'timer', title: 'Focus sessions', body: 'Timers that log real study time.' },
            { icon: 'shield', title: 'Real blocking', body: 'A Chrome extension holds the line.' },
          ].map((f) => (
            <div key={f.title} className="lk-card p-4">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-100 text-brand-700 dark:bg-brand-900/60 dark:text-brand-200">
                <Icon name={f.icon as 'list'} size={18} />
              </span>
              <p className="mt-3 text-sm font-bold lk-strong">{f.title}</p>
              <p className="mt-0.5 text-xs leading-snug lk-muted">{f.body}</p>
            </div>
          ))}
        </div>

        <p className="mt-8 text-xs lk-muted">
          Everything stays on this device. No accounts, no tracking, no uploads.
        </p>
      </div>
    </div>
  );
}
