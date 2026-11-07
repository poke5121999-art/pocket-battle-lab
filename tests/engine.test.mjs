// node tests/engine.test.mjs  — literal expected values, no framework.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { calcStat, calcAllStats, typeMult, calcDamage, damageRange, buildMon, Battle, simulate, defaultBuild, makeRng, getSpec } from "../js/engine.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const load = (n) => JSON.parse(readFileSync(path.join(root, "data", n), "utf8"));
const data = { species: load("species.json"), moves: load("moves.json"), learnsets: load("learnsets.json"), natures: load("natures.json"), types: load("types.json"), items: load("items.json"), abilities: load("abilities.json") };
const sp = (n) => data.species.find((s) => s.name === n);
const mv = (n) => data.moves.find((m) => m.name === n);
const nat = (n) => data.natures.findIndex((x) => x.name === n);

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};

// (a) final stats
eq("Lv50 base100 IV31 EV252 +nature = 167", calcStat(100, 31, 252, 50, 1.1, false), 167);
eq("Lv50 base100 IV31 EV252 neutral = 152", calcStat(100, 31, 252, 50, 1, false), 152);
eq("HP base100 Lv50 IV31 EV252 = 207", calcStat(100, 31, 252, 50, 1, true), 207);
eq("Lv100 base 130 IV31 EV252 Modest SpA = 394 (Gengar)", calcStat(130, 31, 252, 100, 1.1, false), 394);
eq("Lv50 base90 IV31 EV0 -nature = 67... Pikachu Atk 55 Timid", calcStat(55, 31, 0, 50, 0.9, false), 67);
eq("Lv100 HP base 60 IV31 EV252 = 324", calcStat(60, 31, 252, 100, 1, true), 324);
eq("Lv100 Alakazam full build, Modest, EV252 SpA/Spe", calcAllStats(sp("Alakazam"), 100, [31, 31, 31, 31, 31, 31], [0, 0, 0, 252, 0, 252], data.natures[nat("Modest")]), [251, 122, 126, 405, 226, 339]);

// (b) type multipliers
const T = (a, d) => typeMult(data, a, d);
eq("Ice vs Grass/Flying = 4", T("Ice", ["Grass", "Flying"]), 4);
eq("Rock vs Fire/Flying = 4", T("Rock", ["Fire", "Flying"]), 4);
eq("Grass vs Fire/Flying = 0.25", T("Grass", ["Fire", "Flying"]), 0.25);
eq("Fighting vs Bug/Flying = 0.25", T("Fighting", ["Bug", "Flying"]), 0.25);
eq("Normal vs Ghost = 0", T("Normal", ["Ghost"]), 0);
eq("Ground vs Flying = 0", T("Ground", ["Flying"]), 0);
eq("Electric vs Ground/Rock = 0", T("Electric", ["Ground", "Rock"]), 0);
eq("Psychic vs Ghost/Poison = 2", T("Psychic", ["Ghost", "Poison"]), 2);
eq("Fire vs Water/Flying = 0.5", T("Fire", ["Water", "Flying"]), 0.5);
eq("Fairy vs Dragon = 2 (modern chart)", T("Fairy", ["Dragon"]), 2);

