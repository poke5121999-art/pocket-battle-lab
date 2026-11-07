// VFX player. Loads fx.json + sprite sheets by absolute URL from our own CC0 site (pocket-battle-vfx) at runtime.
// Everything fails soft: no network / no fx.json => the caller falls back to a simple flash (see app.js).

export const FX_BASE = "https://poke5121999-art.github.io/pocket-battle-vfx/";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const imgCache = new Map();
function loadImg(src) {
  if (!imgCache.has(src)) {
    imgCache.set(src, new Promise((res) => {
      const i = new Image();
      i.crossOrigin = "anonymous";
      i.onload = () => res(i);
      i.onerror = () => res(null);
      i.src = src;
    }));
  }
  return imgCache.get(src);
}
// light sheets are premultiplied; undo once so "lighter" adds exactly the stored light
const lightCache = new Map();
function loadLight(base, d) {
  if (!d.light) return Promise.resolve(null);
  if (!lightCache.has(d.id)) {
    lightCache.set(d.id, loadImg(base + d.light.image).then((img) => {
      if (!img) return null;
      try {
        const c = document.createElement("canvas");
        c.width = img.width; c.height = img.height;
        const x = c.getContext("2d");
        x.drawImage(img, 0, 0);
        const id = x.getImageData(0, 0, img.width, img.height), a = id.data;
        for (let i = 0; i < a.length; i += 4) {
          const al = a[i + 3];
          if (al) { a[i] = Math.min(255, (a[i] * 255) / al); a[i + 1] = Math.min(255, (a[i + 1] * 255) / al); a[i + 2] = Math.min(255, (a[i + 2] * 255) / al); }
        }
        x.putImageData(id, 0, 0);
        return c;
      } catch { return null; }
    }));
  }
  return lightCache.get(d.id);
}

