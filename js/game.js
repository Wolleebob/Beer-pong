import {
  CUP_COUNT,
  CUP_SPACING,
  CUP_RADIUS,
  RACK_Z,
  MATCH_LIVES,
} from './config.js';
import { saveStore } from './store.js';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const lerp = (a, b, t) => a + (b - a) * t;

/* =========================================================
   Physics tuning
   ========================================================= */

const GRAVITY = 1500; // px/s²
const AIR_DRAG = 0.18; // linear drag, 1/s
const BALL_RADIUS = 8.4; // screen px
const LAUNCH_Z = 0.04;
const LAUNCH_H = 14;
const TABLE_BOUNCE = 0.42;
const RIM_BOUNCE = 0.36;
const TABLE_FRICTION = 0.66;
const ROLL_FRICTION = 6;
const MAX_FLIGHT_TIME = 3.2;
const MAX_STEP = 1 / 180;

// The cups are lined up along z, so the mouth is a very tight ellipse in
// world space. The outer ring is the rim; the inner one is the opening.
const CUP_INNER_X = CUP_RADIUS * 0.86;
const CUP_INNER_Z = 0.024;
const CUP_OUTER_X = CUP_RADIUS * 1.04;
const CUP_OUTER_Z = 0.042;

function gauss() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function makeCups() {
  const cups = [];
  for (let i = 0; i < CUP_COUNT; i += 1) {
    cups.push({
      id: `cup-${i}`,
      x: 0,
      z: RACK_Z + i * CUP_SPACING,
      state: 'up',
      anim: 0,
      wobble: 0,
      flash: 0,
    });
  }
  return cups;
}

function makeBall() {
  return {
    visible: false,
    live: false,
    x: 0,
    z: LAUNCH_Z,
    h: LAUNCH_H,
    vx: 0,
    vz: 0,
    vh: 0,
    trail: [],
    fire: false,
    age: 0,
    bounces: 0,
    rolling: false,
    falling: false,
    rimTouched: false,
    lastRimCup: null,
    lastContact: null,
    rimSoundPlayed: false,
    bounceSoundPlayed: false,
    bodyCooldown: 0,
  };
}

function makeAim() {
  return { active: false, x: 0, z: 0.84, sx: 0, sy: 0, pointerId: null };
}

export class Game {
  constructor(renderer, audio, store, hooks = {}) {
    this.renderer = renderer;
    this.audio = audio;
    this.store = store;
    this.hooks = hooks;

    this.mode = 'match';
    this.lastMode = 'match';
    this.phase = 'menu';
    this.paused = false;
    this.cups = makeCups();
    this.score = 0;
    this.throws = 0;
    this.hits = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.bestScore = store.stats.bestScore || 0;
    this.lives = MATCH_LIVES;
    this.timer = 0;
    this.pending = null;
    // A small upward bias keeps the finger from covering the target and
    // lines the throw up with the cup opening, not the cup body.
    this.aimOffset = 10;
    this.ball = makeBall();
    this.aim = makeAim();
  }

  get rack() {
    return this.cups;
  }

  resetDemo() {
    this.mode = 'match';
    this.lastMode = 'match';
    this.phase = 'menu';
    this.paused = false;
    this.cups = makeCups();
    this.score = 0;
    this.throws = 0;
    this.hits = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.bestScore = this.store.stats.bestScore || 0;
    this.lives = MATCH_LIVES;
    this.timer = 0;
    this.pending = null;
    this.ball = makeBall();
    this.aim = makeAim();
  }

  start(mode) {
    const safeMode = mode === 'practice' ? 'practice' : 'match';
    this.mode = safeMode;
    this.lastMode = safeMode;
    this.cups = makeCups();
    this.score = 0;
    this.throws = 0;
    this.hits = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.bestScore = this.store.stats.bestScore || 0;
    this.lives = safeMode === 'match' ? MATCH_LIVES : Infinity;
    this.timer = 0;
    this.pending = null;
    this.paused = false;
    this.phase = 'aim';
    this.ball = makeBall();
    this.aim = makeAim();

    this.audio.unlock();
    this.audio.play('turn');
    this.hooks.onStart?.();
    this.pushHud();
    this.hooks.toast?.(
      safeMode === 'practice' ? 'Treino livre · rack infinito' : 'Partida real · 3 chances',
      'turn',
    );
  }

  restart() {
    this.start(this.lastMode);
  }

  toMenu() {
    this.resetDemo();
    this.pushHud();
  }

