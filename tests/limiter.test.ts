import { describe, expect, it } from "vitest";
import { LoginLimiter, WindowLimiter } from "../src/auth/limiter.js";

describe("LoginLimiter", () => {
  const mk = () => { let t = 1_000_000; const l = new LoginLimiter({ now: () => t }); return { l, advance: (ms: number) => { t += ms; } }; };
  it("allows 4 failures, locks on the 5th, then cools down", () => {
    const { l, advance } = mk();
    for (let i = 0; i < 4; i++) { expect(l.check("ip").allowed).toBe(true); expect(l.fail("ip")).toBe(0); }
    expect(l.check("ip").allowed).toBe(true);
    expect(l.fail("ip")).toBe(60); // 5th failure -> 60 s lockout
    const c = l.check("ip");
    expect(c.allowed).toBe(false);
    expect(!c.allowed && c.retryAfterSec).toBe(60);
    advance(59_000);
    expect(l.check("ip").allowed).toBe(false);
    advance(2_000);
    expect(l.check("ip").allowed).toBe(true);
  });
  it("doubles the cooldown on repeated lockouts and caps it at 15 minutes", () => {
    const { l, advance } = mk();
    const lock = () => { let s = 0; for (let i = 0; i < 5; i++) s = l.fail("ip"); return s; };
    expect(lock()).toBe(60); advance(61_000);
    expect(lock()).toBe(120); advance(121_000);
    expect(lock()).toBe(240); advance(241_000);
    expect(lock()).toBe(480); advance(481_000);
    expect(lock()).toBe(900); advance(901_000);
    expect(lock()).toBe(900);
  });
  it("is per key and a success resets the counter", () => {
    const { l } = mk();
    for (let i = 0; i < 5; i++) l.fail("a");
    expect(l.check("a").allowed).toBe(false);
    expect(l.check("b").allowed).toBe(true);
    for (let i = 0; i < 4; i++) l.fail("b");
    l.success("b");
    for (let i = 0; i < 4; i++) l.fail("b");
    expect(l.check("b").allowed).toBe(true); // counter restarted after the success
  });
});

describe("WindowLimiter", () => {
  it("allows max hits per window then blocks until the window passes", () => {
    let t = 0; const w = new WindowLimiter(3, 1000, () => t);
    expect([w.hit("x"), w.hit("x"), w.hit("x"), w.hit("x")]).toEqual([true, true, true, false]);
    expect(w.hit("y")).toBe(true);
    t = 1001;
    expect(w.hit("x")).toBe(true);
  });
});
