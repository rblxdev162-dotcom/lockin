/**
 * Settings → Edgenuity verification.
 *
 * What is left of this card after Phase 15 removed the camera path: the
 * on-device text-recognition status, and the developer diagnostics toggle.
 *
 * The two things it used to own are gone. The camera test went with the camera
 * — nothing points a webcam at anything any more. The Enhanced Proof control
 * went with the handwritten challenge codes: a shared window cannot hold a
 * piece of paper up beside itself, so the bar it set could never be cleared,
 * and a requirement nobody can satisfy is worse than no requirement at all.
 *
 * Setting up the two ways progress is actually read now lives in its own
 * cards: `EdgenuityBrowserSettings` (the extension, same Chrome profile) and
 * `EdgenuityBridgeSettings` (the local service, any Chrome profile).
 */
import { Card, CardHeader } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Toggle } from '../ui/Field';
import { toast } from '../ui/Toast';
import { useApp } from '../../store/context';
import { checkScreenSupport } from '../../lib/edgenuity/capture';
import { ocrEverLoaded, ocrReady, warmUpOcr } from '../../lib/edgenuity/ocr';
import { useState } from 'react';

export function EdgenuitySettings() {
  const { state, dispatch } = useApp();
  const [warming, setWarming] = useState(false);

  const support = checkScreenSupport();
  const loaded = state.edgenuity.ocrEverLoaded || ocrEverLoaded();
  const activeSessions = state.edgenuity.sessions.filter((s) => s.status === 'in_progress').length;

  return (
    <Card id="edgenuity-verification">
      <CardHeader
        title="Edgenuity verification"
        subtitle="Reading progress from your Edgenuity screen, on this device."
        action={<Badge tone={support.supported ? 'brand' : 'amber'}>ON DEVICE</Badge>}
      />

      <div className="space-y-4">
        <dl className="grid gap-2 sm:grid-cols-3">
          <Stat
            label="Text recognition"
            value={loaded ? (ocrReady() ? 'Ready' : 'Installed') : 'Loads on first use'}
            tone={loaded ? 'mint' : 'neutral'}
          />
          <Stat
            label="Window sharing"
            value={support.supported ? 'Available' : 'Unavailable'}
            tone={support.supported ? 'mint' : 'neutral'}
          />
          <Stat label="Sent anywhere" value="Never" tone="mint" />
        </dl>

        {!support.supported && support.detail && (
          <p className="rounded-xl border px-3 py-2 text-sm lk-border lk-muted">{support.detail}</p>
        )}

        {activeSessions > 0 && (
          <p className="text-sm lk-muted">
            {activeSessions} verification{activeSessions === 1 ? '' : 's'} in progress.
          </p>
        )}

        <p className="text-sm lk-muted">
          Reading happens entirely on this computer. Nothing is uploaded, and no image of your
          screen is ever saved.
        </p>

        <div className="flex flex-wrap gap-2">
          {/*
            Warming up matters because the first read of a session spends a few
            seconds unpacking the recognition engine. Doing it here, once, beats
            doing it while a student is waiting to prove they finished.
          */}
          <Button
            variant="secondary"
            disabled={warming || ocrReady()}
            onClick={() => {
              setWarming(true);
              void warmUpOcr()
                .then(() => {
                  dispatch({ type: 'EDGENUITY_OCR_LOADED' });
                  toast('Text recognition is ready.', 'success');
                })
                .catch(() => toast('Text recognition could not start.', 'error'))
                .finally(() => setWarming(false));
            }}
          >
            {ocrReady() ? 'Ready' : warming ? 'Starting…' : 'Get text recognition ready'}
          </Button>
        </div>

        <Toggle
          checked={state.edgenuity.developerMode}
          onChange={(on) => dispatch({ type: 'EDGENUITY_SET_DEVELOPER_MODE', on })}
          label="Developer diagnostics"
        />
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
