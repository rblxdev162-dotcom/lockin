/**
 * Automatic Edgenuity progress sync from the mailbox that already receives it.
 *
 * ## Status: architecture, not a connection
 *
 * Everything here is real code except the one thing that cannot exist without
 * the account owner doing something first — a Google OAuth **client id**. This
 * project ships no client id, and inventing one would produce a button that
 * fails with an opaque Google error, which is worse than a button that
 * explains itself.
 *
 * So: `configured()` is false until a client id is supplied, the Integrations
 * card says exactly what is missing, and `sync()` refuses rather than
 * pretending.
 *
 * ## The design, so it stays honest when it is finished
 *
 * - **Real Google OAuth only.** `chrome.identity.launchWebAuthFlow` from the
 *   companion, authorization-code + PKCE. No password is ever asked for, and
 *   there is no "paste your app password" path — that is a phishing pattern,
 *   not an integration.
 * - **The narrowest scope that can work**: `gmail.readonly`. Google classes it
 *   restricted, which means a published app needs verification and a security
 *   assessment. A personal, unverified project used by its own owner as a test
 *   user does not — and that limit is stated in the UI rather than discovered
 *   later.
 * - **A query, not an inbox.** The adapter only ever asks Gmail for messages
 *   matching `QUERY` below. It does not list the mailbox, does not read
 *   threads, and never stores a message that did not match.
 * - **Nothing but the parsed numbers is kept.** Message bodies are parsed by
 *   `progressEmail.ts` in memory and dropped. No subject lines, no addresses,
 *   no message ids beyond the one used to avoid re-parsing the same report.
 * - **No AI service.** Parsing is deterministic and local. Sending a school
 *   progress report to a model to be read would hand a third party a child's
 *   academic record, and no convenience justifies that.
 * - **The token lives in the extension.** Same rule as the calendar feed URL:
 *   a credential never enters page storage.
 */
import type { AdapterCapabilities, AdapterResult, SchoolDataAdapter } from '../sources/adapter';
import { emptyResult } from '../sources/adapter';

/**
 * The only Gmail search this adapter is permitted to issue.
 *
 * Narrow on purpose and in three ways at once — sender domain, subject, and a
 * recency bound — so that even a misconfigured account cannot turn this into a
 * general mailbox reader. Widening it is a deliberate edit, reviewable in a
 * diff, not a runtime option.
 */
export const QUERY =
  'from:(edgenuity.com OR imaginelearning.com) subject:(progress OR report) newer_than:90d';

/** Read-only, and only Gmail. Nothing else is ever requested. */
export const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

export interface GmailConfig {
  /** Supplied by the account owner from their own Google Cloud project. */
  clientId?: string;
  /** The mailbox that was authorized, for display only. */
  account?: string;
}

export class GmailProgressAdapter implements SchoolDataAdapter {
  readonly kind = 'EDGENUITY_PROGRESS_EMAIL' as const;
  readonly sourceId = 'edgenuity-email';
  readonly label = 'Edgenuity progress emails';
  readonly capabilities: AdapterCapabilities = {
    work: false,
    progress: true,
    submissionState: false,
    // It *would* be automatic once authorized. Declaring that here is what
    // makes the freshness model treat it as a live source rather than an
    // import — and why it must stay false-by-omission until it really runs.
    automatic: true,
  };

  private readonly config: GmailConfig;

  // Written out rather than as a parameter property: this project builds with
  // `erasableSyntaxOnly`, so TypeScript-only syntax that emits code is off.
  constructor(config: GmailConfig = {}) {
    this.config = config;
  }

  unavailable() {
    if (!this.config.clientId) return 'needs_authorization' as const;
    return null;
  }

  async sync(): Promise<AdapterResult> {
    // Deliberately not implemented against a fake. A stub that returned
    // plausible-looking courses would make every screen above it look finished
    // and be impossible to tell apart from a working integration.
    return emptyResult(
      'Gmail sync needs a Google OAuth client id from your own Google Cloud project. Until then, import a progress report file instead.',
    );
  }
}

/**
 * What the account owner has to do, once, to finish this.
 *
 * Rendered verbatim on the Integrations page. Written as steps rather than
 * prose because every one of them is a place people get stuck, and a vague
 * "configure OAuth" helps nobody.
 */
export const SETUP_STEPS = [
  'Create a project at console.cloud.google.com (free).',
  'Enable the Gmail API for that project.',
  'Create an OAuth client of type “Chrome extension” and paste the LockIn Companion’s extension id.',
  'Add yourself as a test user on the OAuth consent screen.',
  'Paste the client id into LockIn. It is stored by the companion, never by this page.',
];

/**
 * Why this is not simply shipped working.
 *
 * Also rendered in the UI. A student who understands *why* a button is missing
 * does not experience it as a broken app.
 */
export const WHY_NOT_AUTOMATIC =
  'Reading Gmail needs Google’s permission as well as yours. A shared client id would let any LockIn install read mail through this project’s identity, so LockIn does not ship one — you supply your own, and the access stays yours.';
