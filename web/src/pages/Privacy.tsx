/**
 * /privacy — what LockIn stores, what it discards, what it sends.
 *
 * Written to be true rather than reassuring. Every claim here is one a reader
 * could check in the source, and several of them are checked by tests:
 * `release.test.mjs` asserts the export carries no secrets and that the app
 * makes no network calls of its own.
 */
import { Link } from 'react-router-dom';
import { Card, CardHeader } from '../components/ui/Card';
import { Icon } from '../components/ui/Icon';

export function PrivacyPage() {
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight lk-strong">Privacy</h1>
        <p className="mt-1 text-sm lk-muted">
          LockIn runs entirely on this device. There is no LockIn account, no LockIn server, and
          nothing to sign in to.
        </p>
      </header>

      <Card>
        <CardHeader title="What LockIn sends over the internet" />
        <p className="rounded-2xl border border-mint-500/40 bg-mint-400/10 p-4 text-sm font-bold lk-strong">
          Nothing.
        </p>
        <p className="mt-3 text-sm leading-relaxed lk-muted">
          LockIn makes no network requests of its own — no accounts, no sync, no analytics, no
          crash reporting, no AI services. The only things your browser loads are the app’s own
          files and the offline text-recognition engine, both served from wherever you opened
          LockIn from. Opening Canvas or Edgenuity is you visiting those sites in the normal way;
          LockIn reads the page you are already looking at and never contacts them itself.
        </p>
        <p className="mt-3 text-sm leading-relaxed lk-muted">
          If you turn on reading Edgenuity from any Chrome window, LockIn talks to its own
          background service on this computer — <code>127.0.0.1</code>, the same program already
          serving this page. That never leaves the machine, and it cannot: it has no address to
          send anything to. It asks Chrome for two numbers off a course page you have open, and
          nothing else.
        </p>
      </Card>

      <Card>
        <CardHeader title="Stored on this device" subtitle="In your browser’s local storage." />
        <ul className="space-y-1.5 text-sm lk-muted">
          {[
            'Assignments, exams, due dates and your time estimates',
            'Your study plan, availability and planner settings',
            'Focus sessions and Focus Mode history',
            'Verification summaries — a status, a percentage, a timestamp',
            'The activity timeline',
            'Focus Guard: how many times you left this tab during Focus Mode, and for how long',
            'How many times each blocked site was opened (a count, never a URL)',
            'Parent settings, and a salted hash of the parent PIN',
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <Icon name="check" size={15} aria-hidden className="mt-0.5 shrink-0 text-mint-600" />
              {item}
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Never kept" />
        <ul className="space-y-1.5 text-sm lk-muted">
          {[
            'Photographs. Edgenuity verification reads the frame and discards it — no image is ever written to storage.',
            'Raw text read from a photo. Only the numbers that were understood are kept.',
            'Your Canvas password, or any Canvas token or cookie. LockIn has no way to log in as you.',
            'Browsing history. LockIn counts blocks per domain and knows nothing about pages you visit.',
            'Webcam recordings, screenshots, keystrokes, location or messages.',
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <Icon name="close" size={15} aria-hidden className="mt-0.5 shrink-0 text-flame-500" />
              {item}
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Focus Guard" />
        <p className="text-sm leading-relaxed lk-muted">
          While Focus Mode is running, LockIn notices when this tab stops being visible and times
          how long until you come back. It records two numbers per session: how many trips, and
          how many minutes.
        </p>
        <p className="mt-3 text-sm leading-relaxed lk-muted">
          It does <strong className="lk-strong">not</strong> know where you went. The browser
          feature it uses reports only “this page is visible” or “this page is hidden” — there is
          no destination in it, and LockIn does not use any other API that could find one. It is
          off outside Focus Mode, and you can turn it off entirely on the Focus page.
        </p>
      </Card>

      <Card>
        <CardHeader title="Canvas" />
        <p className="text-sm leading-relaxed lk-muted">
          After you grant access to your Canvas site, LockIn reads supported assignment and
          submission information from Canvas pages you visit yourself. It does not collect your
          Canvas password, it cannot open Canvas on your behalf, and it only ever sees pages you
          actually open. LockIn is not affiliated with Canvas or Instructure.
        </p>
      </Card>

      <Card>
        <CardHeader title="Edgenuity" />
        <p className="text-sm leading-relaxed lk-muted">
          Edgenuity verification processes the shared window locally on your device, using a
          text-recognition engine bundled with the app. The image is discarded as soon as it has
          been read; it is never saved and never leaves the device. LockIn is not affiliated with
          Edgenuity or Imagine Learning.
        </p>
      </Card>

      <Card>
        <CardHeader title="Parent View" />
        <p className="text-sm leading-relaxed lk-muted">
          Parent View is local to this browser. LockIn does not send reports to parents remotely —
          there is no email, no notification and no cloud dashboard. It shows schoolwork and
          verification history, and deliberately shows nothing about browsing, messages, location
          or your camera, because none of that is collected.
        </p>
      </Card>

      <Card>
        <CardHeader title="The Chrome extension" />
        <p className="text-sm leading-relaxed lk-muted">
          The extension stores the blocking rules it needs and a per-domain count of blocks. Chrome
          requires broad site access to redirect sites you choose to a block page, so the extension
          asks for it — the rules themselves only ever mention the sites on your own list, and
          nothing about the pages you visit is recorded or sent anywhere. Removing the extension
          deletes its counters with it.
        </p>
      </Card>

      <Card>
        <CardHeader title="Your data is yours" />
        <p className="text-sm leading-relaxed lk-muted">
          You can download everything LockIn stores, clear individual histories, or erase the whole
          thing, from <Link className="underline" to="/settings#data">Settings → Your data</Link>.
          Clearing your browser’s data for this site also removes it all.
        </p>
      </Card>
    </div>
  );
}
