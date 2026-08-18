/**
 * Settings → "Read Edgenuity from any Chrome window".
 *
 * The setup surface for the bridge. Its main job is not the toggle — it is
 * saying which of the two one-time grants is missing, because both of them
 * fail silently and neither is guessable from a dead button.
 *
 * Tone rule, same as everywhere else in this app: never claim to see more than
 * it sees. This reads two numbers off a page the student has open. It is not
 * watching them work, and the copy says so rather than letting the feature
 * sound bigger than it is.
 */
import { Card, CardHeader } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Icon } from '../ui/Icon';
import { Toggle } from '../ui/Field';
import { useApp } from '../../store/context';
import { useEdgenuityBridge } from '../../hooks/useEdgenuityBridge';
import { BRIDGE_FIX } from '../../lib/edgenuity/nativeBridge';
import { relativeTime } from '../../lib/time';

export function EdgenuityBridgeSettings() {
  const { state, dispatch, now } = useApp();
  const enabled = state.settings.edgenuityBridgeEnabled === true;
  const { status, lastReadAt, lastProblem, coursesSeen, checking, checkNow, refreshStatus } =
    useEdgenuityBridge();

  const working = enabled && status?.ok === true;
  const problem = status?.problem ?? lastProblem ?? null;

  return (
    <Card id="edgenuity-bridge">
      <CardHeader
        title="Read Edgenuity from any Chrome window"
        subtitle="For when Edgenuity is signed in on a different Chrome profile than LockIn."
        action={<Badge tone={working ? 'mint' : 'neutral'}>{working ? 'Working' : 'Off'}</Badge>}
      />

      <div className="space-y-4">
        <Toggle
          checked={enabled}
          onChange={(on) => {
            dispatch({ type: 'UPDATE_SETTINGS', patch: { edgenuityBridgeEnabled: on } });
            if (on) void refreshStatus();
          }}
          label="Let LockIn read my Edgenuity progress from any Chrome window"
        />

        <ul className="space-y-1.5 text-sm lk-muted">
          <li className="flex gap-2">
            <Icon name="check" size={15} className="mt-0.5 shrink-0" />
            <span>
              Reads two numbers from a course page <strong>you</strong> already have open — how
              far along you are, and the target Edgenuity says you should be at.
            </span>
          </li>
          <li className="flex gap-2">
            <Icon name="check" size={15} className="mt-0.5 shrink-0" />
            <span>
              Never opens Edgenuity, never clicks anything, never takes a picture of your screen.
            </span>
          </li>
          <li className="flex gap-2">
            <Icon name="check" size={15} className="mt-0.5 shrink-0" />
            <span>Skips quizzes, tests and exams entirely.</span>
          </li>
        </ul>

        {enabled && (
          <>
            <dl className="grid gap-2 sm:grid-cols-3">
              <Stat
                label="Chrome"
                value={status?.chromeRunning ? 'Found' : 'Not seen'}
                tone={status?.chromeRunning ? 'mint' : 'neutral'}
              />
              <Stat
                label="Edgenuity tabs"
                value={String(status?.edgenuityTabs ?? 0)}
                tone={(status?.edgenuityTabs ?? 0) > 0 ? 'mint' : 'neutral'}
              />
              <Stat
                label="Last read"
                value={lastReadAt ? relativeTime(lastReadAt, new Date(now)) : 'Not yet'}
              />
            </dl>

            {/* One sentence naming the thing to fix, not a generic failure. */}
            {problem && (
              <div className="rounded-xl border px-3 py-2.5 text-sm lk-border">
                <p className="font-semibold lk-strong">Not reading yet</p>
                <p className="mt-1 lk-muted">{BRIDGE_FIX[problem]}</p>
              </div>
            )}

            {working && coursesSeen > 0 && (
              <p className="text-sm lk-muted">
                Reading {coursesSeen} course{coursesSeen === 1 ? '' : 's'}, checking every few
                minutes while you have work being tracked.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  void refreshStatus();
                  void checkNow();
                }}
                disabled={checking}
              >
                {checking ? 'Checking…' : 'Check now'}
              </Button>
            </div>
          </>
        )}

        {/*
          Both grants fail silently and neither is discoverable, so they are
          written out rather than left to the error message alone.
        */}
        <details className="rounded-xl border px-3 py-2 lk-border">
          <summary className="cursor-pointer text-sm font-semibold lk-strong">
            One-time setup on this Mac
          </summary>
          <ol className="mt-2 space-y-1.5 text-sm lk-muted">
            <li>
              1. In Chrome: <strong>View → Developer → Allow JavaScript from Apple Events</strong>.
              This is one setting for all of Chrome, so it can be switched on from this window.
            </li>
            <li>
              2. The first read asks macOS for permission to control Chrome. Say yes. If you miss
              it: <strong>System Settings → Privacy &amp; Security → Automation</strong>.
            </li>
            <li>
              3. LockIn has to be open from the always-on service (
              <code>npm run service:install</code>), not the dev server — the dev server has no
              bridge.
            </li>
          </ol>
        </details>
      </div>
    </Card>
  );
}

function Stat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'mint' | 'neutral';
}) {
  return (
    <div className="rounded-xl border px-3 py-2 lk-border">
      <dt className="text-xs uppercase tracking-wide lk-muted">{label}</dt>
      <dd className={tone === 'mint' ? 'text-sm font-semibold text-mint-600' : 'text-sm font-semibold'}>
        {value}
      </dd>
    </div>
  );
}
