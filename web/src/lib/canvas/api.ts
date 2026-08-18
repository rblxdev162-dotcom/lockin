/**
 * CanvasApiProvider — INTENTIONALLY NOT IMPLEMENTED.
 *
 * This is the seam where institution-approved Canvas access would go: an
 * OAuth2 flow against a school-issued Developer Key, or an admin-provisioned
 * token. LockIn does not have that access, so nothing here pretends to.
 *
 * What a real implementation would need, none of which exists today:
 *   - a Developer Key issued by the school's Canvas administrator
 *   - a registered redirect URI and a confidential client secret, which means
 *     a backend — this project is deliberately serverless and local-only
 *   - `GET /api/v1/courses`, `/courses/:id/assignments`,
 *     `/courses/:id/assignments/:id/submissions/self`
 *
 * Rules for whoever implements this:
 *   1. Do NOT fake the OAuth flow or ask the student for a password.
 *   2. Do NOT store access tokens in localStorage.
 *   3. Reuse the same `CanvasProvider` interface so the reducer, the
 *      verification policy and every screen keep working unchanged.
 *   4. The submission → completion policy lives in `verification.ts` and must
 *      be shared, not reimplemented.
 */
import type {
  CanvasAssignmentStatus,
  CanvasConnectionStatus,
  CanvasCourse,
  CanvasDetectedAssignment,
} from '../../types/canvas';
import type { CanvasProvider } from './provider';
import { unavailableStatus } from './provider';

const REASON =
  'The official Canvas API provider is not implemented. LockIn uses Canvas Browser Connection instead.';

export class CanvasApiProvider implements CanvasProvider {
  readonly kind = 'api' as const;
  readonly label = 'Canvas API (not available)';

  async getConnectionStatus(): Promise<CanvasConnectionStatus> {
    return unavailableStatus(REASON);
  }

  async detectCourses(): Promise<CanvasCourse[]> {
    return [];
  }

  async detectAssignments(): Promise<CanvasDetectedAssignment[]> {
    return [];
  }

  async getAssignmentStatus(
    courseId: string,
    assignmentId: string,
  ): Promise<CanvasAssignmentStatus> {
    return {
      externalCourseId: courseId,
      externalAssignmentId: assignmentId,
      submissionStatus: 'verification_unavailable',
      checkedAt: new Date().toISOString(),
      unavailable: true,
    };
  }
}
