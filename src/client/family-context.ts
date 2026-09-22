import { useOutletContext } from 'react-router-dom';
import type { SessionResponse } from '../shared/api';
import type { Notice } from './api';

export type ReadySession = Extract<SessionResponse, { status: 'ready' }>;

export interface FamilyContext {
  session: ReadySession;
  reloadSession: () => Promise<void>;
  /**
   * Raise a result message on the layout rather than inside the section. A
   * member revoking or demoting themselves changes the session, which unmounts
   * the section — a message owned by the section would vanish with it.
   */
  notify: (notice: Notice) => void;
}

/**
 * Routed sections read the signed-in session from the layout rather than
 * fetching it again. Kept out of the layout module so that file exports only
 * components, which React Fast Refresh requires.
 */
export const useFamily = () => useOutletContext<FamilyContext>();
