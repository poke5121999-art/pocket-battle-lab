// node tests/e2e.mjs [baseUrl] [shotsDir]  — Playwright walkthrough at 390x844. Exit 1 on any console error.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import os from "node:os";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_CORE || os.homedir() + "/.cache/pw-node/node_modules/playwright-core");
const BASE = process.argv[2] || "http://localhost:8765/pocket-battle-lab/";
const SHOTS = process.argv[3] || os.homedir() + "/handoff/pkbattle/shots";
mkdirSync(SHOTS, { recursive: true });
const errors = [], notes = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("requestfailed", (r) => errors.push("requestfailed: " + r.url() + " " + (r.failure()?.errorText || "")));
page.on("response", (r) => { if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`); });
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` });
const check = (name, ok, extra = "") => { notes.push(`${ok ? "ok  " : "FAIL"} ${name} ${extra}`); if (!ok) errors.push("check: " + name + " " + extra); };

await page.goto(BASE);
await page.waitForSelector("html[data-ready='1']");

async function pickSpecies(side, query, rowText) {
  await page.click(`#view-${side} [data-act=pick-species]`);
  await page.fill('#sheet input[type=search]', query);
  await page.click(`#sheet .sheet-row:has-text("${rowText}")`);
}
async function pickMoves(side, names) {
  for (let k = 0; k < names.length; k++) {
    await page.click(`#view-${side} [data-act=pick-move][data-k="${k}"]`);
    await page.fill('#sheet input[type=search]', names[k]);
    await page.click(`#sheet .sheet-row .nm:text-is("${names[k]}")`);
  }
}
// ---- build A: Pikachu, Timid, EV Spe/SpA, Light Ball, 4 moves
await page.click("#tab-A");
await pickSpecies("A", "pikachu", "Pikachu");
await page.fill("#view-A [data-f=level]", "50");
await page.selectOption("#view-A [data-f=nature]", { label: "Timid (+Spe −Atk)" });
const rowsA = page.locator("#view-A tbody tr");
await rowsA.nth(3).locator("[data-f=ev]").fill("252");
await rowsA.nth(5).locator("[data-f=ev]").fill("252");
await page.selectOption("#view-A [data-f=item]", "Light Ball");
await page.click("#view-A [data-act=clear-move][data-k='0']").catch(() => {});
await pickMoves("A", ["Thunderbolt", "Quick Attack", "Thunder Wave", "Surf"].slice(0, 3));
const finSpe = await rowsA.nth(5).locator("[data-fin]").textContent();
check("A final Spe (Pikachu Lv50 base90 IV31 EV252 Timid) = 156", finSpe.trim() === "156", "got " + finSpe);
await page.evaluate(() => scrollTo(0, 0));
await shot("01-setup-A");
// ---- build B: Snorlax with Leftovers, via UI (bulky, so the fight lasts several turns)
await page.click("#tab-B");
await pickSpecies("B", "snorlax", "Snorlax");
await page.selectOption("#view-B [data-f=nature]", { label: "Careful (+SpD −SpA)" });
await page.locator("#view-B tbody tr").nth(4).locator("[data-f=ev]").fill("252");
await page.locator("#view-B tbody tr").nth(0).locator("[data-f=ev]").fill("252");
const left = await page.locator("#view-B [data-evleft]").textContent();
check("B EV remaining = 6", left.trim() === "6", "got " + left);
await page.selectOption("#view-B [data-f=item]", "Leftovers");
await page.fill("#view-B [data-f=level]", "40");
await page.evaluate(() => scrollTo(0, 0));
await shot("02-setup-B");
await page.evaluate(() => scrollTo(0, 700));
await shot("02b-setup-B-moves");