  pause() {
    if (this.phase === 'menu' || this.phase === 'over') return;
    this.paused = true;
  }

  resume() {
    this.paused = false;
    this.audio.unlock();
  }

  /* =========================================================
     Loop
     ========================================================= */

  update(dt) {
    if (this.paused) return;

    for (const cup of this.cups) {
      if (cup.wobble > 0) cup.wobble = Math.max(0, cup.wobble - dt * 3.4);
      if (cup.flash > 0) cup.flash = Math.max(0, cup.flash - dt * 2.2);
    }

    if (this.timer > 0) {
      this.timer -= dt;
      if (this.timer <= 0 && this.pending) {
        const action = this.pending;
        this.pending = null;
        this.timer = 0;
        action();
      }
    }

    if (this.ball.live) {
      this.stepBall(dt);
      if (this.ball.live && this.ball.visible) {
        this.ball.trail.push({ x: this.ball.x, z: this.ball.z, h: this.ball.h });
        if (this.ball.trail.length > 10) this.ball.trail.shift();
      }
    }
  }

  schedule(delay, action) {
    this.timer = delay;
    this.pending = action;
  }

  /* =========================================================
     Input
     ========================================================= */

  canAim() {
    return this.phase === 'aim' && !this.paused;
  }

  pointerDown(sx, sy, pointerId) {
    if (!this.canAim()) return;
    this.aim.active = true;
    this.aim.pointerId = pointerId;
    this.audio.unlock();
    this.updateAim(sx, sy);
  }

  pointerMove(sx, sy, pointerId) {
    if (!this.aim.active || this.aim.pointerId !== pointerId) return;
    this.updateAim(sx, sy);
  }

  pointerUp(sx, sy, pointerId) {
    if (!this.aim.active || this.aim.pointerId !== pointerId) return;
    this.aim.pointerId = null;
    this.updateAim(sx, sy);
    this.aim.active = false;
    this.throwBall();
  }

  pointerCancel(pointerId) {
    if (this.aim.pointerId !== pointerId) return;
    this.aim.pointerId = null;
    this.aim.active = false;
  }

  updateAim(sx, sy) {
    const plane = this.renderer.unproject(sx, sy - this.aimOffset);
    this.aim.x = clamp(plane.x, -0.95, 0.95);
    this.aim.z = clamp(plane.z, 0.34, 0.97);
    this.aim.sx = sx;
    this.aim.sy = sy;
  }

  /* =========================================================
     Throws
     ========================================================= */

  throwBall() {
    if (this.phase !== 'aim') return;
    const { x, z } = this.aim;
    const p = this.renderer.project(x, z);

    // Small hand shake: enough to make the shot feel alive, not enough to
    // punish a well-placed drag.
    const sigma = 2.6 + z * 4.2;
    const sx = p.x + gauss() * sigma;
    const sy = p.y + gauss() * sigma * 0.9;
    const landing = this.renderer.unproject(sx, sy);

    const tx = clamp(landing.x, -0.95, 0.95);
    const tz = clamp(landing.z, 0.38, 0.97);
    this.launch(tx, tz);
  }

  launch(tx, tz) {
    this.phase = 'flight';
    this.aim.active = false;
    this.aim.pointerId = null;
    this.throws += 1;
    this.store.stats.throws += 1;
    saveStore(this.store);

    // Solve the launch velocities so the ball reaches (tx, tz) at table
    // height, using the same linear drag + gravity model as the simulation.
    const flightTime = 0.55 + Math.max(0, tz - LAUNCH_Z) * 0.52;
    const decay = Math.exp(-AIR_DRAG * flightTime);
    const inv = AIR_DRAG / (1 - decay);
    const terminal = GRAVITY / AIR_DRAG;

    const vx = tx * inv;
    const vz = (tz - LAUNCH_Z) * inv;
    const vh =
      (BALL_RADIUS - LAUNCH_H + terminal * flightTime) * inv - terminal;

    const ball = makeBall();
    ball.visible = true;
    ball.live = true;
    ball.x = 0;
    ball.z = LAUNCH_Z;
    ball.h = LAUNCH_H;
    ball.vx = vx;
    ball.vz = vz;
    ball.vh = vh;
    ball.fire = this.streak >= 2;
    this.ball = ball;

    this.audio.play('throw');
    this.pushHud();
  }

  /* =========================================================
     Ball simulation
     ========================================================= */

