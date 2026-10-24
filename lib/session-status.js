// /api/status answers at once, even when the session has lapsed: silent
// renewal (a hidden browser, 10 to 90 seconds) runs in the background and the
// page asks again every few seconds. Kept apart from bb.js so it can be
// tested without Blackboard.

const EXPIRED = new Set(['NOT_AUTHENTICATED', 'SESSION_EXPIRED']);

/** After a failed renewal, wait this long before trying again on our own. */
export const RENEW_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Builds status(). `check()` asks Blackboard whether the session is live and
 * returns { name, secondsLeft, baseUrl } or throws; `canRenew()` says whether
 * a saved school login exists; `renew()` resolves to true or false; `reset()`
 * forgets the cached client. Answers are { signedIn: true, … },
 * { signedIn: false, renewing: true } while renewing, or { signedIn: false, error, code }.
 */
export function quickStatus({ check, canRenew, renew, reset = () => {}, now = Date.now, cooldownMs = RENEW_COOLDOWN_MS }) {
  let running; // the renewal in progress
  let failedAt = -Infinity;

  function startRenewal() {
    running = Promise.resolve()
      .then(renew)
      .catch(() => false)
      .then((ok) => {
        failedAt = ok ? -Infinity : now();
        return ok;
      })
      .finally(() => { running = undefined; });
  }

  return async function status() {
    if (running) return { signedIn: false, renewing: true };
    try {
      return { signedIn: true, ...(await check()) };
    } catch (err) {
      if (EXPIRED.has(err.code)) {
        reset();
        if (now() - failedAt >= cooldownMs && (await canRenew())) {
          startRenewal();
          return { signedIn: false, renewing: true, code: err.code };
        }
      }
      return { signedIn: false, error: err.message, code: err.code };
    }
  };
}
