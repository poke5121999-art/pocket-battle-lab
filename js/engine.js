// Pocket Battle Lab engine: pure ES module, no DOM. Modern (Gen 5+) rules on the Kanto 151.
// Used by the page (js/app.js) and by node (tests/engine.test.mjs, tools/coverage.mjs).

export const STAT_KEYS = ["hp", "atk", "def", "spa", "spd", "spe"];
export const STAT_VI = { atk: "Tấn công", def: "Phòng thủ", spa: "Tấn công đặc biệt", spd: "Phòng thủ đặc biệt", spe: "Tốc độ", acc: "Độ chính xác", eva: "Né tránh" };
export const STATUS_VI = { brn: "Bỏng", psn: "Độc", tox: "Độc nặng", par: "Tê liệt", slp: "Ngủ", frz: "Đóng băng" };

// ---------------------------------------------------------------- numbers
// Game rounding: round to nearest, 0.5 rounds down. Modifiers are n/4096 like the cartridge.
const MOD = { x1_5: 6144, x2: 8192, x0_5: 2048, x1_2: 4915, x1_1: 4505, x1_3: 5324, x1_3sf: 5325, x0_75: 3072, x1_25: 5120, x0_33: 1366 };
export const pokeRound = (x) => Math.ceil(x - 0.5);
const applyMod = (x, m) => pokeRound((x * m) / 4096);

export function calcStat(base, iv, ev, level, natureMult, isHp) {
  const core = Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100);
  if (isHp) return core + level + 10;
  return Math.floor((core + 5) * natureMult);
}
export function natureMult(nature, statIdx) {
  if (!nature) return 1;
  if (nature.up === statIdx && nature.down === statIdx) return 1;
  if (nature.up === statIdx) return 1.1;
  if (nature.down === statIdx) return 0.9;
  return 1;
}
export function calcAllStats(species, level, ivs, evs, nature) {
  return STAT_KEYS.map((_, i) => calcStat(species.base[i], ivs[i], evs[i], level, natureMult(nature, i), i === 0));
}

export function typeMult(data, atkType, defTypes, opts = {}) {
  const row = data.types.chart[atkType];
  if (!row) return 1;
  let m = 1;
  for (const d of defTypes) {
    let v = row[data.types.types.indexOf(d)];
    if (v === 0 && opts.scrappy && d === "Ghost" && (atkType === "Normal" || atkType === "Fighting")) v = 1;
    m *= v;
  }
  return m;
}

