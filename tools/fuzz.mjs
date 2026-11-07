// node tools/fuzz.mjs [n]  — random builds (any move, any item, any ability), reports crashes and non-terminating battles.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Battle, randomBuild, makeRng } from "../js/engine.js";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const L = (n) => JSON.parse(readFileSync(path.join(root, "data", n), "utf8"));
const data = { species: L("species.json"), moves: L("moves.json"), learnsets: L("learnsets.json"), natures: L("natures.json"), types: L("types.json"), items: L("items.json"), abilities: L("abilities.json") };
const n = +process.argv[2] || 3000;
const rng = makeRng("fuzz");
let crashes = 0, stuck = 0, turns = 0, any = 0;
for (let i = 0; i < n; i++) {
  const a = randomBuild(data, rng, 1 + rng.int(100)), b = randomBuild(data, rng, 1 + rng.int(100));
  if (i % 2) { a.moves = []; while (a.moves.length < 4) a.moves.push(data.moves[rng.int(data.moves.length)].id); any++; }
  try {
    const bt = new Battle(data, a, b, "s" + i);
    while (!bt.over && bt.turn < 400) bt.step(bt.aiChoice("A"), bt.aiChoice("B"));
    if (!bt.over) { stuck++; if (stuck < 4) console.log("stuck", JSON.stringify(a), JSON.stringify(b)); }
    turns += bt.turn;
  } catch (e) { crashes++; if (crashes < 4) console.log("CRASH", e.stack.split("\n").slice(0, 3).join(" | "), JSON.stringify(a.moves), a.ability, a.item); }
}
console.log({ battles: n, crashes, stuck, avgTurns: (turns / n).toFixed(1) });