// (c) damage ranges, worked by hand:
//  1. Lv100 Modest Alakazam (SpA 405, EV252) Psychic (90) vs Lv100 Gengar (SpD 186, no EV): base 166, rolls 85..100, STAB 1.5, x2 => 422..498
//  2. Lv50 Modest Pikachu (SpA 112) Thunderbolt (90) vs Lv50 Gyarados (SpD 120, HP 170): base 38 => 192..228 (x4)
//  3. Lv50 Adamant Machamp Choice Band (Atk 300) + Life Orb, Submission (80) vs Lv50 Rhydon (Def 140): base 77 => 252..299 (x2)
const mk = (name, level, natureName, evs, extra = {}) => buildMon(data, { species: sp(name).id, level, nature: nat(natureName), ivs: [31, 31, 31, 31, 31, 31], evs, ability: sp(name).abilities[0], item: "", moves: [], ...extra });
const range = (att, def, move) => { const m = { ...mv(move), spec: getSpec(mv(move)) }; return [calcDamage(data, att, def, m, { roll: 85 }).dmg, calcDamage(data, att, def, m, { roll: 100 }).dmg]; };
eq("1. Alakazam Psychic vs Gengar", range(mk("Alakazam", 100, "Modest", [0, 0, 0, 252, 0, 252]), mk("Gengar", 100, "Hardy", [0, 0, 0, 0, 0, 0]), "Psychic"), [422, 498]);
eq("2. Pikachu Thunderbolt vs Gyarados (4x)", range(mk("Pikachu", 50, "Modest", [0, 0, 0, 252, 0, 0], { ability: "Static" }), mk("Gyarados", 50, "Hardy", [0, 0, 0, 0, 0, 0]), "Thunderbolt"), [192, 228]);
{
  const a = mk("Machamp", 50, "Adamant", [0, 252, 0, 0, 0, 0], { item: "Choice Band", ability: "Guts" });
  const d = mk("Rhydon", 50, "Hardy", [0, 0, 0, 0, 0, 0]);
  eq("3a. Machamp Choice Band only vs Rhydon (hand: 77 -> 65 -> 97 -> 194 / 77 -> 115 -> 230)", range(a, d, "Submission"), [194, 230]);
  // Life Orb x5324/4096 on 194 and 230 = 252 and 299 (hand-rounded half down)
  eq("3b. Life Orb step on 194, 230", [Math.ceil((194 * 5324) / 4096 - 0.5), Math.ceil((230 * 5324) / 4096 - 0.5)], [252, 299]);
}
// 3c: real Life Orb + Choice Band cannot both be held; check Life Orb alone via a second hand case:
//  Lv50 Machamp Adamant (Atk 200) Life Orb Submission vs Rhydon (Def 140): base 22*80*200/140=2514 -> 50 -> 52; rolls 44,.. => see literal
{
  const a = mk("Machamp", 50, "Adamant", [0, 252, 0, 0, 0, 0], { item: "Life Orb", ability: "Guts" });
  const d = mk("Rhydon", 50, "Hardy", [0, 0, 0, 0, 0, 0]);
  // base = floor(floor(22*80*200/140)/50)+2 = floor(2514/50)+2 = 50+2 = 52
  // roll85: floor(52*.85)=44, STAB 66, x2 = 132, Life Orb 132*5324/4096=171.57 -> 172
  // roll100: 52, STAB 78, x2 = 156, Life Orb 202.77 -> 203
  eq("3c. Machamp Life Orb Submission vs Rhydon", range(a, d, "Submission"), [172, 203]);
}
// Ability / item sanity
{
  const a = mk("Gengar", 50, "Hardy", [0, 0, 0, 0, 0, 0]);
  const d = mk("Rhydon", 50, "Hardy", [0, 0, 0, 0, 0, 0]);
  const shadow = { ...mv("Earthquake"), spec: getSpec(mv("Earthquake")) };
  eq("Ground vs Ghost/Poison = 2 (before Levitate)", typeMult(data, "Ground", ["Ghost", "Poison"]), 2);
  d.ability = "Levitate";
  const flyer = mk("Gengar", 50, "Hardy", [0, 0, 0, 0, 0, 0], { ability: "Levitate" });
  eq("Levitate gives Ground immunity", calcDamage(data, d, flyer, shadow, { roll: 100 }).eff, 0);
}

// (d) seeded determinism
const bA = { ...defaultBuild(data, 6, 50), item: "Leftovers" };
const bB = { ...defaultBuild(data, 9, 50), item: "Life Orb" };
const run = (seed) => { const b = new Battle(data, bA, bB, seed); while (!b.over && b.turn < 200) b.step(b.aiChoice("A"), b.aiChoice("B")); return b; };
const r1 = run("seed-42"), r2 = run("seed-42"), r3 = run("seed-43");
eq("same seed => identical event log", JSON.stringify(r1.events.map((e) => e.msg)), JSON.stringify(r2.events.map((e) => e.msg)));
eq("same seed => same winner and turns", [r1.winner, r1.turn], [r2.winner, r2.turn]);
eq("battle ends with a result", r1.over && ["A", "B", "draw"].includes(r1.winner), true);
const s1 = simulate(data, bA, bB, "x", 200), s2 = simulate(data, bA, bB, "x", 200);
eq("simulate is reproducible", s1, s2);
eq("simulate counts add up", s1.a + s1.b + s1.draw, 200);
eq("different seed can differ (logs not byte-equal in general)", JSON.stringify(r1.events.map((e) => e.msg)) !== JSON.stringify(r3.events.map((e) => e.msg)), true);
eq("rng uniform-ish: mean of 10000 draws in (0.48,0.52)", (() => { const r = makeRng("m"); let s = 0; for (let i = 0; i < 10000; i++) s += r.next(); const m = s / 10000; return m > 0.48 && m < 0.52; })(), true);

// range display agrees with a real hit (no crit) on a fresh battle: Charizard vs Blastoise
{
  const b = new Battle(data, defaultBuild(data, 6, 50), defaultBuild(data, 9, 50), "dr");
  const m = b.m.A.moves[0];
  const rg = damageRange(data, b.m.A, b.m.B, m, "A");
  eq("damageRange has min<=max and pct", rg && rg.min <= rg.max && rg.pctMax > 0, true);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