export class Vfx {
  constructor(canvas, stageEl, plates) {
    this.cv = canvas;
    this.stage = stageEl;
    this.plates = plates; // {A: el, B: el}
    this.ctx = canvas.getContext("2d");
    this.fx = null; this.byId = {}; this.byMove = new Map();
    this.actors = [];
    this.running = false;
    this.ok = false;
    this.lastFrame = null; // for tests/screens: {id, t}
    this.played = [];
  }
  async init(base = FX_BASE) {
    this.base = base;
    try {
      const r = await fetch(base + "fx.json", { cache: "force-cache" });
      if (!r.ok) throw new Error("fx.json " + r.status);
      this.fx = await r.json();
    } catch (e) { this.ok = false; return false; }
    for (const d of this.fx.effects) {
      this.byId[d.id] = d;
      for (const m of d.moves || []) {
        const name = m.replace(/\s*\(.*\)\s*$/, "");
        const tag = /\((.*)\)/.exec(m)?.[1] || "";
        if (!this.byMove.has(name)) this.byMove.set(name, []);
        this.byMove.get(name).push({ d, tag });
      }
    }
    this.ok = true;
    return true;
  }
  size() {
    const r = this.stage.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.cv.width !== Math.round(r.width * dpr) || this.cv.height !== Math.round(r.height * dpr)) {
      this.cv.width = Math.round(r.width * dpr); this.cv.height = Math.round(r.height * dpr);
    }
    return { w: r.width, h: r.height, dpr, left: r.left, top: r.top };
  }
  center(side) {
    const s = this.size();
    const r = this.plates[side].getBoundingClientRect();
    return { x: r.left - s.left + r.width / 2, y: r.top - s.top + r.height / 2, h: r.height, w: r.width };
  }
  /** Pick the effect(s) for a move: {main, impact}. Names come from fx.json "moves"; element fallbacks otherwise. */
  pick(move, mtype, cat) {
    if (!this.ok) return null;
    const exact = (this.byMove.get(move) || []);
    let main = exact.find((e) => !/hit|held/.test(e.tag) && ["projectile", "beam", "rush", "area", "impact", "aura"].includes(e.d.kind))?.d;
    let impact = exact.find((e) => /hit/.test(e.tag))?.d;
    const el = mtype.toLowerCase();
    const ofEl = (k) => this.fx.effects.find((d) => d.element === el && d.kind === k);
    if (!main) {
      if (cat === "special") main = ofEl("projectile") || ofEl("beam") || ofEl("impact");
      else main = ofEl("impact") || this.byId["hit-spark"];
      if (!main) main = this.byId["hit-spark"];
    }
    if (!impact && (main.kind === "projectile" || main.kind === "beam")) {
      impact = ofEl("impact") || this.byId["hit-spark"];
    }
    return { main, impact, exact: exact.length > 0 };
  }
  async playMove(side, move, mtype, cat, opts = {}) {
    const p = this.pick(move, mtype, cat);
    if (!p || !p.main) return false;
    const other = side === "A" ? "B" : "A";
    this.played.push({ move, main: p.main.id, impact: p.impact?.id || null });
    const user = this.center(side), tgt = this.center(other);
    const d = p.main;
    const sc = Math.max(1.4, Math.min(2.4, this.size().w / 190));
    const dur = (n, fps) => (n / fps) * 1000;
    const dx = tgt.x - user.x, dy = tgt.y - user.y, dist = Math.hypot(dx, dy);
    const plate = this.plates[side];
    const sw = Math.sign(dx) || 1, ang = Math.atan2(dy, Math.abs(dx));
    const self = ["aura", "buff", "debuff"].includes(d.kind) && cat === "status";
    const jobs = [];
    if (d.kind === "projectile") {
      const t = Math.max(350, Math.min(650, dist * 1.6));
      jobs.push(this.addActor(d, { type: "proj", from: user, to: tgt, sw, ang, sc, dur: t, loopFrames: true }));
      await sleep(t - 40);
      if (p.impact) jobs.push(this.addActor(p.impact, { type: "at", at: tgt, sc, anchorMode: "center" }));
      this.hit(other, p.impact);
      await Promise.race([Promise.all(jobs), sleep(900)]);
    } else if (d.kind === "beam") {
      const reach = d.frameW - d.anchor[0];
      jobs.push(this.addActor(d, { type: "beam", from: user, sw, ang, sx: (dist + 6) / (reach * sc), sc, dur: dur(d.frames, d.fps) }));
      await sleep(Math.min(500, dur(d.frames, d.fps) * 0.5));
      if (p.impact) jobs.push(this.addActor(p.impact, { type: "at", at: tgt, sc, anchorMode: "center" }));
      this.hit(other, p.impact);
      await Promise.race([Promise.all(jobs), sleep(1100)]);
    } else if (d.kind === "rush") {
      const R = d.rush;
      const windup = dur(R.windupFrames, d.fps), dash = dur(R.dashFrames, d.fps);
      jobs.push(this.addActor(d, { type: "rushfx", plate, from: user, to: tgt, sw, ang, sc, windup, dash }));
      this.lunge(plate, dx * 0.7, dy * 0.7, windup, dash);
      await sleep(windup + dash);
      this.hit(other, null);
      await Promise.race([Promise.all(jobs), sleep(1000)]);
    } else if (self) {
      jobs.push(this.addActor(d, { type: "at", at: user, sc, anchorMode: "feet" }));
      await Promise.race([Promise.all(jobs), sleep(900)]);
    } else {
      // impact / area / contact hit on the target. physical contact => the attacker lunges first
      if (d.contact && cat === "physical") { this.lunge(plate, dx * 0.6, dy * 0.6, 120, 140); await sleep(240); }
      jobs.push(this.addActor(d, { type: "at", at: tgt, sc, anchorMode: ["area", "aura"].includes(d.kind) ? "feet" : "center" }));
      await sleep(Math.min(300, dur(d.battle?.hitFrame ?? 4, d.fps) + 80));
      this.hit(other, d);
      await Promise.race([Promise.all(jobs), sleep(1100)]);
    }
    return true;
  }
  hit(side, d) {
    const el = this.plates[side];
    const px = (d && d.battle && d.battle.shakePx) || 2;
    el.animate([{ transform: "translate(0,0)" }, { transform: `translate(${px * 3}px,0)` }, { transform: `translate(${-px * 3}px,0)` }, { transform: "translate(0,0)" }], { duration: 220 });
  }
  lunge(plate, dx, dy, windup, dash) {
    plate.animate([{ transform: "translate(0,0)" }, { transform: "translate(0,0)", offset: windup / (windup + dash + 220) }, { transform: `translate(${dx}px,${dy}px)`, offset: (windup + dash) / (windup + dash + 220) }, { transform: "translate(0,0)" }], { duration: windup + dash + 220, easing: "ease-out" });
  }
  async playSimple(side, id, opts = {}) {
    const d = this.byId[id];
    if (!this.ok || !d) return false;
    const sc = Math.max(1.4, Math.min(2.4, this.size().w / 190));
    this.played.push({ simple: id });
    await Promise.race([this.addActor(d, { type: "at", at: this.center(side), sc, anchorMode: opts.mode || "feet" }), sleep(opts.max || 1000)]);
    return true;
  }
  // ---- actors
  addActor(d, o) {
    return new Promise(async (resolve) => {
      const img = await loadImg(this.base + d.sheet.image);
      if (!img) return resolve(false);
      const light = await loadLight(this.base, d);
      const a = { d, o, img, light, start: performance.now(), resolve };
      a.total = o.dur || (o.type === "rushfx" ? (d.frames / d.fps) * 1000 + 120 : (d.frames / d.fps) * 1000);
      this.actors.push(a);
      if (!this.running) { this.running = true; requestAnimationFrame((t) => this.tick(t)); }
    });
  }
  frameRect(d, i) { const c = d.sheet.columns; return [(i % c) * d.frameW, Math.floor(i / c) * d.frameH, d.frameW, d.frameH]; }
  tick() {
    const s = this.size();
    const ctx = this.ctx;
    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    ctx.clearRect(0, 0, s.w, s.h);
    ctx.imageSmoothingEnabled = false;
    const now = performance.now();
    this.actors = this.actors.filter((a) => {
      const t = now - a.start;
      if (t >= a.total) { a.resolve(true); return false; }
      this.drawActor(ctx, a, t);
      return true;
    });
    if (this.actors.length) requestAnimationFrame(() => this.tick());
    else { this.running = false; ctx.clearRect(0, 0, s.w, s.h); }
  }
  drawActor(ctx, a, t) {
    const { d, o } = a;
    const fi = o.loopFrames ? Math.floor((t / 1000) * d.fps) % d.frames : Math.min(d.frames - 1, Math.floor((t / 1000) * d.fps));
    const [sx, sy, w, h] = this.frameRect(d, fi);
    const [ax, ay] = d.anchor;
    const gl = d.ground !== undefined ? d.ground : h - 10;
    const sc = o.sc;
    const paint = (px, py) => {
      ctx.drawImage(a.img, sx, sy, w, h, -ax * sc + px, -ay * sc + py, w * sc, h * sc);
      if (a.light) { ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.drawImage(a.light, sx, sy, w, h, -ax * sc + px, -ay * sc + py, w * sc, h * sc); ctx.restore(); }
    };
    ctx.save();
    if (o.type === "at") {
      const ox = o.at.x, oy = o.anchorMode === "feet" ? o.at.y + o.at.h * 0.4 - (gl - ay) * sc : o.at.y;
      ctx.translate(ox, oy);
      paint(0, 0);
    } else if (o.type === "proj") {
      const k = Math.min(1, t / o.dur);
      const x = o.from.x + (o.to.x - o.from.x) * k, y = o.from.y + (o.to.y - o.from.y) * k;
      ctx.translate(x, y); ctx.scale(o.sw, 1); ctx.rotate(o.ang);
      paint(0, 0);
    } else if (o.type === "beam") {
      ctx.translate(o.from.x, o.from.y); ctx.scale(o.sw, 1); ctx.rotate(o.ang); ctx.scale(Math.max(0.2, o.sx), 1);
      paint(0, 0);
    } else if (o.type === "rushfx") {
      const k = t < o.windup ? 0 : Math.min(1, (t - o.windup) / o.dash);
      const x = o.from.x + (o.to.x - o.from.x) * 0.7 * k, y = o.from.y + (o.to.y - o.from.y) * 0.7 * k;
      ctx.translate(x, y); ctx.scale(o.sw, 1); ctx.rotate(o.ang);
      paint(0, 0);
    }
    ctx.restore();
    this.lastFrame = { id: d.id, t };
  }
}