  stepBall(dt) {
    let remaining = Math.min(dt, 0.06);
    let guard = 0;
    while (remaining > 0 && this.ball.live && guard < 14) {
      const step = Math.min(MAX_STEP, remaining);
      remaining -= step;
      guard += 1;
      this.stepBallOnce(step);
    }
  }

  stepBallOnce(dt) {
    const b = this.ball;
    b.age += dt;
    if (b.bodyCooldown > 0) b.bodyCooldown = Math.max(0, b.bodyCooldown - dt);

    if (b.age > MAX_FLIGHT_TIME) {
      this.settleBall();
      return;
    }

    if (b.falling) {
      b.vh -= GRAVITY * dt;
      b.h += b.vh * dt;
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      b.vx *= Math.exp(-AIR_DRAG * dt);
      b.vz *= Math.exp(-AIR_DRAG * dt);
      if (b.h < -80) this.settleBall();
      return;
    }

    if (b.rolling) {
      const friction = Math.exp(-ROLL_FRICTION * dt);
      b.vx *= friction;
      b.vz *= friction;
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      b.h = BALL_RADIUS;
      b.vh = 0;
      this.checkRollingCup();
      if (b.falling) return;
      if (this.isOffTable(b.x, b.z)) {
        b.falling = true;
        b.rolling = false;
        return;
      }
      if (Math.hypot(b.vx, b.vz) < 0.05) this.settleBall();
      return;
    }

    const prevX = b.x;
    const prevZ = b.z;
    const prevH = b.h;

    const decay = Math.exp(-AIR_DRAG * dt);
    const travel = (1 - decay) / AIR_DRAG;

    b.x += b.vx * travel;
    b.z += b.vz * travel;
    b.vx *= decay;
    b.vz *= decay;

    const vh0 = b.vh;
    const terminal = GRAVITY / AIR_DRAG;
    b.vh = (vh0 + terminal) * decay - terminal;
    b.h += (vh0 + terminal) * travel - terminal * dt;

    // Only resolve cup/table collisions while the ball is falling through
    // the table plane. The exact crossing is interpolated between frames.
    if (b.vh < 0 && prevH >= BALL_RADIUS && b.h <= BALL_RADIUS) {
      const alpha = clamp(
        (prevH - BALL_RADIUS) / Math.max(1e-6, prevH - b.h),
        0,
        1,
      );
      const cx = lerp(prevX, b.x, alpha);
      const cz = lerp(prevZ, b.z, alpha);
      this.handlePlaneCrossing(cx, cz);
      return;
    }

    // Safety net: never let the ball sink through the table unnoticed.
    if (b.h < BALL_RADIUS - 1 && b.vh < 0) {
      this.handlePlaneCrossing(b.x, b.z);
    }
  }

  handlePlaneCrossing(x, z) {
    const b = this.ball;
    b.x = x;
    b.z = z;
    b.h = BALL_RADIUS;

    if (b.vh < -10) {
      const cup = this.findCup(x, z, CUP_INNER_X, CUP_INNER_Z);
      if (cup) {
        const point = this.renderer.project(x, z);
        b.live = false;
        b.visible = false;
        b.lastContact = { x, z };
        this.registerHit(cup, point);
        this.resolveThrow('hit', cup, point);
        return;
      }
    }

    const rimCup = this.findCup(x, z, CUP_OUTER_X, CUP_OUTER_Z);
    if (rimCup) {
      this.bounceOffRim(rimCup, x, z);
      return;
    }

    if (this.isOffTable(x, z)) {
      b.falling = true;
      b.rolling = false;
      b.vh = Math.min(b.vh, -60);
      return;
    }

    // Table bounce. The ball loses most of its horizontal energy and a big
    // chunk of its vertical energy, then starts rolling when the hop is tiny.
    b.vh = -b.vh * TABLE_BOUNCE;
    b.vx *= TABLE_FRICTION;
    b.vz *= TABLE_FRICTION;
    b.bounces += 1;
    b.lastContact = { x, z };

    if (!b.bounceSoundPlayed) {
      this.audio.play('bounce');
      b.bounceSoundPlayed = true;
    }
    const point = this.renderer.project(x, z);
    this.renderer.bounce(point.x, point.y);

    if (b.vh < 65 || Math.hypot(b.vx, b.vz) < 0.08) {
      b.vh = 0;
      b.h = BALL_RADIUS;
      b.rolling = true;
    }
  }

