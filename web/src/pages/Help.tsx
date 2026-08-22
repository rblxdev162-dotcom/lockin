/**
 * /help — the questions students actually ask, and the honest limits.
 *
 * The limitations section is not a disclaimer bolted on the end. LockIn's
 * whole design rests on being believable about what it can and cannot do: a
 * student who is told blocking is unbreakable will find out otherwise in ten
 * minutes and stop trusting everything else the app says.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardHeader } from '../components/ui/Card';
import { Icon } from '../components/ui/Icon';
import { APP_VERSION } from '../version';
import { useApp } from '../store/context';

interface Topic {
  question: string;
  answer: React.ReactNode;
}

const TOPICS: Topic[] = [
  {
    question: 'Why isn’t a site being blocked?',
    answer: (
      <>
        Blocking needs four things at once: the Chrome extension connected, blocking switched on,
        the site on your blocked list, and Focus Mode actually running. Check them in one place
        under <Link className="underline" to="/settings#browser-protection">Settings → Browser
        protection</Link>. The most common cause is a tab that was open before the extension was
        loaded — reload it. The second most common is that the site is also on your school
        allowlist, which always wins.
      </>
    ),
  },
  {
    question: 'Why can’t LockIn verify my Edgenuity progress?',
    answer: (
      <>
        Verification needs a live photo of the Edgenuity screen with the course progress readable.
        It refuses rather than guesses, so glare, a tilted angle, a rebranded school theme or a
        blurry frame all end in “try again” instead of a wrong pass. Retakes are free. If Enhanced
        Proof is on, the written code has to be in the same photo as the screen.
      </>
    ),
  },
  {
    question: 'Why can’t LockIn see my Canvas work?',
    answer: (
      <>
        LockIn reads rendered Canvas pages only after you grant access in Settings. It cannot log
        in for you. Manual checks use pages you opened; scheduled checks can briefly open one class
        Grades page after school and close the temporary tab after reading. If Canvas changes its
        layout, LockIn reports that it could not read the page rather than guessing.
      </>
    ),
  },
  {
    question: 'Why did my plan change?',
    answer: (
      <>
        The planner rebuilds whenever the facts change — new work, a finished session, a moved due
        date, edited availability. Unfinished minutes are always carried forward, never dropped:
        what’s left is worked out from your estimate minus the time you’ve logged, every single
        time. The Planner page explains each day’s reasoning in plain words.
      </>
    ),
  },
  {
    question: 'What is Focus Guard, and can it see what I do?',
    answer: (
      <>
        While Focus Mode is running, it notices when you switch away from the LockIn tab and times
        how long you're gone. That's all it does — it can't stop you leaving, and it{' '}
        <strong className="lk-strong">can't see where you went</strong>. The browser only tells a
        page whether it is visible or hidden; there is no destination in that, and LockIn doesn't
        use anything else to find one. Trips under five seconds aren't counted. Turn it off any
        time on the <Link className="underline" to="/focus">Focus</Link> page.
      </>
    ),
  },
  {
    question: 'How do I use Parent View?',
    answer: (
      <>
        Set a parent PIN in Settings, then open <Link className="underline" to="/parent">Parent
        View</Link> and enter it. It shows schoolwork, verification and Focus Mode history, and
        lets a parent raise the proof requirements. It locks itself again on reload or when you
        leave — the session is never saved.
      </>
    ),
  },
  {
    question: 'How do I get out if something goes wrong?',
    answer: (
      <>
        The emergency exit on the <Link className="underline" to="/focus">Focus</Link> page always
        works, with no PIN and no progress required. It ends Focus Mode immediately and records
        that it was used. LockIn will never trap you in a blocked browser, and it never closes
        tabs or hides Chrome’s own settings.
      </>
    ),
  },
];

const LIMITATIONS = [
  'Anyone who controls Chrome can disable the extension. LockIn is accountability, not a lock.',
  'A website cannot block websites. Without the extension, LockIn can notice you left but not stop you — no browser gives a page that power.',
  'Only this browser is affected. Other browsers, phones and tablets are untouched.',
  'Reminders only appear while a LockIn tab is open — there is no server to send them.',
  'Canvas detection can break if Canvas changes its interface. LockIn says so rather than guessing.',
  'Edgenuity reading can fail on glare, unusual themes or handwriting.',
  'Enhanced Proof makes a prepared photo much harder to reuse. It cannot prove whose screen was photographed.',
  'The parent PIN is accountability, not device security. It does not protect the browser itself.',
  'The planner works from your estimates, and cannot know about homework you were set an hour ago.',
];

export function HelpPage() {
  const { extension } = useApp();
  const [open, setOpen] = useState<string | null>(TOPICS[0].question);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight lk-strong">Help</h1>
        <p className="mt-1 text-sm lk-muted">The short answers to the things that come up most.</p>
      </header>

      <Card>
        <CardHeader title="Common questions" />
        <div className="divide-y lk-border">
          {TOPICS.map((topic) => {
            const expanded = open === topic.question;
            return (
              <div key={topic.question} className="py-1">
                <h2>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setOpen(expanded ? null : topic.question)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl px-1 py-3 text-left text-sm font-bold lk-strong hover:lk-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                  >
                    {topic.question}
                    <Icon
                      name={expanded ? 'check' : 'plus'}
                      size={16}
                      aria-hidden
                      className="shrink-0 lk-muted"
                    />
                  </button>
                </h2>
                {expanded && (
                  <p className="px-1 pb-4 text-sm leading-relaxed lk-muted">{topic.answer}</p>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="What LockIn can’t do"
          subtitle="Known limits, stated up front rather than discovered later."
        />
        <ul className="space-y-2 text-sm lk-muted">
          {LIMITATIONS.map((item) => (
            <li key={item} className="flex items-start gap-2">
              <Icon name="alert" size={15} aria-hidden className="mt-0.5 shrink-0 text-amber-600" />
              {item}
            </li>
          ))}
        </ul>
      </Card>

      <Card id="about">
        <CardHeader title="About" />
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="lk-muted">Website version</dt>
            <dd className="font-mono font-semibold lk-strong">{APP_VERSION}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="lk-muted">Extension version</dt>
            <dd className="font-mono font-semibold lk-strong">
              {extension.status === 'connected' ? (extension.version ?? 'unknown') : 'not connected'}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="lk-muted">Message format</dt>
            <dd className="font-mono font-semibold lk-strong">
              v{extension.protocolVersion ?? '—'}
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-sm lk-muted">
          Read what LockIn stores and sends on the{' '}
          <Link className="underline" to="/privacy">
            Privacy page
          </Link>
          .
        </p>
      </Card>
    </div>
  );
}