// ---------------------------------------------------------------- rng
export function hashSeed(str) {
  let h = 1779033703 ^ String(str).length;
  for (let i = 0; i < String(str).length; i++) {
    h = Math.imul(h ^ String(str).charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}
export function makeRng(seed) {
  let a = typeof seed === "number" ? seed >>> 0 : hashSeed(seed);
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (n) => Math.floor(next() * n), chance: (p) => next() < p };
}

// ---------------------------------------------------------------- stages
const stageMult = (s) => (s >= 0 ? (2 + s) / 2 : 2 / (2 - s));
const accMult = (s) => (s >= 0 ? (3 + s) / 3 : 3 / (3 - s));

// ---------------------------------------------------------------- move effect parsing
const PUNCH = new Set(["Mega Punch", "Fire Punch", "Ice Punch", "Thunder Punch", "Comet Punch", "DynamicPunch", "Dynamic Punch"]);
const NO_CONTACT = new Set(["Earthquake", "Rock Slide", "Rock Throw", "Razor Leaf", "Pin Missile", "Swift", "Self-Destruct", "Explosion", "Sonic Boom", "Dragon Rage", "Seismic Toss", "Night Shade", "Psywave", "Razor Wind", "Twineedle", "Barrage", "Spike Cannon", "Egg Bomb", "Bone Club", "Bonemerang", "Fissure", "Sludge", "Sludge Bomb", "Smog", "Clamp", "Thunder", "Fire Blast", "Hydro Pump"]);
const SOUND = new Set(["Sing", "Supersonic", "Screech", "Sonic Boom"]);
const STAT_WORDS = { attack: "atk", defense: "def", "special attack": "spa", "special defense": "spd", speed: "spe", accuracy: "acc", evasion: "eva", special: "spa" };
const num = (w) => (w === "one" ? 1 : w === "two" ? 2 : 1);

const specCache = new Map();
/** Parse effect_short into a spec. spec.partial = true when the effect (beyond plain damage) is not simulated. */
export function getSpec(m) {
  if (specCache.has(m.id)) return specCache.get(m.id);
  const t = m.effect.replace(/[’‘]/g, "'").replace(/\s+/g, " ");
  const s = { partial: false, matched: false, note: "" };
  const hit = () => { s.matched = true; };
  const chance = m.chance;
  let r;
  if (/^Inflicts regular damage with no additional effect/.test(t)) hit();
  if (/can hit Pokémon in the air/.test(t)) { s.hitsFly = true; hit(); }
  if (/can hit Dig users/.test(t)) { s.hitsDig = true; hit(); }
  if (/can hit Dive users/.test(t)) hit();
  if (/Has a chance to make the target flinch/.test(t)) { s.flinch = chance || 30; hit(); }
  if (/Hits 2-5 times/.test(t)) { s.multi = [2, 5]; hit(); }
  if (/Hits twice/.test(t)) { s.multi = [2, 2]; hit(); }
  if (/increased chance for a critical hit/.test(t)) { s.crit = 1; hit(); }
  if (/^Increases the user's chance to score a critical hit/.test(t)) { s.focus = true; hit(); }
  if (/Has a chance to burn, freeze, or paralyze/.test(t)) { s.tri = chance || 20; hit(); }
  else if ((r = /Has a chance to (burn|freeze|paralyze|poison|confuse) the target/.exec(t))) {
    s.secStatus = { st: { burn: "brn", freeze: "frz", paralyze: "par", poison: "psn", confuse: "conf" }[r[1]], p: chance || 10 };
    hit();
  }
  if ((r = /^(Puts the target to sleep|Paralyzes the target|Poisons the target|Badly poisons the target|Confuses the target)/.exec(t))) {
    s.status = { "Puts the target to sleep": "slp", "Paralyzes the target": "par", "Poisons the target": "psn", "Badly poisons the target": "tox", "Confuses the target": "conf" }[r[1]];
    hit();
  }
  if ((r = /^(?:(Has a chance to) lower|Lowers) the target's ([a-zA-Z ]+?) by (one|two) stages?/.exec(t))) {
    const st = STAT_WORDS[r[2].toLowerCase()];
    if (st) {
      if (r[1]) s.secStat = { st, d: -num(r[3]), p: chance || 10 };
      else s.targetStat = { st, d: -num(r[3]) };
      hit();
    }
  }
  if ((r = /^Raises (?:the )?user's ([a-zA-Z ]+?) by (one|two) stages?\.?$/.exec(t))) {
    const st = STAT_WORDS[r[1].toLowerCase()];
    if (st) { s.selfStat = [{ st, d: num(r[2]) }]; hit(); }
  }
  if (/^Raises the user's Attack and Special Attack by one stage/.test(t)) { s.selfStat = [{ st: "atk", d: 1 }, { st: "spa", d: 1 }]; hit(); }
  if (/^Raises user's Defense by one stage/.test(t)) { s.selfStat = [{ st: "def", d: 1 }]; hit(); }
  if (/Drains half the damage/.test(t)) { s.drain = 0.5; hit(); }
  if (/Only works on sleeping/.test(t)) s.needSleep = true;
  if (/receives 1\/4 the damage (?:it )?inflict(?:s|ed)? in recoil/.test(t)) { s.recoil = 1 / 4; hit(); }
  if (/receives 1\/3 the damage (?:it )?inflict(?:s|ed)? in recoil/.test(t)) { s.recoil = 1 / 3; hit(); }
  if (/If the user misses, it takes half/.test(t)) { s.crash = true; hit(); }
  if (/foregoes its next turn to recharge/.test(t)) { s.recharge = true; hit(); }
  if (/charges? for (one|a) turn|Requires a turn to charge/.test(t)) {
    s.charge = true; hit();
    if (/Raises the user's Defense/.test(t) || /Raises user's Defense/.test(t)) s.chargeBoost = [{ st: "def", d: 1 }];
  }
  if (/User flies high into the air/.test(t)) { s.charge = true; s.invuln = "fly"; hit(); }
  if (/User digs underground/.test(t)) { s.charge = true; s.invuln = "dig"; hit(); }
  if (/Causes a one-hit KO/.test(t)) { s.ohko = true; hit(); }
  if (/equal to the user's level/.test(t)) { s.fixed = "level"; hit(); }
  if (/Inflicts 20 points/.test(t)) { s.fixed = 20; hit(); }
  if (/Inflicts 40 points/.test(t)) { s.fixed = 40; hit(); }
  if (/equal to half the target's HP/.test(t)) { s.fixed = "half"; hit(); }
  if (/between 50% and 150% of the user's level/.test(t)) { s.fixed = "psywave"; hit(); }
  if (/twice the damage the user received from the last physical hit/.test(t)) { s.counter = true; hit(); }
  if (/^Heals the user by half its max HP/.test(t)) { s.heal = 0.5; hit(); }
  if (/User sleeps for two turns, completely healing/.test(t)) { s.rest = true; hit(); }
  if (/^Seeds the target/.test(t)) { s.leechSeed = true; hit(); }
  if (/Reduces damage from special attacks by 50%/.test(t)) { s.screen = "spa"; hit(); }
  if (/Reduces damage from physical attacks by half/.test(t)) { s.screen = "atk"; hit(); }
  if (/^Resets all Pokémon's stats/.test(t)) { s.haze = true; hit(); }
  if (/^Protects the user's stats from being changed/.test(t)) { s.mist = true; hit(); }
  if (/^User faints/.test(t)) { s.selfDestruct = true; hit(); }
  if (/Hits every turn for 2-3 turns, then confuses/.test(t)) { s.thrash = true; hit(); }
  if (/inflicts damage for 2-5 turns/.test(t)) { s.bind = true; hit(); }
  if (/^Randomly selects and uses any move/.test(t)) { s.metronome = true; hit(); }
  if (/^Uses the target's last used move/.test(t)) { s.mirror = true; hit(); }
  if (/^Transfers 1\/4 of the user's max HP into a doll/.test(t)) { s.substitute = true; hit(); }
  if (/If the user is hit after using this move, its Attack rises/.test(t)) { s.rage = true; hit(); }
  if (/^Never misses/.test(t)) { s.neverMiss = true; hit(); }
  if (/^Does nothing/.test(t)) { s.noop = true; hit(); }
  if (/^Immediately ends wild battles/.test(t)) { s.noop = true; s.note = "không tác dụng trong trận 1v1 với huấn luyện viên"; hit(); }
  if (/Scatters money/.test(t)) { s.noop = true; hit(); }
  if (/Inflicts more damage to heavier targets/.test(t)) { s.partial = true; s.note = "chưa có cân nặng: dùng sức mạnh cố định 60"; s.powerOverride = 60; hit(); }
  if (/Disables the target's last used move/.test(t)) { s.partial = true; s.note = "Disable chưa mô phỏng"; hit(); }
  if (/^Copies the target's last used move/.test(t)) { s.partial = true; s.note = "Mimic chưa mô phỏng"; hit(); }
  if (/User becomes a copy of the target/.test(t)) { s.partial = true; s.note = "Transform chưa mô phỏng"; hit(); }
  if (/User's type changes to the type of one of its moves/.test(t)) { s.partial = true; s.note = "Conversion chưa mô phỏng"; hit(); }
  if (/User waits for two turns, then hits back/.test(t)) { s.partial = true; s.note = "Bide chưa mô phỏng"; hit(); }
  if (/User takes 1\/4 its max HP in recoil/.test(t)) hit();
  if (!s.matched) { s.partial = true; s.note = s.note || "hiệu ứng chưa mô phỏng, chỉ tính sát thương"; }
  specCache.set(m.id, s);
  return s;
}

// ---------------------------------------------------------------- abilities & items implemented
export const ABILITY_IMPL = new Set(["Adaptability", "Aftermath", "Anger Point", "Battle Armor", "Big Pecks", "Blaze", "Clear Body", "Competitive", "Compound Eyes", "Defiant", "Early Bird", "Effect Spore", "Filter", "Flame Body", "Flash Fire", "Guts", "Huge Power", "Pure Power", "Hustle", "Hyper Cutter", "Immunity", "Inner Focus", "Insomnia", "Intimidate", "Iron Fist", "Justified", "Keen Eye", "Levitate", "Limber", "Liquid Ooze", "Magic Guard", "Marvel Scale", "Moxie", "Multiscale", "No Guard", "Overgrow", "Own Tempo", "Poison Point", "Quick Feet", "Rattled", "Reckless", "Rock Head", "Scrappy", "Serene Grace", "Shed Skin", "Sheer Force", "Shell Armor", "Skill Link", "Sniper", "Static", "Steadfast", "Stench", "Sturdy", "Swarm", "Synchronize", "Technician", "Thick Fat", "Tinted Lens", "Torrent", "Unaware", "Unburden", "Vital Spirit", "Volt Absorb", "Water Absorb", "Water Veil", "Weak Armor", "Solid Rock"]);

const TYPE_ITEMS = { "Silk Scarf": "Normal", Charcoal: "Fire", "Mystic Water": "Water", Magnet: "Electric", "Miracle Seed": "Grass", "Never-Melt Ice": "Ice", "Black Belt": "Fighting", "Poison Barb": "Poison", "Soft Sand": "Ground", "Sharp Beak": "Flying", "Twisted Spoon": "Psychic", "Silver Powder": "Bug", "Hard Stone": "Rock", "Spell Tag": "Ghost", "Dragon Fang": "Dragon", "Black Glasses": "Dark", "Metal Coat": "Steel", "Fairy Feather": "Fairy", "Pixie Plate": "Fairy" };
const RESIST_BERRY = { "Occa Berry": "Fire", "Passho Berry": "Water", "Wacan Berry": "Electric", "Rindo Berry": "Grass", "Yache Berry": "Ice", "Chople Berry": "Fighting", "Kebia Berry": "Poison", "Shuca Berry": "Ground", "Coba Berry": "Flying", "Payapa Berry": "Psychic", "Tanga Berry": "Bug", "Charti Berry": "Rock", "Kasib Berry": "Ghost", "Haban Berry": "Dragon", "Colbur Berry": "Dark", "Babiri Berry": "Steel", "Chilan Berry": "Normal", "Roseli Berry": "Fairy" };
const PINCH_BERRY = { "Liechi Berry": "atk", "Ganlon Berry": "def", "Salac Berry": "spe", "Petaya Berry": "spa", "Apicot Berry": "spd" };
const FIGY = new Set(["Figy Berry", "Wiki Berry", "Mago Berry", "Aguav Berry", "Iapapa Berry"]);
const NO_EFFECT_ITEMS = new Set(["Mental Herb", "Heavy-Duty Boots", "Red Card", "Eject Button", "Everstone", "Smoke Ball", "Amulet Coin", "Soothe Bell", "Razor Claw_", "Bright Powder_"]);
export const ITEM_IMPL = new Set(["Leftovers", "Black Sludge", "Shell Bell", "Focus Sash", "Focus Band", "Eviolite", "Assault Vest", "Rocky Helmet", "Sitrus Berry", "Oran Berry", "Lum Berry", "Starf Berry", "Choice Band", "Choice Specs", "Choice Scarf", "Life Orb", "Expert Belt", "Muscle Band", "Wise Glasses", "Scope Lens", "Razor Claw", "King's Rock", "Razor Fang", "Wide Lens", "Zoom Lens", "Metronome", "Light Ball", "Thick Club", "Stick (Leek)", "Lucky Punch", "Metal Powder", "Quick Powder", "Quick Claw", "Bright Powder", "Lagging Tail", "Iron Ball", "Toxic Orb", "Flame Orb", "Air Balloon", "White Herb", "Power Herb", "Light Clay", ...Object.keys(TYPE_ITEMS), ...Object.keys(RESIST_BERRY), ...Object.keys(PINCH_BERRY), ...FIGY]);
export const isItemNoEffect = (name) => !ITEM_IMPL.has(name);

// ---------------------------------------------------------------- mon construction
export function buildMon(data, b) {
  const sp = data.species.find((s) => s.id === b.species);
  const nature = data.natures[b.nature || 0];
  const stats = calcAllStats(sp, b.level, b.ivs, b.evs, nature);
  const moves = (b.moves || []).filter((x) => x != null).map((id) => {
    const m = data.moves.find((x) => x.id === id);
    return { ...m, spec: getSpec(m), ppLeft: m.pp, maxPp: m.pp };
  });
  return {
    name: sp.name, dex: sp.id, species: sp, level: b.level, types: [...sp.types], stats, maxHp: stats[0], hp: stats[0],
    stages: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 }, status: null, sleepTurns: 0, toxN: 0, confused: 0,
    moves, item: b.item || null, itemLost: false, ability: b.ability || sp.abilities[0] || null, nature,
    // volatile
    flinch: false, recharging: false, charging: null, invuln: null, locked: null, thrash: null, bound: 0, seeded: false, focus: false,
    sub: 0, lastMove: null, lastHitPhysical: 0, rage: false, flashFire: false, metroCount: 0, metroMove: null, usedBerry: false, mist: 0,
    sashUsed: false, moved: false,
  };
}

// ---------------------------------------------------------------- damage
export function modifiedStat(mon, key, opts = {}) {
  const i = STAT_KEYS.indexOf(key);
  let st = mon.stages[key];
  if (opts.ignoreNeg && st < 0) st = 0;
  if (opts.ignorePos && st > 0) st = 0;
  if (opts.ignoreStage) st = 0;
  return Math.floor(mon.stats[i] * stageMult(st));
}
const hasItem = (m, n) => m.item === n && !m.itemLost;

/** Core damage calc. att/def are mons, mv is a move object. opts: crit, roll (85..100), screens, weakened. Returns {dmg, eff} */
export function calcDamage(data, att, def, mv, opts = {}) {
  const spec = mv.spec || getSpec(mv);
  const physical = mv.cat === "physical";
  let power = (spec.powerOverride ?? mv.power) || 0;
  if (mv.struggle) power = 50;
  const ab = att.ability, dab = def.ability;
  const scrappy = ab === "Scrappy";
  let eff = mv.struggle ? 1 : typeMult(data, mv.type, def.types, { scrappy });
  // ground immunity
  if (mv.type === "Ground" && !mv.struggle && (dab === "Levitate" || hasItem(def, "Air Balloon"))) eff = 0;
  if (eff === 0) return { dmg: 0, eff: 0 };
  // base power modifiers
  const pm = [];
  if (ab === "Technician" && power <= 60) pm.push(MOD.x1_5);
  if (ab === "Iron Fist" && PUNCH.has(mv.name)) pm.push(MOD.x1_2);
  if (ab === "Reckless" && (spec.recoil || spec.crash)) pm.push(MOD.x1_2);
  if (ab === "Sheer Force" && (spec.secStatus || spec.secStat || spec.flinch || spec.tri)) pm.push(MOD.x1_3sf);
  if (TYPE_ITEMS[att.item] === mv.type && !att.itemLost) pm.push(MOD.x1_2);
  if (hasItem(att, "Muscle Band") && physical) pm.push(MOD.x1_1);
  if (hasItem(att, "Wise Glasses") && !physical) pm.push(MOD.x1_1);
  if (hasItem(att, "Metronome") && att.metroCount > 0) pm.push(4096 + Math.min(att.metroCount, 5) * 819);
  for (const m of pm) power = applyMod(power, m);
  // attack stat
  const aKey = physical ? "atk" : "spa";
  const dKey = physical ? "def" : "spd";
  const unawareD = dab === "Unaware";
  const unawareA = ab === "Unaware";
  let A = modifiedStat(att, aKey, { ignoreNeg: opts.crit, ignoreStage: unawareD });
  let D = modifiedStat(def, dKey, { ignorePos: opts.crit, ignoreStage: unawareA });
  const am = [];
  if (physical && (ab === "Huge Power" || ab === "Pure Power")) am.push(MOD.x2);
  if (physical && ab === "Guts" && att.status) am.push(MOD.x1_5);
  if (physical && ab === "Hustle") am.push(MOD.x1_5);
  if (hasItem(att, "Choice Band") && physical) am.push(MOD.x1_5);
  if (hasItem(att, "Choice Specs") && !physical) am.push(MOD.x1_5);
  if (hasItem(att, "Light Ball") && att.dex === 25) am.push(MOD.x2);
  if (hasItem(att, "Thick Club") && physical && (att.dex === 104 || att.dex === 105)) am.push(MOD.x2);
  const hpLow = att.hp * 3 <= att.maxHp;
  if (hpLow && ((ab === "Blaze" && mv.type === "Fire") || (ab === "Torrent" && mv.type === "Water") || (ab === "Overgrow" && mv.type === "Grass") || (ab === "Swarm" && mv.type === "Bug"))) am.push(MOD.x1_5);
  if (att.flashFire && mv.type === "Fire") am.push(MOD.x1_5);
  for (const m of am) A = applyMod(A, m);
  const dm = [];
  if (physical && dab === "Marvel Scale" && def.status) dm.push(MOD.x1_5);
  if (!physical && hasItem(def, "Assault Vest")) dm.push(MOD.x1_5);
  if (hasItem(def, "Eviolite") && def.species.canEvolve) dm.push(MOD.x1_5);
  if (hasItem(def, "Metal Powder") && def.dex === 132) dm.push(MOD.x2);
  for (const m of dm) D = applyMod(D, m);
  D = Math.max(1, D);
  // base damage
  let dmg = Math.floor(Math.floor((Math.floor((2 * att.level) / 5) + 2) * power * A / D) / 50) + 2;
  if (opts.crit) dmg = applyMod(dmg, ab === "Sniper" ? 9216 : MOD.x1_5);
  const roll = opts.roll ?? 100;
  dmg = Math.floor((dmg * roll) / 100);
  // STAB
  const stab = att.types.includes(mv.type) && !mv.struggle;
  if (stab) dmg = applyMod(dmg, ab === "Adaptability" ? MOD.x2 : MOD.x1_5);
  dmg = Math.floor(dmg * eff);
  // burn
  if (att.status === "brn" && physical && ab !== "Guts" && mv.name !== "Facade") dmg = applyMod(dmg, MOD.x0_5);
  // other
  const om = [];
  if (opts.screen && !opts.crit && !(ab === "Infiltrator")) om.push(MOD.x0_5);
  if (dab === "Multiscale" && def.hp === def.maxHp) om.push(MOD.x0_5);
  if ((dab === "Filter" || dab === "Solid Rock") && eff > 1) om.push(MOD.x0_75);
  if (dab === "Thick Fat" && (mv.type === "Fire" || mv.type === "Ice")) om.push(MOD.x0_5);
  if (ab === "Tinted Lens" && eff < 1) om.push(MOD.x2);
  if (hasItem(att, "Expert Belt") && eff > 1) om.push(MOD.x1_2);
  if (hasItem(att, "Life Orb")) om.push(MOD.x1_3);
  if (opts.resistBerry) om.push(MOD.x0_5);
  for (const m of om) dmg = applyMod(dmg, m);
  return { dmg: Math.min(65535, Math.max(1, dmg)), eff };
}

function berryApplies(def, mv, eff) {
  if (!def.item || def.itemLost || def.ability === "Unnerve") return false;
  const t = RESIST_BERRY[def.item];
  if (!t || t !== mv.type) return false;
  return eff > 1 || t === "Normal";
}

/** Damage range shown on the move buttons: no crit, no random item/ability triggers. */
export function damageRange(data, att, def, mv, side) {
  const spec = mv.spec || getSpec(mv);
  if (mv.cat === "status" || (!mv.power && !spec.fixed && !spec.ohko && !spec.counter && !spec.powerOverride)) return null;
  if (spec.ohko) {
    const eff = typeMult(data, mv.type, def.types);
    return { min: eff === 0 ? 0 : def.hp, max: eff === 0 ? 0 : def.hp, eff, hits: [1, 1], pctMin: 100, pctMax: 100, ko: eff === 0 ? "none" : "ohko", koText: eff === 0 ? "Vô hiệu" : "OHKO (theo độ chính xác)", acc: 30 + att.level - def.level };
  }
  if (spec.fixed || spec.counter) {
    const eff = typeMult(data, mv.type, def.types);
    let v = spec.fixed === "level" ? att.level : spec.fixed === "half" ? Math.max(1, Math.floor(def.hp / 2)) : spec.fixed === "psywave" ? Math.floor(att.level * 1.5) : typeof spec.fixed === "number" ? spec.fixed : 0;
    if (eff === 0) v = 0;
    const min = spec.fixed === "psywave" ? Math.max(1, Math.floor(att.level * 0.5)) : v;
    return { min, max: v, eff, hits: [1, 1], pctMin: (min / def.hp) * 100, pctMax: (v / def.hp) * 100, ko: v >= def.hp ? "ohko" : "none", koText: v >= def.hp ? "OHKO" : spec.counter ? "Phụ thuộc đòn nhận" : `${Math.ceil(def.hp / Math.max(1, v))}HKO` };
  }
  const opts = { screen: false, resistBerry: berryApplies(def, mv, typeMult(data, mv.type, def.types, { scrappy: att.ability === "Scrappy" })) };
  const lo = calcDamage(data, att, def, mv, { ...opts, roll: 85 });
  const hi = calcDamage(data, att, def, mv, { ...opts, roll: 100 });
  if (hi.eff === 0) return { min: 0, max: 0, eff: 0, hits: [1, 1], pctMin: 0, pctMax: 0, ko: "none", koText: "Vô hiệu" };
  const hits = spec.multi ? (att.ability === "Skill Link" ? [spec.multi[1], spec.multi[1]] : spec.multi) : [1, 1];
  const hp = def.hp;
  let ok = 0;
  const rolls = [];
  for (let r = 85; r <= 100; r++) rolls.push(calcDamage(data, att, def, mv, { ...opts, roll: r }).dmg);
  const perMax = hits[1];
  const totMin = rolls[0] * hits[0], totMax = rolls[15] * perMax;
  for (const d of rolls) if (d * hits[1] >= hp) ok++;
  let koText, ko;
  if (spec.multi && hits[0] !== hits[1]) {
    koText = `${hits[0]}-${hits[1]} lần`;
    ko = rolls[15] * hits[0] >= hp ? "ohko" : totMax >= hp ? "maybe" : "none";
    if (ko === "ohko") koText = "OHKO";
    else if (ko === "maybe") koText = "Có thể OHKO";
    else koText = `${Math.ceil(hp / Math.max(1, Math.round(((rolls[0] + rolls[15]) / 2) * ((hits[0] + hits[1]) / 2))))}HKO`;
  } else {
    const n = hits[0];
    const tmin = rolls[0] * n, tmax = rolls[15] * n;
    if (tmin >= hp) { ko = "ohko"; koText = "OHKO chắc chắn"; }
    else if (tmax >= hp) { const c = rolls.filter((d) => d * n >= hp).length; ko = "maybe"; koText = `OHKO ${Math.round((c / 16) * 100)}%`; }
    else {
      let k = 2;
      while (k < 9 && tmax * k < hp) k++;
      ko = "none";
      koText = tmin * k >= hp ? `${k}HKO chắc chắn` : `${k}HKO`;
      if (tmax * k < hp) koText = "9HKO+";
    }
  }
  return { min: lo.dmg * hits[0], max: hi.dmg * hits[1], eff: hi.eff, hits, pctMin: (lo.dmg * hits[0] / hp) * 100, pctMax: (hi.dmg * hits[1] / hp) * 100, ko, koText };
}

// ---------------------------------------------------------------- battle
const OPP = { A: "B", B: "A" };
const snapMon = (m) => ({ hp: m.hp, max: m.maxHp, status: m.status, conf: m.confused > 0, stages: { ...m.stages }, item: m.itemLost ? null : m.item, ability: m.ability, seeded: m.seeded, sub: m.sub, charging: !!m.charging, invuln: m.invuln });

export class Battle {
  constructor(data, buildA, buildB, seed = "1", opts = {}) {
    this.data = data;
    this.rng = makeRng(seed);
    this.m = { A: buildMon(data, buildA), B: buildMon(data, buildB) };
    this.turn = 0;
    this.over = false;
    this.winner = null;
    this.events = [];
    this.screens = { A: { atk: 0, spa: 0 }, B: { atk: 0, spa: 0 } };
    this.quiet = !!opts.quiet;
    this.m.A.label = `${this.m.A.name} (A)`;
    this.m.B.label = `${this.m.B.name} (B)`;
    this.m.A.side = "A"; this.m.B.side = "B";
    this.emit({ k: "start", msg: `${this.m.A.label} gặp ${this.m.B.label}` });
    // switch-in abilities, faster mon first
    for (const s of this.order(["A", "B"], true)) this.onEntry(s);
  }
  emit(ev) {
    if (this.quiet) return;
    ev.snap = { A: snapMon(this.m.A), B: snapMon(this.m.B) };
    ev.turn = this.turn;
    this.events.push(ev);
  }
  log(msg, extra = {}) { this.emit({ k: "info", msg, ...extra }); }
  onEntry(s) {
    const u = this.m[s], t = this.m[OPP[s]];
    if (u.ability === "Intimidate") {
      this.emit({ k: "ability", side: s, msg: `Intimidate của ${u.label} kích hoạt` });
      this.changeStage(t, "atk", -1, u, true);
    }
  }
  // ---- speed / order
  speedOf(mon) {
    let sp = modifiedStat(mon, "spe");
    if (hasItem(mon, "Choice Scarf")) sp = applyMod(sp, MOD.x1_5);
    if (hasItem(mon, "Quick Powder") && mon.dex === 132) sp *= 2;
    if (mon.ability === "Unburden" && mon.itemLost) sp *= 2;
    if (mon.ability === "Quick Feet" && mon.status) sp = Math.floor(sp * 1.5);
    else if (mon.status === "par") sp = Math.floor(sp / 2);
    if (hasItem(mon, "Iron Ball")) sp = Math.floor(sp / 2);
    return sp;
  }
  order(sides, ignorePrio) {
    return [...sides].sort((a, b) => a === b ? 0 : this.cmp(a, b)).map((x) => x);
  }
  cmp(a, b) {
    const sa = this.speedOf(this.m[a]), sb = this.speedOf(this.m[b]);
    if (sa === sb) return this.rng.next() < 0.5 ? -1 : 1;
    return sb - sa;
  }
  // ---- choices
  usable(mon) {
    let l = mon.moves.map((m, i) => ({ m, i })).filter(({ m, i }) => m.ppLeft > 0 && (mon.locked == null || mon.locked === i || mon.moves[mon.locked]?.ppLeft <= 0));
    if (hasItem(mon, "Assault Vest") && l.some((x) => x.m.cat !== "status")) l = l.filter((x) => x.m.cat !== "status");
    return l;
  }
  aiChoice(s) {
    const u = this.m[s], t = this.m[OPP[s]];
    const opts = this.usable(u);
    if (!opts.length) return -1;
    let best = opts[0].i, bs = -1e9;
    for (const { m, i } of opts) {
      const spec = m.spec;
      let score = 0;
      const dr = damageRange(this.data, u, t, m, s);
      if (dr) {
        const avg = ((dr.min + dr.max) / 2) * (spec.multi ? 1 : 1);
        const acc = m.acc == null || spec.neverMiss ? 1 : Math.min(1, m.acc / 100);
        score = (Math.min(avg, t.hp) / t.hp) * 100 * acc;
        if (dr.min >= t.hp) score += 60;
        if (m.prio > 0 && dr.max >= t.hp) score += 40;
        if (spec.recharge) score *= 0.6;
        if (spec.charge) score *= 0.6;
        if (spec.selfDestruct) score *= 0.4;
        if (spec.ohko) score = acc * 0 + (30 + u.level - t.level) * 0.8;
        if (m.power === 0 && !spec.fixed && !spec.counter && !spec.ohko) score = 5;
      } else {
        score = 2;
        if (spec.status === "slp" && !t.status) score = 40;
        else if (spec.status === "par" && !t.status) score = this.speedOf(t) > this.speedOf(u) ? 30 : 16;
        else if ((spec.status === "psn" || spec.status === "tox") && !t.status) score = 12;
        else if (spec.status === "conf" && !t.confused) score = 10;
        if ((spec.heal || spec.rest) && u.hp < u.maxHp * 0.5) score = 45;
        if (spec.selfStat && spec.selfStat.every((x) => u.stages[x.st] < 2)) score = 16;
        if (spec.leechSeed && !t.seeded) score = 20;
        if (spec.screen && !this.screens[s][spec.screen]) score = 15;
        if (spec.partial || spec.noop) score = 0;
      }
      if (u.locked === i) score += 5;
      if (score > bs) { bs = score; best = i; }
    }
    return best;
  }
  // ---- turn
  step(choiceA, choiceB) {
    if (this.over) return [];
    const start = this.events.length;
    this.turn++;
    this.emit({ k: "turn", msg: `— Lượt ${this.turn} —` });
    const choice = { A: choiceA, B: choiceB };
    const plan = [];
    for (const s of ["A", "B"]) {
      const u = this.m[s];
      let slot = choice[s];
      if (u.charging) slot = u.charging.slot;
      else if (u.thrash) slot = u.thrash.slot;
      else {
        const us = this.usable(u);
        if (!us.some((x) => x.i === slot)) slot = us.length ? us[0].i : -1;
      }
      let mv = slot >= 0 ? u.moves[slot] : STRUGGLE;
      plan.push({ s, slot, mv, prio: mv.prio || 0 });
    }
    for (const p of plan) {
      const u = this.m[p.s];
      if (hasItem(u, "Quick Claw") && this.rng.next() < 0.2) { p.qc = true; this.emit({ k: "item", side: p.s, msg: `Quick Claw của ${u.label} kích hoạt` }); }
    }
    plan.sort((a, b) => {
      if (a.prio !== b.prio) return b.prio - a.prio;
      if (!!a.qc !== !!b.qc) return a.qc ? -1 : 1;
      const la = hasItem(this.m[a.s], "Lagging Tail"), lb = hasItem(this.m[b.s], "Lagging Tail");
      if (la !== lb) return la ? 1 : -1;
      return this.cmp(a.s, b.s);
    });
    this.first = plan[0].s;
    {
      const [p0, p1] = plan;
      const why = p0.prio !== p1.prio ? `ưu tiên ${p0.prio} so với ${p1.prio}` : `tốc độ ${this.speedOf(this.m[p0.s])} so với ${this.speedOf(this.m[p1.s])}`;
      this.emit({ k: "order", msg: `Thứ tự: ${this.m[p0.s].label} ra đòn trước (${why})` });
    }
    for (const s of ["A", "B"]) this.m[s].moved = false;
    for (let i = 0; i < plan.length && !this.over; i++) {
      const p = plan[i];
      if (this.m[p.s].hp <= 0) continue;
      this.act(p.s, p.slot, p.mv, i === 1);
      this.checkEnd();
    }
    if (!this.over) { this.endOfTurn(); this.checkEnd(); }
    return this.events.slice(start);
  }
  checkEnd() {
    const a = this.m.A.hp <= 0, b = this.m.B.hp <= 0;
    if (!a && !b) return;
    this.over = true;
    this.winner = a && b ? "draw" : a ? "B" : "A";
    this.emit({ k: "end", msg: this.winner === "draw" ? "Hòa: cả hai cùng gục" : `${this.m[this.winner].label} thắng sau ${this.turn} lượt`, winner: this.winner });
  }
  // ---- single action
  act(s, slot, mv, movedSecond) {
    const u = this.m[s], t = this.m[OPP[s]];
    u.moved = true;
    if (u.recharging) { u.recharging = false; this.emit({ k: "info", side: s, msg: `${u.label} phải nghỉ để hồi sức` }); return; }
    if (u.flinch) {
      u.flinch = false;
      this.emit({ k: "info", side: s, msg: `${u.label} bị choáng nên không ra đòn được` });
      if (u.ability === "Steadfast") { this.emit({ k: "ability", side: s, msg: `Steadfast của ${u.label} kích hoạt` }); this.changeStage(u, "spe", 1, u, false); }
      return;
    }
    if (u.status === "slp") {
      if (u.sleepTurns > 0) {
        u.sleepTurns = Math.max(0, u.sleepTurns - (u.ability === "Early Bird" ? 2 : 1));
        this.emit({ k: "status", side: s, msg: `${u.label} đang ngủ say` });
        return;
      }
      u.status = null; this.emit({ k: "status", side: s, msg: `${u.label} thức dậy` });
    }
    if (u.status === "frz") {
      if (this.rng.next() < 0.2) { u.status = null; this.emit({ k: "status", side: s, msg: `${u.label} tan băng` }); }
      else { this.emit({ k: "status", side: s, msg: `${u.label} bị đóng băng nên không cử động được` }); return; }
    }
    if (u.confused > 0) {
      u.confused--;
      if (u.confused === 0) this.emit({ k: "status", side: s, msg: `${u.label} hết rối loạn` });
      else {
        this.emit({ k: "status", side: s, msg: `${u.label} đang rối loạn` });
        if (this.rng.next() < 1 / 3) { this.confusionHit(u); return; }
      }
    }
    if (u.status === "par" && this.rng.next() < 0.25) { this.emit({ k: "status", side: s, msg: `${u.label} bị tê liệt nên không cử động được` }); return; }
    // move selection side effects
    if (!u.charging && mv !== STRUGGLE && !u.thrash) {
      if (u.moves[slot].ppLeft <= 0) mv = STRUGGLE;
    }
    this.useMove(s, slot, mv, false);
  }
  confusionHit(u) {
    const fake = { name: "Confusion", type: "???", cat: "physical", power: 40, spec: { }, struggle: false, typeless: true };
    const atk = modifiedStat(u, "atk"), df = Math.max(1, modifiedStat(u, "def"));
    let dmg = Math.floor(Math.floor((Math.floor((2 * u.level) / 5) + 2) * 40 * atk / df) / 50) + 2;
    dmg = Math.floor((dmg * (85 + this.rng.int(16))) / 100);
    dmg = Math.max(1, dmg);
    this.emit({ k: "info", side: u.side, msg: `${u.label} tự đánh vào mình` });
    this.damageMon(u, dmg, null, { indirect: false, selfHit: true });
  }
  // ---- applying damage with sash/sturdy/sub
  damageMon(target, dmg, source, o = {}) {
    if (dmg <= 0) return 0;
    if (target.sub > 0 && o.fromMove) {
      const d = Math.min(target.sub, dmg);
      target.sub -= d;
      this.emit({ k: "info", side: target.side, msg: `Substitute của ${target.label} chịu ${d} sát thương${target.sub <= 0 ? " và vỡ" : ""}` });
      return 0;
    }
    if (target.hp - dmg <= 0 && !o.indirect) {
      if (target.hp === target.maxHp && target.ability === "Sturdy") { dmg = target.hp - 1; this.emit({ k: "ability", side: target.side, msg: `Sturdy của ${target.label} giúp trụ lại với 1 HP` }); }
      else if (target.hp === target.maxHp && hasItem(target, "Focus Sash")) { dmg = target.hp - 1; this.consume(target); this.emit({ k: "item", side: target.side, msg: `Focus Sash của ${target.label} giúp trụ lại với 1 HP` }); }
      else if (hasItem(target, "Focus Band") && this.rng.next() < 0.1) { dmg = target.hp - 1; this.emit({ k: "item", side: target.side, msg: `Focus Band của ${target.label} giúp trụ lại với 1 HP` }); }
    }
    dmg = Math.min(dmg, target.hp);
    target.hp -= dmg;
    if (target.hp <= 0) { target.hp = 0; }
    return dmg;
  }
  consume(m) { m.itemLost = true; if (m.item) m.consumedName = m.item; }
  heal(m, n, why) {
    const h = Math.min(n, m.maxHp - m.hp);
    if (h <= 0) return 0;
    m.hp += h;
    this.emit({ k: "heal", side: m.side, msg: `${m.label} hồi ${h} HP${why ? " (" + why + ")" : ""}`, amount: h });
    return h;
  }
  indirect(m, n, why) {
    if (m.ability === "Magic Guard" || m.hp <= 0) return;
    const d = this.damageMon(m, Math.max(1, n), null, { indirect: true });
    this.emit({ k: "hit", side: m.side, msg: `${m.label} mất ${d} HP (${why})`, dmg: d, indirectHit: true });
    this.afterHp(m);
    if (m.hp <= 0) this.emit({ k: "faint", side: m.side, msg: `${m.label} gục` });
  }
  // ---- stat stages
  changeStage(m, st, d, src, byFoe) {
    if (m.hp <= 0) return false;
    if (d < 0 && byFoe) {
      if (m.mist > 0 && src !== m) { this.emit({ k: "info", side: m.side, msg: `Mist bảo vệ ${m.label}` }); return false; }
      if (m.ability === "Clear Body" || (m.ability === "Hyper Cutter" && st === "atk") || (m.ability === "Big Pecks" && st === "def") || (m.ability === "Keen Eye" && st === "acc")) {
        this.emit({ k: "ability", side: m.side, msg: `${m.ability} của ${m.label} chặn việc giảm ${STAT_VI[st]}` });
        return false;
      }
      if (m.sub > 0 && src && src !== m) return false;
    }
    const before = m.stages[st];
    const after = Math.max(-6, Math.min(6, before + d));
    if (after === before) { this.emit({ k: "info", side: m.side, msg: `${STAT_VI[st]} của ${m.label} không thể ${d > 0 ? "tăng" : "giảm"} thêm` }); return false; }
    m.stages[st] = after;
    const diff = Math.abs(after - before);
    this.emit({ k: "stat", side: m.side, up: d > 0, stat: st, msg: `${STAT_VI[st]} của ${m.label} ${d > 0 ? "tăng" : "giảm"} ${diff > 1 ? "mạnh " : ""}(${after > 0 ? "+" : ""}${after})` });
    if (d < 0 && byFoe && !m.sub) {
      if (m.ability === "Defiant") { this.emit({ k: "ability", side: m.side, msg: `Defiant của ${m.label} kích hoạt` }); m.stages.atk = Math.min(6, m.stages.atk + 2); this.emit({ k: "stat", side: m.side, up: true, stat: "atk", msg: `Tấn công của ${m.label} tăng mạnh (${m.stages.atk > 0 ? "+" : ""}${m.stages.atk})` }); }
      if (m.ability === "Competitive") { this.emit({ k: "ability", side: m.side, msg: `Competitive của ${m.label} kích hoạt` }); m.stages.spa = Math.min(6, m.stages.spa + 2); this.emit({ k: "stat", side: m.side, up: true, stat: "spa", msg: `Tấn công đặc biệt của ${m.label} tăng mạnh (${m.stages.spa > 0 ? "+" : ""}${m.stages.spa})` }); }
      if (hasItem(m, "White Herb") && Object.values(m.stages).some((x) => x < 0)) {
        for (const k of Object.keys(m.stages)) if (m.stages[k] < 0) m.stages[k] = 0;
        this.consume(m);
        this.emit({ k: "item", side: m.side, msg: `White Herb của ${m.label} khôi phục các chỉ số bị giảm` });
      }
    }
    return true;
  }
  // ---- status infliction
  canStatus(t, st, src, quiet) {
    const fail = (msg) => { if (!quiet) this.emit({ k: "info", side: t.side, msg }); return false; };
    if (t.hp <= 0) return false;
    if (st === "conf") {
      if (t.confused > 0) return fail(`${t.label} đã bị rối loạn rồi`);
      if (t.ability === "Own Tempo") return fail(`Own Tempo của ${t.label} chặn rối loạn`);
      if (t.sub > 0 && src !== t) return fail("Substitute chặn hiệu ứng");
      return true;
    }
    if (t.status) return fail(`${t.label} đã có trạng thái rồi`);
    if (t.sub > 0 && src !== t) return fail("Substitute chặn hiệu ứng");
    if ((st === "brn" && t.types.includes("Fire")) || (st === "frz" && t.types.includes("Ice")) || (st === "par" && t.types.includes("Electric")) || ((st === "psn" || st === "tox") && (t.types.includes("Poison") || t.types.includes("Steel")) && !(src && src.ability === "Corrosion")))
      return fail(`${t.label} miễn nhiễm ${STATUS_VI[st]}`);
    const ab = t.ability;
    if ((ab === "Immunity" && (st === "psn" || st === "tox")) || (ab === "Limber" && st === "par") || ((ab === "Insomnia" || ab === "Vital Spirit") && st === "slp") || (ab === "Water Veil" && st === "brn")) {
      this.emit({ k: "ability", side: t.side, msg: `${ab} của ${t.label} chặn ${STATUS_VI[st]}` });
      return false;
    }
    return true;
  }
  setStatus(t, st, src, quiet) {
    if (!this.canStatus(t, st, src, quiet)) return false;
    if (st === "conf") {
      t.confused = 2 + this.rng.int(4);
      this.emit({ k: "status", side: t.side, status: "conf", msg: `${t.label} bị rối loạn` });
      this.afterStatus(t);
      return true;
    }
    t.status = st;
    if (st === "slp") t.sleepTurns = 1 + this.rng.int(3);
    if (st === "tox") t.toxN = 1;
    this.emit({ k: "status", side: t.side, status: st, msg: `${t.label} bị ${STATUS_VI[st].toLowerCase()}` });
    if (src && src !== t && t.ability === "Synchronize" && (st === "brn" || st === "par" || st === "psn" || st === "tox")) {
      this.emit({ k: "ability", side: t.side, msg: `Synchronize của ${t.label} kích hoạt` });
      if (this.canStatus(src, st === "tox" ? "psn" : st, t, true)) this.setStatus(src, st === "tox" ? "psn" : st, null, true);
    }
    this.afterStatus(t);
    return true;
  }
  afterStatus(m) {
    if (hasItem(m, "Lum Berry") && (m.status || m.confused > 0)) {
      this.consume(m); m.status = null; m.confused = 0; m.toxN = 0;
      this.emit({ k: "item", side: m.side, msg: `Lum Berry của ${m.label} chữa khỏi trạng thái` });
    }
  }
  // ---- berries after hp change
  afterHp(m) {
    if (m.hp <= 0 || !m.item || m.itemLost) return;
    const it = m.item, r = m.hp / m.maxHp;
    if (it === "Sitrus Berry" && r <= 0.5) { this.consume(m); this.emit({ k: "item", side: m.side, msg: `${m.label} ăn Sitrus Berry` }); this.heal(m, Math.floor(m.maxHp / 4)); }
    else if (it === "Oran Berry" && r <= 0.5) { this.consume(m); this.emit({ k: "item", side: m.side, msg: `${m.label} ăn Oran Berry` }); this.heal(m, 10); }
    else if (FIGY.has(it) && r <= 0.25) { this.consume(m); this.emit({ k: "item", side: m.side, msg: `${m.label} ăn ${it}` }); this.heal(m, Math.floor(m.maxHp / 3)); }
    else if (PINCH_BERRY[it] && r <= 0.25) { const st = PINCH_BERRY[it]; this.consume(m); this.emit({ k: "item", side: m.side, msg: `${m.label} ăn ${it}` }); this.changeStage(m, st, 1, m, false); }
    else if (it === "Starf Berry" && r <= 0.25) { this.consume(m); this.emit({ k: "item", side: m.side, msg: `${m.label} ăn Starf Berry` }); const ks = ["atk", "def", "spa", "spd", "spe"]; this.changeStage(m, ks[this.rng.int(5)], 2, m, false); }
  }
  // ---- using a move
  useMove(s, slot, mv, isCall) {
    const u = this.m[s], t = this.m[OPP[s]];
    const spec = mv.spec || getSpec(mv);
    const second = !!(u.charging && !isCall);
    const real = mv === STRUGGLE ? STRUGGLE : mv;
    if (real !== STRUGGLE && !second && !u.thrash && !isCall) { u.moves[slot].ppLeft--; }
    if (hasItem(u, "Choice Band") || hasItem(u, "Choice Specs") || hasItem(u, "Choice Scarf")) { if (real !== STRUGGLE && !isCall) u.locked = slot; }
    if (u.lastMove === real.name && real !== STRUGGLE) u.metroCount++; else u.metroCount = 0;
    u.lastMove = real.name;
    if (real.name !== "Rage") u.rage = false;
    this.emit({ k: "move", side: s, move: real.name, mtype: real.type, cat: real.cat, msg: `${u.label} dùng ${real.name}` });
    // two-turn
    if (spec.charge && !second) {
      if (hasItem(u, "Power Herb")) { this.consume(u); this.emit({ k: "item", side: s, msg: `Power Herb của ${u.label} bỏ qua lượt nạp` }); }
      else {
        u.charging = { slot };
        if (spec.invuln) u.invuln = spec.invuln;
        this.emit({ k: "info", side: s, msg: spec.invuln === "fly" ? `${u.label} bay lên cao` : spec.invuln === "dig" ? `${u.label} đào xuống đất` : `${u.label} đang nạp sức`, charge: true });
        if (spec.chargeBoost) for (const b of spec.chargeBoost) this.changeStage(u, b.st, b.d, u, false);
        return;
      }
    }
    if (second) { u.charging = null; u.invuln = null; }
    // thrash lock
    if (spec.thrash) {
      if (!u.thrash) u.thrash = { slot, left: 1 + this.rng.int(2) };
      else u.thrash.left--;
    }
    // status / non-damaging
    const isStatus = mv.cat === "status" || (mv.power == null && !spec.fixed && !spec.ohko && !spec.counter && !spec.powerOverride && mv !== STRUGGLE);
    // target-protecting states
    if (isStatus || !(mv.power || spec.fixed || spec.ohko || spec.counter)) return this.statusMove(s, mv, spec, u, t);
    // semi-invulnerable target
    if (t.invuln && !((t.invuln === "fly" && spec.hitsFly) || (t.invuln === "dig" && spec.hitsDig)) && !spec.neverMiss) {
      this.emit({ k: "miss", side: s, msg: `${t.label} đang ẩn nên ${real.name} trượt` });
      return;
    }
    // accuracy
    if (!this.accuracyCheck(u, t, mv, spec)) {
      this.emit({ k: "miss", side: s, msg: `${real.name} của ${u.label} trượt` });
      if (spec.crash) { this.emit({ k: "info", side: s, msg: `${u.label} ngã đau` }); this.indirect(u, Math.floor(u.maxHp / 2), "ngã đau"); }
      if (spec.thrash) u.thrash = null;
      return;
    }
    // absorb abilities
    if (!mv.struggle) {
      if (t.ability === "Volt Absorb" && mv.type === "Electric") { this.emit({ k: "ability", side: t.side, msg: `Volt Absorb của ${t.label} hấp thụ đòn` }); this.heal(t, Math.floor(t.maxHp / 4)); return; }
      if (t.ability === "Water Absorb" && mv.type === "Water") { this.emit({ k: "ability", side: t.side, msg: `Water Absorb của ${t.label} hấp thụ đòn` }); this.heal(t, Math.floor(t.maxHp / 4)); return; }
      if (t.ability === "Flash Fire" && mv.type === "Fire") { this.emit({ k: "ability", side: t.side, msg: `Flash Fire của ${t.label} hấp thụ đòn, đòn Fire của nó mạnh lên` }); t.flashFire = true; return; }
    }
    // fixed-damage moves
    if (spec.ohko || spec.fixed || spec.counter) return this.fixedMove(s, mv, spec, u, t);
    // hits
    let nHits = 1;
    if (spec.multi) {
      if (u.ability === "Skill Link") nHits = spec.multi[1];
      else if (spec.multi[0] === spec.multi[1]) nHits = spec.multi[0];
      else { const r = this.rng.next(); nHits = r < 0.35 ? 2 : r < 0.7 ? 3 : r < 0.85 ? 4 : 5; }
    }
    if (mv.struggle) nHits = 1;
    let total = 0, count = 0, lastEff = 1, crit = false;
    const hpBefore = t.hp;
    for (let h = 0; h < nHits && t.hp > 0; h++) {
      const critStage = (spec.crit || 0) + (u.focus ? 2 : 0) + (hasItem(u, "Scope Lens") || hasItem(u, "Razor Claw") ? 1 : 0) + ((hasItem(u, "Lucky Punch") && u.dex === 113) || (hasItem(u, "Stick (Leek)") && u.dex === 83) ? 2 : 0);
      const rate = [1 / 24, 1 / 8, 1 / 2, 1, 1][Math.min(4, critStage)];
      const canCrit = t.ability !== "Battle Armor" && t.ability !== "Shell Armor";
      const isCrit = canCrit && this.rng.next() < rate;
      const roll = 85 + this.rng.int(16);
      const screenKey = mv.cat === "physical" ? "atk" : "spa";
      const screen = this.screens[t.side][screenKey] > 0;
      const resistBerry = berryApplies(t, mv, typeMult(this.data, mv.type, t.types, { scrappy: u.ability === "Scrappy" }));
      const r = calcDamage(this.data, u, t, mv, { crit: isCrit, roll, screen, resistBerry });
      lastEff = r.eff;
      if (r.eff === 0) { this.emit({ k: "info", side: t.side, msg: `${mv.name} không ảnh hưởng tới ${t.label} (vô hiệu)`, eff: 0 }); return; }
      if (resistBerry) { this.consume(t); this.emit({ k: "item", side: t.side, msg: `${t.item} của ${t.label} giảm sát thương` }); }
      const wasSub = t.sub > 0;
      const d = this.damageMon(t, r.dmg, u, { fromMove: true });
      count++;
      if (isCrit) crit = true;
      total += d;
      if (wasSub) continue;
      this.emit({ k: "hit", side: t.side, attacker: s, dmg: d, pct: Math.round((d / t.maxHp) * 1000) / 10, crit: isCrit, eff: r.eff, msg: `${isCrit ? "Đòn chí mạng! " : ""}${r.eff > 1 ? "Rất hiệu quả. " : r.eff < 1 ? "Không hiệu quả lắm. " : ""}${t.label} mất ${d} HP (${Math.round((d / t.maxHp) * 1000) / 10}%)`, move: mv.name });
      if (mv.cat === "physical") t.lastHitPhysical = d;
      if (isCrit && t.ability === "Anger Point") { this.emit({ k: "ability", side: t.side, msg: `Anger Point của ${t.label} kích hoạt` }); t.stages.atk = 6; this.emit({ k: "stat", side: t.side, up: true, stat: "atk", msg: `Tấn công của ${t.label} tăng tối đa (+6)` }); }
      if (t.rage && d > 0) { t.stages.atk = Math.min(6, t.stages.atk + 1); this.emit({ k: "stat", side: t.side, up: true, stat: "atk", msg: `Cơn giận của ${t.label} làm Tấn công tăng (+${t.stages.atk})` }); }
      if (t.hp > 0) this.afterHp(t);
      if (mv.type === "Fire" && t.status === "frz") { t.status = null; this.emit({ k: "status", side: t.side, msg: `${t.label} tan băng nhờ đòn Fire` }); }
      // contact
      if (mv.cat === "physical" && !NO_CONTACT.has(mv.name) && !mv.struggle) this.contact(u, t);
      if (t.hp <= 0) break;
    }
    if (count > 1) this.emit({ k: "info", side: s, msg: `Đánh trúng ${count} lần`, hits: count });
    if (t.hp <= 0 && count) {
      this.emit({ k: "faint", side: t.side, msg: `${t.label} gục` });
      if (u.ability === "Moxie") { this.emit({ k: "ability", side: s, msg: `Moxie của ${u.label} kích hoạt` }); this.changeStage(u, "atk", 1, u, false); }
      if (t.ability === "Aftermath" && mv.cat === "physical" && !NO_CONTACT.has(mv.name) && u.hp > 0) { this.emit({ k: "ability", side: t.side, msg: `Aftermath của ${t.label} kích hoạt` }); this.indirect(u, Math.floor(u.maxHp / 4), "Aftermath"); }
    }
    if (total <= 0 && !count) return;
    // post-damage effects (on user)
    if (spec.drain && total > 0) {
      const h = Math.max(1, Math.floor(total * spec.drain));
      if (t.ability === "Liquid Ooze") { this.emit({ k: "ability", side: t.side, msg: `Liquid Ooze của ${t.label} kích hoạt` }); this.indirect(u, h, "Liquid Ooze"); }
      else this.heal(u, hasItem(u, "Big Root") ? Math.floor(h * 1.3) : h, "hút máu");
    }
    if (spec.recoil && total > 0 && u.ability !== "Rock Head" && u.ability !== "Magic Guard") this.indirect(u, Math.max(1, Math.floor(total * spec.recoil)), "phản lực");
    if (mv.struggle && u.hp > 0) this.indirect(u, Math.max(1, Math.floor(u.maxHp / 4)), "phản lực");
    const sheerSkips = u.ability === "Sheer Force" && (spec.secStatus || spec.secStat || spec.flinch || spec.tri);
    if (hasItem(u, "Life Orb") && total > 0 && !sheerSkips && u.hp > 0) this.indirect(u, Math.max(1, Math.floor(u.maxHp / 10)), "Life Orb");
    if (hasItem(u, "Shell Bell") && total > 0 && u.hp > 0) this.heal(u, Math.max(1, Math.floor(total / 8)), "Shell Bell");
    if (spec.selfDestruct) { u.hp = 0; this.emit({ k: "faint", side: s, msg: `${u.label} tự gục` }); return; }
    if (t.hp > 0 && total > 0 && !(t.sub > 0)) this.secondary(s, mv, spec, u, t, lastEff);
    if (spec.recharge && u.hp > 0 && t.hp > 0) u.recharging = true;
    if (spec.bind && t.hp > 0 && !t.bound) { t.bound = 4 + this.rng.int(2); this.emit({ k: "info", side: t.side, msg: `${t.label} bị mắc kẹt` }); }
    if (spec.thrash && u.thrash && u.hp > 0) {
      if (u.thrash.left <= 0) { u.thrash = null; this.emit({ k: "info", side: s, msg: `${u.label} hết cuồng nộ` }); this.setStatus(u, "conf", u, false); }
    }
    if (spec.rage) u.rage = true;
    if (u.hp <= 0 && !spec.selfDestruct) this.emit({ k: "faint", side: s, msg: `${u.label} gục` });
    if (spec.selfStat && total > 0) for (const x of spec.selfStat) this.changeStage(u, x.st, x.d, u, false);
  }
  contact(u, t) {
    if (hasItem(t, "Rocky Helmet") && u.hp > 0) { this.emit({ k: "item", side: t.side, msg: `Rocky Helmet của ${t.label} phản đòn` }); this.indirect(u, Math.max(1, Math.floor(u.maxHp / 6)), "Rocky Helmet"); }
    if (u.hp <= 0 || t.hp <= 0 && t.ability !== "Aftermath") return;
    if (t.hp <= 0) return;
    const ab = t.ability;
    if (this.rng.next() < 0.3) {
      if (ab === "Static" && this.canStatus(u, "par", t, true)) { this.emit({ k: "ability", side: t.side, msg: `Static của ${t.label} kích hoạt` }); this.setStatus(u, "par", t, false); }
      else if (ab === "Poison Point" && this.canStatus(u, "psn", t, true)) { this.emit({ k: "ability", side: t.side, msg: `Poison Point của ${t.label} kích hoạt` }); this.setStatus(u, "psn", t, false); }
      else if (ab === "Flame Body" && this.canStatus(u, "brn", t, true)) { this.emit({ k: "ability", side: t.side, msg: `Flame Body của ${t.label} kích hoạt` }); this.setStatus(u, "brn", t, false); }
      else if (ab === "Effect Spore") {
        const r = this.rng.int(3), st = ["par", "psn", "slp"][r];
        if (this.canStatus(u, st, t, true)) { this.emit({ k: "ability", side: t.side, msg: `Effect Spore của ${t.label} kích hoạt` }); this.setStatus(u, st, t, false); }
      }
    }
    if (t.ability === "Weak Armor") { this.emit({ k: "ability", side: t.side, msg: `Weak Armor của ${t.label} kích hoạt` }); this.changeStage(t, "def", -1, t, false); this.changeStage(t, "spe", 1, t, false); }
  }
  secondary(s, mv, spec, u, t, eff) {
    if (u.ability === "Sheer Force" && (spec.secStatus || spec.secStat || spec.flinch || spec.tri)) return;
    const sg = u.ability === "Serene Grace" ? 2 : 1;
    const roll = (p) => this.rng.next() < Math.min(1, (p * sg) / 100);
    // defender hit effects
    if (t.ability === "Justified" && mv.type === "Dark") { this.emit({ k: "ability", side: t.side, msg: `Justified của ${t.label} kích hoạt` }); this.changeStage(t, "atk", 1, t, false); }
    if (t.ability === "Rattled" && ["Dark", "Ghost", "Bug"].includes(mv.type)) { this.emit({ k: "ability", side: t.side, msg: `Rattled của ${t.label} kích hoạt` }); this.changeStage(t, "spe", 1, t, false); }
    if (t.hp <= 0) return;
    let flinchP = spec.flinch || 0;
    if (u.ability === "Stench") flinchP = Math.max(flinchP, 10);
    if (hasItem(u, "King's Rock") || hasItem(u, "Razor Fang")) flinchP = Math.max(flinchP, 10);
    if (flinchP && !t.moved && roll(flinchP) && t.ability !== "Inner Focus") t.flinch = true;
    if (spec.secStatus && roll(spec.secStatus.p)) this.setStatus(t, spec.secStatus.st, u, true);
    if (spec.tri && roll(spec.tri)) this.setStatus(t, ["brn", "frz", "par"][this.rng.int(3)], u, true);
    if (spec.secStat && roll(spec.secStat.p)) this.changeStage(t, spec.secStat.st, spec.secStat.d, u, true);
  }
  accuracyCheck(u, t, mv, spec) {
    if (mv.struggle || mv.acc == null || spec.neverMiss || u.ability === "No Guard" || t.ability === "No Guard") return true;
    let acc = mv.acc;
    if (spec.ohko) {
      if (u.level < t.level) return false;
      return this.rng.next() * 100 < 30 + u.level - t.level;
    }
    const ev = u.ability === "Unaware" ? 0 : t.stages.eva;
    const ac = t.ability === "Unaware" ? 0 : u.stages.acc;
    let stage = Math.max(-6, Math.min(6, ac - ev));
    acc = acc * accMult(stage);
    if (u.ability === "Compound Eyes") acc *= 1.3;
    if (u.ability === "Hustle" && mv.cat === "physical") acc *= 0.8;
    if (hasItem(u, "Wide Lens")) acc *= 1.1;
    if (hasItem(u, "Zoom Lens") && t.moved) acc *= 1.2;
    if (hasItem(t, "Bright Powder")) acc *= 0.9;
    return this.rng.next() * 100 < Math.floor(acc);
  }
  fixedMove(s, mv, spec, u, t) {
    const eff = typeMult(this.data, mv.type, t.types);
    if (eff === 0) { this.emit({ k: "info", side: t.side, msg: `${mv.name} không ảnh hưởng tới ${t.label} (vô hiệu)`, eff: 0 }); return; }
    let dmg = 0;
    if (spec.ohko) {
      if (u.level < t.level) { this.emit({ k: "miss", side: s, msg: `${mv.name} thất bại (cấp thấp hơn mục tiêu)` }); return; }
      if (t.ability === "Sturdy") { this.emit({ k: "ability", side: t.side, msg: `Sturdy của ${t.label} chặn đòn một hit` }); return; }
      dmg = t.hp;
      this.emit({ k: "info", side: s, msg: "Đòn một hit hạ gục" });
    } else if (spec.counter) {
      if (!u.lastHitPhysical) { this.emit({ k: "miss", side: s, msg: `${mv.name} thất bại` }); return; }
      dmg = u.lastHitPhysical * 2;
    } else if (spec.fixed === "level") dmg = u.level;
    else if (spec.fixed === "half") dmg = Math.max(1, Math.floor(t.hp / 2));
    else if (spec.fixed === "psywave") dmg = Math.max(1, Math.floor((u.level * (50 + this.rng.int(101))) / 100));
    else dmg = spec.fixed;
    const d = this.damageMon(t, dmg, u, { fromMove: true, indirect: !!spec.ohko });
    this.emit({ k: "hit", side: t.side, attacker: s, dmg: d, pct: Math.round((d / t.maxHp) * 1000) / 10, crit: false, eff, msg: `${t.label} mất ${d} HP (${Math.round((d / t.maxHp) * 1000) / 10}%)`, move: mv.name });
    if (t.hp > 0) this.afterHp(t);
    else this.emit({ k: "faint", side: t.side, msg: `${t.label} gục` });
  }
  // ---- non-damaging move
  statusMove(s, mv, spec, u, t) {
    if (spec.partial) { this.emit({ k: "info", side: s, msg: `${mv.name}: ${spec.note || "chưa mô phỏng"}`, partial: true }); if (!(mv.power)) return; }
    if (spec.noop) { this.emit({ k: "info", side: s, msg: spec.note ? `${mv.name}: ${spec.note}` : "Nhưng chẳng có gì xảy ra" }); return; }
    if (hasItem(u, "Assault Vest")) { /* status moves are blocked by the UI/AI; engine tolerates */ }
    const needsTarget = !!(spec.status || spec.targetStat || spec.leechSeed || spec.mirror);
    if (needsTarget) {
      if (t.invuln) { this.emit({ k: "miss", side: s, msg: `${t.label} đang ẩn nên ${mv.name} trượt` }); return; }
      if (mv.type === "Electric" && mv.cat === "status" && typeMult(this.data, mv.type, t.types) === 0) { this.emit({ k: "info", side: t.side, msg: `${mv.name} không ảnh hưởng tới ${t.label}` }); return; }
      if (!(spec.targetStat && mv.acc == null) && !this.accuracyCheck(u, t, mv, spec)) { this.emit({ k: "miss", side: s, msg: `${mv.name} của ${u.label} trượt` }); return; }
    }
    if (spec.status) {
      if (spec.status === "conf") this.setStatus(t, "conf", u, false);
      else this.setStatus(t, spec.status, u, false);
    }
    if (spec.targetStat) this.changeStage(t, spec.targetStat.st, spec.targetStat.d, u, true);
    if (spec.selfStat) for (const x of spec.selfStat) this.changeStage(u, x.st, x.d, u, false);
    if (spec.heal) { if (u.hp === u.maxHp) this.emit({ k: "info", side: s, msg: `HP của ${u.label} đã đầy` }); else this.heal(u, Math.floor(u.maxHp * spec.heal), mv.name); }
    if (spec.rest) {
      if (u.hp === u.maxHp && !u.status) { this.emit({ k: "info", side: s, msg: "Nhưng thất bại" }); }
      else { u.status = "slp"; u.sleepTurns = 2; u.toxN = 0; this.emit({ k: "status", side: s, status: "slp", msg: `${u.label} ngủ và hồi đầy HP` }); u.hp = u.maxHp; this.emit({ k: "heal", side: s, msg: `${u.label} hồi đầy HP`, amount: 0 }); }
    }
    if (spec.leechSeed) {
      if (t.types.includes("Grass") || t.seeded) this.emit({ k: "info", side: t.side, msg: `Leech Seed không ảnh hưởng tới ${t.label}` });
      else { t.seeded = true; this.emit({ k: "status", side: t.side, status: "seed", msg: `${t.label} bị gieo hạt` }); }
    }
    if (spec.screen) {
      if (this.screens[s][spec.screen] > 0) this.emit({ k: "info", side: s, msg: "Nhưng thất bại" });
      else { this.screens[s][spec.screen] = hasItem(u, "Light Clay") ? 8 : 5; this.emit({ k: "info", side: s, msg: `${mv.name} dựng lên bên ${s}`, screen: true }); }
    }
    if (spec.haze) { for (const x of ["A", "B"]) for (const k of Object.keys(this.m[x].stages)) this.m[x].stages[k] = 0; this.emit({ k: "info", msg: "Mọi thay đổi chỉ số bị xóa" }); }
    if (spec.mist) { u.mist = 5; this.emit({ k: "info", side: s, msg: `${u.label} được bảo vệ bởi Mist` }); }
    if (spec.focus) { u.focus = true; this.emit({ k: "info", side: s, msg: `${u.label} tập trung tỉ lệ chí mạng tăng` }); }
    if (spec.substitute) {
      const c = Math.floor(u.maxHp / 4);
      if (u.sub > 0) this.emit({ k: "info", side: s, msg: "Đã có Substitute" });
      else if (u.hp <= c) this.emit({ k: "info", side: s, msg: "Không đủ HP để tạo Substitute" });
      else { u.hp -= c; u.sub = c; this.emit({ k: "info", side: s, msg: `${u.label} tạo Substitute (${c} HP)` }); }
    }
    if (spec.metronome) {
      const pool = this.data.moves.filter((m) => !["Metronome", "Struggle", "Mirror Move"].includes(m.name));
      const pick = pool[this.rng.int(pool.length)];
      const nm = { ...pick, spec: getSpec(pick) };
      this.emit({ k: "info", side: s, msg: `Metronome chọn ${pick.name}` });
      this.useMove(s, -1, nm, true);
    }
    if (spec.mirror) {
      const last = t.lastMove && this.data.moves.find((m) => m.name === t.lastMove);
      if (!last || last.name === "Mirror Move") this.emit({ k: "info", side: s, msg: "Nhưng thất bại" });
      else this.useMove(s, -1, { ...last, spec: getSpec(last) }, true);
    }
    if (spec.rage) u.rage = true;
  }
  // ---- end of turn
  endOfTurn() {
    const sides = this.order(["A", "B"]);
    this.emit({ k: "info", msg: "Cuối lượt" });
    for (const s of sides) {
      const m = this.m[s], o = this.m[OPP[s]];
      if (m.hp <= 0) continue;
      if (hasItem(m, "Leftovers")) this.heal(m, Math.max(1, Math.floor(m.maxHp / 16)), "Leftovers");
      if (hasItem(m, "Black Sludge")) {
        if (m.types.includes("Poison")) this.heal(m, Math.max(1, Math.floor(m.maxHp / 16)), "Black Sludge");
        else this.indirect(m, Math.floor(m.maxHp / 8), "Black Sludge");
      }
      if (m.seeded && o.hp > 0 && m.hp > 0) {
        const d = Math.max(1, Math.floor(m.maxHp / 8));
        this.indirect(m, d, "Leech Seed");
        if (o.hp > 0) this.heal(o, d, "Leech Seed");
      }
      if (m.hp > 0 && m.status === "brn") this.indirect(m, Math.max(1, Math.floor(m.maxHp / 16)), "bỏng");
      else if (m.hp > 0 && m.status === "psn") this.indirect(m, Math.max(1, Math.floor(m.maxHp / 8)), "độc");
      else if (m.hp > 0 && m.status === "tox") { this.indirect(m, Math.max(1, Math.floor((m.maxHp * m.toxN) / 16)), "độc nặng"); m.toxN = Math.min(15, m.toxN + 1); }
      if (m.hp > 0 && m.bound > 0) { m.bound--; this.indirect(m, Math.max(1, Math.floor(m.maxHp / 8)), "bị trói"); if (m.bound === 0) this.emit({ k: "info", side: s, msg: `${m.label} thoát khỏi đòn trói` }); }
      if (m.hp > 0 && m.ability === "Shed Skin" && m.status && this.rng.next() < 1 / 3) { m.status = null; m.toxN = 0; this.emit({ k: "ability", side: s, msg: `Shed Skin của ${m.label} chữa trạng thái` }); }
      if (m.hp > 0 && hasItem(m, "Toxic Orb") && !m.status && this.canStatus(m, "tox", null, true)) { this.emit({ k: "item", side: s, msg: `Toxic Orb của ${m.label} kích hoạt` }); this.setStatus(m, "tox", null, true); }
      if (m.hp > 0 && hasItem(m, "Flame Orb") && !m.status && this.canStatus(m, "brn", null, true)) { this.emit({ k: "item", side: s, msg: `Flame Orb của ${m.label} kích hoạt` }); this.setStatus(m, "brn", null, true); }
      if (m.mist > 0) m.mist--;
      if (m.hp > 0) this.afterHp(m);
      if (m.hp <= 0) this.emit({ k: "faint", side: s, msg: `${m.label} gục` });
    }
    for (const s of ["A", "B"]) for (const k of ["atk", "spa"]) { if (this.screens[s][k] > 0) { this.screens[s][k]--; if (this.screens[s][k] === 0) this.emit({ k: "info", msg: `Màn chắn ${k === "atk" ? "Reflect" : "Light Screen"} bên ${s} tan biến` }); } }
    for (const s of ["A", "B"]) this.m[s].flinch = false;
  }
}

export const STRUGGLE = { id: 0, name: "Struggle", type: "Normal", cat: "physical", power: 50, acc: null, pp: 1, prio: 0, effect: "", chance: null, struggle: true, spec: { partial: false, matched: true, recoil: 0 } };

// ---------------------------------------------------------------- helpers shared by page + sim
export function defaultBuild(data, speciesId, level = 50) {
  const sp = data.species.find((s) => s.id === speciesId);
  return { species: speciesId, level, nature: 0, ivs: [31, 31, 31, 31, 31, 31], evs: [0, 0, 0, 0, 0, 0], ability: sp.abilities[0], item: "", moves: defaultMoves(data, speciesId, level) };
}
export function defaultMoves(data, speciesId, level = 50) {
  const ids = (data.learnsets[String(speciesId)] || []).map((id) => data.moves.find((m) => m.id === id)).filter(Boolean);
  const dmg = ids.filter((m) => m.power).sort((a, b) => b.power * (b.acc || 100) - a.power * (a.acc || 100));
  const sp = data.species.find((s) => s.id === speciesId);
  const picked = [];
  for (const m of dmg) if (sp.types.includes(m.type) && picked.length < 2) picked.push(m);
  for (const m of dmg) if (picked.length < 4 && !picked.includes(m) && !picked.some((p) => p.type === m.type)) picked.push(m);
  for (const m of dmg) if (picked.length < 4 && !picked.includes(m)) picked.push(m);
  return picked.slice(0, 4).map((m) => m.id);
}
export function randomBuild(data, rng, level = 50) {
  const sp = data.species[rng.int(data.species.length)];
  const learn = (data.learnsets[String(sp.id)] || []);
  const pool = [...learn];
  const moves = [];
  while (moves.length < 4 && pool.length) moves.push(pool.splice(rng.int(pool.length), 1)[0]);
  const evs = [0, 0, 0, 0, 0, 0];
  let left = 510;
  const idx = [0, 1, 2, 3, 4, 5].sort(() => rng.next() - 0.5);
  for (const i of idx.slice(0, 3)) { const v = Math.min(252, left); evs[i] = v - (v % 4); left -= evs[i]; }
  const abil = [...sp.abilities, ...(sp.hidden ? [sp.hidden] : [])];
  const items = data.items.map((i) => i.name).filter((n) => ITEM_IMPL.has(n));
  return { species: sp.id, level, nature: rng.int(25), ivs: [31, 31, 31, 31, 31, 31], evs, ability: abil[rng.int(abil.length)], item: items[rng.int(items.length)], moves };
}
export const STRUGGLE_MOVE = STRUGGLE;

/** Play a whole battle with the AI on both sides. Returns {winner, turns}. */
export function autoBattle(data, bA, bB, seed, maxTurns = 300) {
  const b = new Battle(data, bA, bB, seed, { quiet: true });
  while (!b.over && b.turn < maxTurns) b.step(b.aiChoice("A"), b.aiChoice("B"));
  return { winner: b.over ? b.winner : "draw", turns: b.turn };
}
export function simulate(data, bA, bB, seed, n = 1000) {
  let a = 0, bw = 0, d = 0, turns = 0;
  for (let i = 0; i < n; i++) {
    const r = autoBattle(data, bA, bB, `${seed}#${i}`);
    if (r.winner === "A") a++; else if (r.winner === "B") bw++; else d++;
    turns += r.turns;
  }
  return { n, a, b: bw, draw: d, avgTurns: turns / n };
}