  findCup(x, z, rx, rz) {
    let best = null;
    let bestDist = Infinity;
    for (const cup of this.cups) {
      if (cup.state !== 'up') continue;
      const dx = (x - cup.x) / rx;
      const dz = (z - cup.z) / rz;
      const dist = Math.hypot(dx, dz);
      if (dist <= 1 && dist < bestDist) {
        best = cup;
        bestDist = dist;
      }
    }
    return best;
  }

  bounceOffRim(cup, x, z) {
    const b = this.ball;
    b.x = x;
    b.z = z;
    b.h = BALL_RADIUS + 1.5;
    b.lastRimCup = cup;
    b.rimTouched = true;
    b.lastContact = { x, z };

    const dx = x - cup.x;
    const dz = z - cup.z;
    let nx = dx / (CUP_OUTER_X * CUP_OUTER_X);
    let nz = dz / (CUP_OUTER_Z * CUP_OUTER_Z);
    let len = Math.hypot(nx, nz);
    if (len < 1e-6) {
      nx = 0;
      nz = 1;
      len = 1;
    }
    nx /= len;
    nz /= len;

    const vn = b.vx * nx + b.vz * nz;
    if (vn < 0) {
      b.vx -= (1 + RIM_BOUNCE) * vn * nx;
      b.vz -= (1 + RIM_BOUNCE) * vn * nz;
    }
    b.vx = b.vx * 0.55 + (Math.random() - 0.5) * 0.06;
    b.vz = b.vz * 0.55 + (Math.random() - 0.5) * 0.05;
    b.vh = Math.abs(b.vh) * 0.3 + 55;

    // Nudge the ball out of the rim footprint so it does not re-collide
    // on the very next substep.
    b.x += nx * 0.008;
    b.z += nz * 0.006;

    const point = this.renderer.project(x, z);
    this.renderer.rimSpark(point.x, point.y);
    if (!b.rimSoundPlayed) {
      this.audio.play('rim');
      b.rimSoundPlayed = true;
    }
  }

  checkRollingCup() {
    const b = this.ball;
    if (b.bodyCooldown > 0) return;
    const cup = this.findCup(b.x, b.z, CUP_OUTER_X, CUP_OUTER_Z);
    if (!cup) return;

    const dx = b.x - cup.x;
    const dz = b.z - cup.z;
    let nx = dx / (CUP_OUTER_X * CUP_OUTER_X);
    let nz = dz / (CUP_OUTER_Z * CUP_OUTER_Z);
    let len = Math.hypot(nx, nz);
    if (len < 1e-6) {
      nx = 0;
      nz = 1;
      len = 1;
    }
    nx /= len;
    nz /= len;

    const vn = b.vx * nx + b.vz * nz;
    if (vn < 0) {
      b.vx -= 1.5 * vn * nx;
      b.vz -= 1.5 * vn * nz;
    }
    b.vx *= 0.45;
    b.vz *= 0.45;
    b.x += nx * 0.012;
    b.z += nz * 0.012;
    b.lastRimCup = cup;
    b.rimTouched = true;
    b.lastContact = { x: b.x, z: b.z };
    b.bodyCooldown = 0.12;

    if (!b.rimSoundPlayed) {
      this.audio.play('rim');
      b.rimSoundPlayed = true;
    }
    const point = this.renderer.project(b.x, b.z);
    this.renderer.rimSpark(point.x, point.y);
  }

  isOffTable(x, z) {
    return Math.abs(x) > 1 || z < 0 || z > 1;
  }

  settleBall() {
    const b = this.ball;
    if (!b.live) return;
    b.live = false;
    b.visible = false;
    b.rolling = false;

    const contact =
      b.rimTouched && b.lastContact ? b.lastContact : { x: b.x, z: b.z };
    const cx = clamp(contact.x, -0.98, 0.98);
    const cz = clamp(contact.z, 0.01, 0.99);
    const point = this.renderer.project(cx, cz);

    if (b.rimTouched) {
      this.registerRim(b.lastRimCup, point);
      this.resolveThrow('rim', b.lastRimCup, point);
    } else {
      this.registerMiss(point);
      this.resolveThrow('miss', null, point);
    }
  }

  resolveThrow(outcome, cup, point) {
    this.phase = 'resolve';
    this.aim.active = false;
    this.aim.pointerId = null;

    const cleared =
      this.mode === 'practice' && this.cups.every((c) => c.state === 'hit');
    this.pushHud();

    if (outcome === 'hit' && cleared) {
      this.schedule(0.95, () => this.refill());
    } else if (this.mode === 'match' && this.lives <= 0) {
      this.schedule(0.9, () => this.finish());
    } else {
      this.schedule(0.75, () => this.beginAim());
    }
  }