// ---- battle: manual turn
await page.click("#tab-battle");
await page.waitForSelector("#mv-A .mb");
await page.fill("#seed", "demo");
await page.dispatchEvent("#seed", "change");
await page.waitForSelector("#mv-A .mb");
await page.waitForTimeout(1200); // fx.json load
const vfxOk = await page.evaluate(() => !!(window.__pbl.vfx && window.__pbl.vfx.ok));
check("fx.json loaded from poke5121999-art.github.io", vfxOk);
await shot("03-battle-start");
await page.click("#mv-A .mb >> nth=0");
await page.click("#mv-B .mb >> nth=0");
await page.click("#btn-turn");
let sawFx = false;
for (let i = 0; i < 80 && !sawFx; i++) {
  await page.waitForTimeout(60);
  sawFx = await page.evaluate(() => window.__pbl.vfx.actors.length > 0);
  if (sawFx) {
    // wait until the effect is past its first frames so the screenshot shows the effect itself
    await page.waitForFunction(() => { const f = window.__pbl.vfx.lastFrame; return f && f.t > 110; }, null, { timeout: 3000 }).catch(() => {});
    await shot("04-battle-vfx");
  }
}
check("a VFX actor was drawn during the turn", sawFx);
await page.waitForFunction(() => !window.__pbl.S.busy, null, { timeout: 15000 });
const logLines = await page.locator("#log div").count();
check("log has lines after a manual turn", logLines > 4, "lines=" + logLines);
const playedFx = await page.evaluate(() => JSON.stringify(window.__pbl.vfx.played));
notes.push("vfx played: " + playedFx);
await shot("05-after-turn");

// ---- auto to end
await page.click('[data-mode=auto]');
await page.click("#btn-new");
await page.click("#btn-end");
await page.waitForFunction(() => window.__pbl.S.battle.over && !window.__pbl.S.busy, null, { timeout: 90000 });
check("auto battle reached the end", await page.locator("#banner").isVisible());
await shot("06-result");
// ---- sim
await page.click("#btn-sim");
await page.waitForSelector("#sim-a");
const sa = +(await page.textContent("#sim-a")), sb = +(await page.textContent("#sim-b")), st = +(await page.textContent("#sim-turns"));
check("sim 1000: a+b<=1000 and turns>0", sa + sb <= 1000 && sa + sb > 0 && st > 0, `A=${sa} B=${sb} turns=${st}`);
await page.evaluate(() => scrollTo(0, 99999));
await shot("07-sim");

// ---- reload from URL hash
const url = page.url();
check("URL carries the setup", /#m=/.test(url), url.slice(0, 80) + "…");
const before = await page.evaluate(() => JSON.stringify([window.__pbl.S.builds, window.__pbl.S.seed, window.__pbl.S.mode]));
const page2 = await ctx.newPage();
page2.on("console", (m) => { if (m.type() === "error") errors.push("console2: " + m.text()); });
page2.on("pageerror", (e) => errors.push("pageerror2: " + e.message));
await page2.goto(url);
await page2.reload();
await page2.waitForSelector("html[data-ready='1']");
const after = await page2.evaluate(() => JSON.stringify([window.__pbl.S.builds, window.__pbl.S.seed, window.__pbl.S.mode]));
check("reload from hash reproduces both builds + seed + mode", before === after);
// same seed => same battle log on both pages
await page2.evaluate(() => window.__pbl.setTab("battle"));
await page2.waitForSelector("#btn-end");
await page2.click("#btn-end");
await page2.waitForFunction(() => window.__pbl.S.battle.over && !window.__pbl.S.busy, null, { timeout: 90000 });
const log2 = await page2.locator("#log").innerText();
await page.click("#btn-new");
await page.click("#btn-skip");
await page.waitForFunction(() => window.__pbl.S.battle.over && !window.__pbl.S.busy, null, { timeout: 30000 });
const log1 = await page.locator("#log").innerText();
check("same seed replays the same log across page loads", log1 === log2, `${log1.length} vs ${log2.length} chars`);
// preset save/load (localStorage)
await page.click("#tab-A");
await page.fill("#view-A [data-f=pname]", "Pika test");
await page.click("#view-A [data-act=preset-save]");
await page.waitForTimeout(100);
const stored = await page.evaluate(() => localStorage.getItem("pbl.presets.v1"));
check("preset saved in localStorage", !!stored && stored.includes("Pika test"));
// horizontal overflow check on each tab
for (const t of ["A", "B", "battle"]) {
  await page.click("#tab-" + t);
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`no horizontal overflow on tab ${t}`, ov <= 0, "overflow=" + ov);
}
await browser.close();
console.log(notes.join("\n"));
console.log(errors.length ? "\nERRORS:\n" + errors.join("\n") : "\nzero console errors");
process.exit(errors.length ? 1 : 0);
