/** Login throttling: N failures, then a cooldown that doubles on every further lockout (capped). Injectable clock for tests. */
export interface LimiterOptions { maxFails?: number; baseCooldownMs?: number; maxCooldownMs?: number; now?: () => number }
export type Check = { allowed: true } | { allowed: false; retryAfterSec: number };

interface Entry { fails: number; lockouts: number; lockedUntil: number; last: number }

export class LoginLimiter {
  private entries = new Map<string, Entry>();
  private maxFails: number; private base: number; private cap: number; private now: () => number;

  constructor(o: LimiterOptions = {}) {
    this.maxFails = o.maxFails ?? 5;
    this.base = o.baseCooldownMs ?? 60_000;
    this.cap = o.maxCooldownMs ?? 15 * 60_000;
    this.now = o.now ?? Date.now;
  }

  private gc() {
    if (this.entries.size < 5000) return;
    const t = this.now();
    for (const [k, e] of this.entries) if (e.lockedUntil < t && t - e.last > 3_600_000) this.entries.delete(k);
  }

  check(key: string): Check {
    const e = this.entries.get(key);
    const t = this.now();
    if (e && e.lockedUntil > t) return { allowed: false, retryAfterSec: Math.ceil((e.lockedUntil - t) / 1000) };
    return { allowed: true };
  }

  /** Record a failed attempt. Returns the cooldown in seconds if this failure triggered a lockout, else 0. */
  fail(key: string): number {
    this.gc();
    const t = this.now();
    const e = this.entries.get(key) ?? { fails: 0, lockouts: 0, lockedUntil: 0, last: t };
    e.last = t;
    e.fails++;
    let cooldown = 0;
    if (e.fails >= this.maxFails) {
      e.lockouts++;
      cooldown = Math.min(this.base * 2 ** (e.lockouts - 1), this.cap);
      e.lockedUntil = t + cooldown;
      e.fails = 0;
    }
    this.entries.set(key, e);
    return Math.ceil(cooldown / 1000);
  }

  success(key: string) { this.entries.delete(key); }
}

/** Simple fixed-window counter, e.g. "10 onboarding starts per IP per 10 minutes". */
export class WindowLimiter {
  private hits = new Map<string, { n: number; resetAt: number }>();
  constructor(private max: number, private windowMs: number, private now: () => number = Date.now) {}
  /** Returns true if the request is allowed (and counts it). */
  hit(key: string): boolean {
    const t = this.now();
    const h = this.hits.get(key);
    if (!h || h.resetAt <= t) { this.hits.set(key, { n: 1, resetAt: t + this.windowMs }); return true; }
    if (h.n >= this.max) return false;
    h.n++;
    return true;
  }
}
