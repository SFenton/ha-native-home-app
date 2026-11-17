import type { ResolvedCall } from './projections';

/**
 * THE switch point for Use-mode taps reaching the real house.
 *
 * Off, and it stays off until the owner decides: a tap in the Studio's Use mode is simulated in the preview's overlay and never
 * becomes a Home Assistant service call, even while the preview shows live states. Turning it on takes more than this flag: a
 * server route that makes the call with the server's own credentials, a way to say which taps may go, and a confirmation. None of
 * that exists, so the flag has no effect on the build and {@link deliverCall} refuses to run with it on.
 */
export const SEND_USE_CALLS_TO_HOME_ASSISTANT = false as boolean;

/**
 * Where a Use-mode `call-service` goes after the preview has planned it. Always `simulated`: the overlay already shows the
 * result. This is the one place a real call would be sent.
 */
export function deliverCall(_call: ResolvedCall): 'simulated' {
  if (SEND_USE_CALLS_TO_HOME_ASSISTANT) throw new Error('Sending Use-mode calls to Home Assistant is not built; this flag must stay off.');
  return 'simulated';
}
