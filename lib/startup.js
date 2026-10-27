// Waiting for Blackboard when the page opens: what the title card says, and
// retrying slow or failed requests with growing gaps so the page never stays
// stuck. No Node-only code: the page loads it as /startup.js. The clock is
// passed in, so the tests can run minutes of waiting in no time.

/** What the title card says while waiting, one line per step. */
export const PHASES = {
  checking: '正在检查 Blackboard 登录…',
  renewing: '登录过期了，正在后台自动重新登录 Blackboard，大约要 20 秒，请稍等',
  reading: '正在从 Blackboard 读取课程，第一次大约要 20 秒，请稍等',
  retrying: '学校服务器回应有点慢，正在自动重试…',
};

/** After this long the spinner gives way to an explanation and 再试一次. */
export const STUCK_MS = 60_000;

/** Shown in the title card once STUCK_MS has passed; `window` is 黑色窗口 or 终端窗口 (lib/os-words.js). */
export const stuckText = (window = '黑色窗口') => '等了 1 分钟还没读到 Blackboard 的数据。可能是网络慢或学校服务器忙，也可能需要重新登录。'
  + `请先点「再试一次」；还是不行的话，点「重新连接」重新登录。等待期间${window}不要关。`;

export const STUCK_TEXT = stuckText();

/** Gaps between attempts: 2, 4, 8, 16, then every 30 seconds. */
export function retryDelay(attempt) {
  return Math.min(2000 * 2 ** attempt, 30_000);
}

const NO_RETRY = new Set(['NOT_AUTHENTICATED', 'SESSION_EXPIRED', 'NOT_CONFIGURED', 'SERVER_DOWN', 'CANCELLED']);

/**
 * Worth trying again: timeouts, network trouble and server errors. Not
 * sign-in problems (the student has to act), not the black window being
 * closed (the page notices when it is back), not 4xx answers.
 */
export function isRetryable(err) {
  if (NO_RETRY.has(err?.code)) return false;
  return !(err?.status >= 400 && err.status < 500);
}

/**
 * Calls `attempt()` until it gives an answer. Between failures it waits
 * retryDelay(n) and calls onRetry(err, n). `onStuck` runs when `stuckMs`
 * has passed since `since` (default: now) without an answer, even while a
 * request is still out, so several steps can share one clock; attempts go
 * on after that until `giveUpMs`, then the last error is thrown. Errors that
 * are not worth retrying are thrown at once. `timer` is
 * { set(fn, ms), clear(id) } and `sleep(ms)` a promise; both default to the
 * real clock.
 */
export async function untilLoaded(attempt, {
  onRetry = () => {},
  onStuck = () => {},
  stuckMs = STUCK_MS,
  giveUpMs = Infinity,
  cancelled = () => false,
  now = Date.now,
  since = now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  timer = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) },
} = {}) {
  const start = since;
  const watch = timer.set(onStuck, Math.max(0, stuckMs - (now() - since)));
  try {
    for (let n = 0; ; n += 1) {
      try {
        return await attempt();
      } catch (err) {
        if (cancelled() || !isRetryable(err)) throw err;
        const wait = retryDelay(n);
        if (now() - start + wait > giveUpMs) throw err;
        onRetry(err, n);
        await sleep(wait);
        if (cancelled()) throw Object.assign(new Error('cancelled'), { code: 'CANCELLED' });
      }
    }
  } finally {
    timer.clear(watch);
  }
}
