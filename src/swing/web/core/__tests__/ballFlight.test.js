// The same synthetic face-on frames as BallFlightTest.kt: grass with a texture, a ball lit from above
// (top half white, bottom half grey) launched toward the target at LAUNCH degrees, V px a frame, and
// the clubhead a bright block sliding in along the ground.
import { BallFlight } from '../ballFlight';
import { Gray } from '../geom';

const W = 480;
const H = 240;
const BX = 80;
const BY = 200;
const D = 14;
const IMPACT = 20;
const V = 32;
const LAUNCH = 20;
const CLUB_V = 24;
const rad = (deg) => (deg * Math.PI) / 180;

const grass = (x, y) => 90 + ((x * 7 + y * 13) % 11);

function frame(f, sgn = 1, restX = BX, turf = false) {
  const px = new Uint8Array(W * H);
  const k = f - IMPACT;
  const ball = f <= IMPACT ? [restX, BY] : [restX + sgn * V * k * Math.cos(rad(LAUNCH)), BY - V * k * Math.sin(rad(LAUNCH))];
  const cx = f >= IMPACT - 4 && f <= IMPACT ? restX - sgn * CLUB_V * (IMPACT - f) - (sgn * D) / 2 : null;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      let v = grass(x, y);
      if (Math.hypot(x - ball[0], y - ball[1]) <= D / 2) v = y <= ball[1] ? 245 : 120;
      // flying turf: a bright clump leaving the ball's spot slowly along the ground
      if (turf && k > 0 && Math.hypot(x - (restX + sgn * 10 * k), y - (BY - 1.5 * k)) <= D / 2) v = 220;
      if (cx != null && y >= Math.trunc(BY - 1.2 * D) && y <= Math.trunc(BY + 0.4 * D)) {
        const r = (x - cx) * sgn;
        if (r >= -1.6 * D && r <= 0) v = 230;
      }
      px[y * W + x] = v;
    }
  }
  return new Gray(0, 0, W, H, px);
}

function sampled(g, r, step) {
  const nx = Math.trunc((r.w + step - 1) / step);
  const ny = Math.trunc((r.h + step - 1) / step);
  const out = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j += 1) for (let i = 0; i < nx; i += 1) out[j * nx + i] = g.px[(r.y0 + j * step) * W + r.x0 + i * step];
  return new Gray(0, 0, nx, ny, out);
}

function patch(g, r) {
  const out = new Uint8Array(r.w * r.h);
  for (let j = 0; j < r.h; j += 1) for (let i = 0; i < r.w; i += 1) out[j * r.w + i] = g.px[(r.y0 + j) * W + r.x0 + i];
  return new Gray(r.x0, r.y0, r.w, r.h, out);
}

function run(step, sgn = 1, ballX = BX, turf = false, guess = IMPACT) {
  const top = 5;
  const n = 40;
  const rect = BallFlight.area(ballX, BY, D, sgn, W, H);
  const pr = BallFlight.patch(ballX, BY, D, W, H);
  const bgF = BallFlight.bgFrames(top, n).map((f) => frame(f, sgn, ballX, turf));
  const frames = new Map([...BallFlight.clubFrames(guess, n), ...BallFlight.flightFrames(guess, n)].map((f) => [f, sampled(frame(f, sgn, ballX, turf), rect, step)]));
  return BallFlight.measure(bgF.map((g) => sampled(g, rect, step)), bgF.map((g) => patch(g, pr)), frames, rect, step, ballX, BY, D * 1.2, sgn, guess, 240);
}

const launchOf = (b, sgn = 1) => (Math.atan2(-b.vy, sgn * b.vx) * 180) / Math.PI;

describe('BallFlight (port of BallFlight.kt)', () => {
  test('a half-lit ball measures its whole diameter, whatever the guess', () => {
    const pr = BallFlight.patch(BX, BY, D, W, H);
    const g = patch(frame(0), pr);
    [0.8 * D, D, 1.25 * D].forEach((guess) => {
      const [x, y, d] = BallFlight.diameter(g, BX + 2, BY - 1, guess);
      expect(Math.abs(d - D)).toBeLessThanOrEqual(1);
      expect(Math.abs(x - BX)).toBeLessThanOrEqual(1);
      expect(Math.abs(y - (BY - D / 4))).toBeLessThanOrEqual(1.5);
    });
  });

  test('the flight gives the speed and the launch', () => {
    const r = run(1);
    expect(Math.abs(Math.hypot(r.ball.vx, r.ball.vy) - V)).toBeLessThanOrEqual(V * 0.02);
    expect(Math.abs(launchOf(r.ball) - LAUNCH)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.d - D)).toBeLessThanOrEqual(1);
  });

  test('sampled every other pixel it reads the same', () => {
    const r = run(2);
    expect(Math.abs(Math.hypot(r.ball.vx, r.ball.vy) - V)).toBeLessThanOrEqual(V * 0.03);
    expect(Math.abs(r.club - CLUB_V)).toBeLessThanOrEqual(CLUB_V * 0.1);
  });

  test('the clubhead comes in behind the ball', () => {
    const r = run(1);
    expect(Math.abs(r.club - CLUB_V)).toBeLessThanOrEqual(CLUB_V * 0.05);
    expect(r.clubPoints).toBe(3);
  });

  test('a left-hander mirrors', () => {
    const r = run(1, -1, 400);
    expect(Math.abs(Math.hypot(r.ball.vx, r.ball.vy) - V)).toBeLessThanOrEqual(V * 0.02);
    expect(Math.abs(launchOf(r.ball, -1) - LAUNCH)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.club - CLUB_V)).toBeLessThanOrEqual(CLUB_V * 0.05);
  });

  test('the ball, not the turf that leaves its spot with it: the run that covers the most ground', () => {
    const r = run(1, 1, BX, true);
    expect(Math.abs(Math.hypot(r.ball.vx, r.ball.vy) - V)).toBeLessThanOrEqual(V * 0.02);
  });

  test('a pose impact a few frames off: the flight times the contact, and the club with it', () => {
    [IMPACT - 3, IMPACT + 3].forEach((guess) => {
      const r = run(1, 1, BX, false, guess);
      expect(r.contact).toBe(IMPACT);
      expect(Math.abs(Math.hypot(r.ball.vx, r.ball.vy) - V)).toBeLessThanOrEqual(V * 0.02);
      expect(Math.abs(r.club - CLUB_V)).toBeLessThanOrEqual(CLUB_V * 0.05);
    });
  });

  test('no ball in flight means no ball speed', () => {
    const rect = BallFlight.area(BX, BY, D, 1, W, H);
    const pr = BallFlight.patch(BX, BY, D, W, H);
    const still = frame(0);
    const bg = BallFlight.bgFrames(5, 40).map(() => still);
    const frames = new Map(BallFlight.flightFrames(IMPACT, 40).map((f) => [f, sampled(still, rect, 1)]));
    const r = BallFlight.measure(bg.map((g) => sampled(g, rect, 1)), bg.map((g) => patch(g, pr)), frames, rect, 1, BX, BY, D, 1, IMPACT, 240);
    expect(r.ball).toBeNull();
    expect(r.club).toBeNull();
  });

  test('the step keeps the ball near eight samples', () => {
    expect([12, 17, 24].map((d) => BallFlight.step(d))).toEqual([1, 2, 3]);
  });
});