  beginAim() {
    this.phase = 'aim';
    this.aim.active = false;
    this.aim.pointerId = null;
    this.ball = makeBall();
    this.pushHud();
  }

  refill() {
    this.cups = makeCups();
    this.phase = 'aim';
    this.aim.active = false;
    this.aim.pointerId = null;
    this.ball = makeBall();
    this.audio.play('refill');
    this.hooks.toast?.('Rack limpo! Novo rack…', 'good');
    this.pushHud();
  }

  registerHit(cup, point) {
    cup.wobble = 1;
    cup.flash = 1;
    if (this.mode === 'practice') {
      cup.state = 'hit';
      cup.anim = 0;
    }

    this.audio.play('cup');
    this.renderer.splash(point.x, point.y, 1);
    this.renderer.shake = this.renderer.reducedMotion ? 0 : 11;
    this.renderer.float(
      point.x,
      point.y - 32,
      ['NA CESTA!', 'BOA!', '+1', 'CRAVOU!', 'PERFEITO!'][(Math.random() * 5) | 0],
      '#ffd166',
    );

    this.score += 1;
    this.hits += 1;
    this.streak += 1;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    this.bestScore = Math.max(this.bestScore, this.score);

    this.store.stats.hits += 1;
    this.store.stats.bestStreak = Math.max(this.store.stats.bestStreak, this.bestStreak);
    this.store.stats.bestScore = Math.max(this.store.stats.bestScore, this.bestScore);
    saveStore(this.store);

    this.hooks.vibrate?.(28);
    if (this.streak === 3) {
      this.hooks.toast?.('Em chamas! 🔥', 'hot');
    } else if (this.streak > 3 && this.streak % 5 === 0) {
      this.hooks.toast?.(`Sequência de ${this.streak}! 🔥`, 'hot');
    }
  }

  registerRim(cup, point) {
    if (cup) cup.wobble = 1;
    this.renderer.shake = this.renderer.reducedMotion ? 0 : 5;
    this.renderer.float(point.x, point.y - 26, 'Na borda!', '#ff8fa3');
    this.streak = 0;
    if (this.mode === 'match') this.loseLife();
    this.hooks.vibrate?.(10);
  }

  registerMiss(point) {
    if (!this.ball.bounceSoundPlayed) this.audio.play('bounce');
    this.renderer.float(point.x, point.y - 20, 'Errou', '#a7b6ca');
    this.streak = 0;
    if (this.mode === 'match') this.loseLife();
  }

  loseLife() {
    this.lives = Math.max(0, this.lives - 1);
    if (this.lives === 1) this.hooks.toast?.('Última chance!', 'hot');
  }

  finish() {
    this.phase = 'over';
    this.aim.active = false;
    this.aim.pointerId = null;
    this.ball = makeBall();
    this.timer = 0;
    this.pending = null;

    this.store.stats.bestScore = Math.max(this.store.stats.bestScore, this.bestScore);
    this.store.stats.bestStreak = Math.max(this.store.stats.bestStreak, this.bestStreak);
    saveStore(this.store);

    this.audio.play('lose');
    this.renderer.shake = this.renderer.reducedMotion ? 0 : 14;
    this.hooks.vibrate?.([40, 60, 60]);

    const accuracy = this.throws ? Math.round((this.hits / this.throws) * 100) : 0;
    this.hooks.gameOver?.({
      mode: this.mode,
      score: this.score,
      throws: this.throws,
      hits: this.hits,
      accuracy,
      bestStreak: this.bestStreak,
      bestScore: this.bestScore,
    });
    this.pushHud();
  }

  /* =========================================================
     HUD
     ========================================================= */

  pushHud() {
    const accuracy = this.throws
      ? Math.round((this.hits / this.throws) * 100)
      : 0;
    this.hooks.hud?.({
      mode: this.mode,
      phase: this.phase,
      score: this.score,
      throws: this.throws,
      hits: this.hits,
      accuracy,
      streak: this.streak,
      bestStreak: this.bestStreak,
      bestScore: this.bestScore,
      lives: this.mode === 'match' ? this.lives : null,
      cupsLeft: this.cups.filter((c) => c.state === 'up').length,
    });
  }
}
