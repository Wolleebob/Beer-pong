import { CUP_COUNT, CUP_SPACING, RACK_Z, MATCH_LIVES } from './config.js';
import { saveStore } from './store.js';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const lerp = (a, b, t) => a + (b - a) * t;

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
  return { visible: false, x: 0, z: 0, h: 0, trail: [], fire: false };
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
    this.aimOffset = 56;
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

    if (this.phase === 'flight') {
      const b = this.ball;
      b.p = Math.min(1, b.p + dt / b.T);
      const t = b.p;
      b.x = lerp(b.x0, b.x1, t);
      b.z = lerp(b.z0, b.z1, t);
      b.h = 4 * b.arc * t * (1 - t);
      b.trail.push({ x: b.x, z: b.z, h: b.h });
      if (b.trail.length > 9) b.trail.shift();
      if (b.p >= 1) this.land();
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
    this.aim.x = clamp(plane.x, -0.94, 0.94);
    this.aim.z = clamp(plane.z, 0.28, 0.965);
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

    // Aimed shots are good but not perfect — tiny hand shake grows with distance.
    const sigma = 4.2 + z * 6;
    const sx = p.x + gauss() * sigma;
    const sy = p.y + gauss() * sigma * 0.8;
    const landing = this.renderer.unproject(sx, sy);

    const tx = clamp(landing.x, -0.95, 0.95);
    const tz = clamp(landing.z, 0.5, 0.97);
    this.launch(tx, tz);
  }

  launch(tx, tz) {
    this.phase = 'flight';
    this.aim.active = false;
    this.aim.pointerId = null;
    this.throws += 1;
    this.store.stats.throws += 1;
    saveStore(this.store);

    this.ball = {
      visible: true,
      x: 0,
      z: 0.02,
      h: 0,
      x0: 0,
      z0: 0.02,
      x1: tx,
      z1: tz,
      p: 0,
      T: 0.6 + tz * 0.42,
      arc: 92 + tz * 92,
      trail: [],
      fire: this.streak >= 2,
    };
    this.audio.play('throw');
    this.pushHud();
  }

  land() {
    const b = this.ball;
    b.visible = false;
    this.phase = 'resolve';

    const landing = this.renderer.project(b.x1, b.z1);
    let best = null;
    let bestDist = Infinity;

    for (const cup of this.cups) {
      if (cup.state !== 'up') continue;
      const cs = this.renderer.cupScreen(cup);
      const dx = (landing.x - cs.x) / cs.rx;
      const dy = (landing.y - cs.y) / (cs.ry * 2.05);
      const dist = Math.hypot(dx, dy);
      if (dist < bestDist) {
        bestDist = dist;
        best = cup;
      }
    }

    if (best && bestDist <= 1) {
      this.registerHit(best, landing);
    } else if (best && bestDist <= 1.65) {
      this.registerRim(best, landing);
    } else {
      this.registerMiss(landing);
    }

    const cleared = this.mode === 'practice' && this.cups.every((c) => c.state === 'hit');
    this.pushHud();

    if (cleared) {
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
    this.pushHud();
  }

  refill() {
    this.cups = makeCups();
    this.phase = 'aim';
    this.audio.play('refill');
    this.hooks.toast?.('Rack limpo! Novo rack…', 'good');
    this.pushHud();
  }

  registerHit(cup, landing) {
    cup.wobble = 1;
    cup.flash = 1;
    if (this.mode === 'practice') {
      cup.state = 'hit';
      cup.anim = 0;
    }

    this.audio.play('splash');
    this.renderer.splash(landing.x, landing.y, 1);
    this.renderer.shake = this.renderer.reducedMotion ? 0 : 11;
    this.renderer.float(
      landing.x,
      landing.y - 32,
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

  registerRim(cup, landing) {
    cup.wobble = 1;
    this.audio.play('rim');
    this.renderer.bounce(landing.x, landing.y);
    this.renderer.float(landing.x, landing.y - 26, 'Na borda!', '#ff8fa3');
    this.streak = 0;
    if (this.mode === 'match') this.loseLife();
    this.hooks.vibrate?.(10);
  }

  registerMiss(landing) {
    this.audio.play('bounce');
    this.renderer.bounce(landing.x, landing.y);
    this.renderer.float(landing.x, landing.y - 20, 'Errou', '#a7b6ca');
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
    this.ball.visible = false;
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
