import { Battle, calcAllStats, natureMult, damageRange, defaultBuild, defaultMoves, randomBuild, makeRng, simulate, getSpec, ABILITY_IMPL, ITEM_IMPL, STAT_KEYS, STAT_VI, STATUS_VI } from "./engine.js";
import { monArt, badgeHtml, typeColor } from "./art.js";
import { Vfx } from "./vfx.js";

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const STAT_LAB = ["HP", "Atk", "Def", "SpA", "SpD", "Spe"];
const CAT_VI = { physical: "VL", special: "ĐB", status: "TT" };
const CAT_FULL = { physical: "Vật lý", special: "Đặc biệt", status: "Trạng thái" };
const STAGE_ABBR = { atk: "ATK", def: "DEF", spa: "SPA", spd: "SPD", spe: "SPE", acc: "ACC", eva: "EVA" };

let data;
const S = { builds: { A: null, B: null }, seed: "1", mode: "manual", tab: "A", battle: null, choice: { A: null, B: null }, busy: false, token: 0, anyMove: { A: false, B: false }, sim: null, vfxOn: true };
let vfx = null;
const plates = {};

// ---------------------------------------------------------------- data
async function loadData() {
  const get = (n) => fetch(`data/${n}`).then((r) => { if (!r.ok) throw new Error(n); return r.json(); });
  const [species, moves, learnsets, natures, types, items, abilities] = await Promise.all(["species", "moves", "learnsets", "natures", "types", "items", "abilities"].map((n) => get(n + ".json")));
  data = { species, moves, learnsets, natures, types, items, abilities };
  data.moves = data.moves.filter((m) => m.name !== "Struggle");
}
const spOf = (id) => data.species.find((s) => s.id === id);
const mvOf = (id) => data.moves.find((m) => m.id === id);

// ---------------------------------------------------------------- hash + presets
const b64e = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64d = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));
const packBuild = (b) => [b.species, b.level, b.nature, b.ivs, b.evs, b.ability, b.item, b.moves];
function unpackBuild(a) {
  const [species, level, nature, ivs, evs, ability, item, moves] = a;
  const sp = spOf(species);
  if (!sp) throw new Error("species");
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(+v) || 0));
  const e = (evs || []).slice(0, 6).map((v) => clamp(v, 0, 252));
  while (e.length < 6) e.push(0);
  let tot = 0;
  for (let i = 0; i < 6; i++) { e[i] = Math.min(e[i], 510 - tot); tot += e[i]; }
  return { species, level: clamp(level, 1, 100), nature: clamp(nature, 0, 24), ivs: (ivs || []).slice(0, 6).map((v) => clamp(v, 0, 31)).concat([31, 31, 31, 31, 31, 31]).slice(0, 6), evs: e, ability: ability || sp.abilities[0], item: item || "", moves: (moves || []).filter((m) => mvOf(m)).slice(0, 4) };
}
let hashTimer = null;
function writeHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    try {
      const h = b64e(JSON.stringify({ a: packBuild(S.builds.A), b: packBuild(S.builds.B), s: S.seed, m: S.mode }));
      history.replaceState(null, "", "#m=" + h);
    } catch { /* ignore */ }
  }, 150);
}
function readHash() {
  try {
    const m = /#m=([\w-]+)/.exec(location.hash);
    if (!m) return false;
    const o = JSON.parse(b64d(m[1]));
    S.builds.A = unpackBuild(o.a); S.builds.B = unpackBuild(o.b);
    S.seed = String(o.s ?? "1"); S.mode = o.m === "auto" ? "auto" : "manual";
    return true;
  } catch { return false; }
}
const PRESET_KEY = "pbl.presets.v1";
function presets() { try { return JSON.parse(localStorage.getItem(PRESET_KEY) || "{}"); } catch { return {}; } }
function savePresets(p) { try { localStorage.setItem(PRESET_KEY, JSON.stringify(p)); return true; } catch { toast("Không lưu được vào trình duyệt (localStorage bị chặn)"); return false; } }

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2400);
}

// ---------------------------------------------------------------- derived
function statsOf(b) { return calcAllStats(spOf(b.species), b.level, b.ivs, b.evs, data.natures[b.nature]); }
const evTotal = (b) => b.evs.reduce((a, x) => a + x, 0);
const abilityList = (sp) => [...sp.abilities, ...(sp.hidden ? [sp.hidden] : [])];
function moveMetaHtml(m) {
  const pw = m.power ?? "—", ac = m.acc ?? "—";
  const sp = getSpec(m);
  return `${badgeHtml(m.type)}<span class="cat ${m.cat}" title="${CAT_FULL[m.cat]}">${CAT_VI[m.cat]}</span><span>Sức mạnh ${pw}</span><span>CX ${ac}</span><span>PP ${m.pp}</span>${m.prio ? `<span>Ưu tiên ${m.prio > 0 ? "+" : ""}${m.prio}</span>` : ""}${sp.partial ? `<span class="part" title="${esc(sp.note)}">~một phần</span>` : ""}`;
}

// ---------------------------------------------------------------- setup views
function renderSetup(side) {
  const b = S.builds[side], sp = spOf(b.species);
  const root = $("#view-" + side);
  const abs = abilityList(sp);
  const natureOpts = data.natures.map((n, i) => `<option value="${i}" ${i === b.nature ? "selected" : ""}>${n.name}${n.up ? ` (+${STAT_LAB[n.up]} −${STAT_LAB[n.down]})` : " (trung tính)"}</option>`).join("");
  const implItems = data.items.filter((i) => ITEM_IMPL.has(i.name)), noItems = data.items.filter((i) => !ITEM_IMPL.has(i.name));
  const itemOpt = (i, mark) => `<option value="${esc(i.name)}" ${i.name === b.item ? "selected" : ""}>${esc(i.name)}${mark}</option>`;
  const rows = STAT_LAB.map((lab, i) => `<tr data-i="${i}"><td class="lab">${lab}<span class="nat"></span></td>
      <td><div class="base"><div class="bar"><i style="width:${Math.min(100, (sp.base[i] / 160) * 100)}%;background:${i === 0 ? "#ff5a5f" : ["", "#f5a04d", "#f5d04d", "#6aa8ff", "#7ad98f", "#f58bd0"][i]}"></i></div><b>${sp.base[i]}</b></div></td>
      <td><input type="number" inputmode="numeric" min="0" max="31" data-f="iv" value="${b.ivs[i]}" aria-label="IV ${lab}"></td>
      <td><input type="number" inputmode="numeric" min="0" max="252" step="4" data-f="ev" value="${b.evs[i]}" aria-label="EV ${lab}"></td>
      <td class="fin" data-fin></td></tr>`).join("");
  root.innerHTML = `<div class="panel" data-side="${side}">
    <div class="row"><button class="species-btn" data-act="pick-species"></button>
      <span class="row" style="margin:0;gap:4px"><label>Lv</label><input type="number" inputmode="numeric" min="1" max="100" data-f="level" value="${b.level}" style="width:58px"></span></div>
    <div class="row"><label>Tính cách</label><select class="grow" data-f="nature">${natureOpts}</select></div>
    <table class="stats"><thead><tr><th></th><th>Chỉ số gốc</th><th>IV</th><th>EV</th><th>Cuối</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="row evleft"><span>EV còn lại: <b data-evleft></b> / 510</span><span class="grow"></span><button data-act="ev-zero">EV về 0</button><button data-act="iv-max">IV 31</button></div>
    <h2>Đặc tính</h2>
    <select data-f="ability" style="width:100%">${abs.map((a) => `<option value="${esc(a)}" ${a === b.ability ? "selected" : ""}>${esc(a)}${a === sp.hidden ? " (ẩn)" : ""}${ABILITY_IMPL.has(a) ? "" : " — không tác dụng trong sim"}</option>`).join("")}</select>
    <div class="mut" data-abtext style="margin-top:4px"></div>
    <h2>Đồ giữ</h2>
    <select data-f="item" style="width:100%"><option value="">(không giữ đồ)</option>
      <optgroup label="Có tác dụng trong sim">${implItems.map((i) => itemOpt(i, "")).join("")}</optgroup>
      <optgroup label="Không tác dụng trong sim">${noItems.map((i) => itemOpt(i, " — không tác dụng")).join("")}</optgroup></select>
    <div class="mut" data-ittext style="margin-top:4px"></div>
    <h2>Chiêu thức</h2>
    <div data-moves></div>
    <div class="btnrow"><button data-act="random">🎲 Bộ ngẫu nhiên hợp lệ</button><button data-act="reset">Đặt lại</button></div>
    <h2>Bản dựng đã lưu</h2>
    <div class="row"><input class="grow" type="text" data-f="pname" placeholder="Tên bản dựng" maxlength="30"><button data-act="preset-save" class="blue">Lưu</button></div>
    <div class="row"><select class="grow" data-f="plist"></select><button data-act="preset-load">Tải</button><button data-act="preset-del">Xóa</button></div>
    <div class="btnrow"><button data-act="copy-link">🔗 Sao chép liên kết trận đấu</button><button data-act="to-battle" class="primary">Sang trận đấu →</button></div>
  </div>`;
  refreshSetup(side);
}
function refreshSetup(side) {
  const b = S.builds[side], sp = spOf(b.species), root = $("#view-" + side);
  const stats = statsOf(b), nat = data.natures[b.nature];
  const sb = $(".species-btn", root);
  sb.innerHTML = "";
  sb.append(monArt(sp, { size: 52, mini: true }));
  const info = document.createElement("div");
  info.innerHTML = `<div class="nm">${esc(sp.name)}</div><div class="tbs">${sp.types.map(badgeHtml).join("")}</div>`;
  sb.append(info);
  root.querySelectorAll("tbody tr").forEach((tr) => {
    const i = +tr.dataset.i;
    const m = natureMult(nat, i);
    $("[data-fin]", tr).textContent = stats[i];
    $("[data-fin]", tr).className = "fin" + (i && m > 1 ? " up" : i && m < 1 ? " dn" : "");
    $(".nat", tr).innerHTML = i && m > 1 ? ' <span class="up">▲</span>' : i && m < 1 ? ' <span class="dn">▼</span>' : "";
  });
  const left = 510 - evTotal(b);
  $("[data-evleft]", root).textContent = left;
  $(".evleft", root).classList.toggle("over", left < 0);
  $("[data-abtext]", root).textContent = (data.abilities[b.ability]?.text || "") + (ABILITY_IMPL.has(b.ability) ? "" : " (không có tác dụng trong sim)");
  const it = data.items.find((x) => x.name === b.item);
  $("[data-ittext]", root).textContent = it ? it.effect + (ITEM_IMPL.has(it.name) ? "" : " (không có tác dụng trong sim)") : "";
  const mv = $("[data-moves]", root);
  mv.innerHTML = "";
  for (let k = 0; k < 4; k++) {
    const m = b.moves[k] != null ? mvOf(b.moves[k]) : null;
    const slot = document.createElement("div");
    slot.className = "mvslot";
    slot.innerHTML = `<button class="mvbtn" data-act="pick-move" data-k="${k}">${m ? `<span class="n"><span>${esc(m.name)}</span></span><span class="m">${moveMetaHtml(m)}</span>` : `<span class="n mut">+ Chọn chiêu ${k + 1}</span>`}</button>${m ? `<button class="mvx" data-act="clear-move" data-k="${k}" aria-label="Xóa chiêu">✕</button>` : ""}`;
    mv.append(slot);
  }
  const pl = $('[data-f="plist"]', root);
  const p = presets();
  pl.innerHTML = Object.keys(p).length ? Object.keys(p).map((n) => `<option>${esc(n)}</option>`).join("") : "<option value=''>(chưa có bản dựng nào)</option>";
  S.battle = null; S.sim = null; S.choice = { A: null, B: null }; S.token++;
  writeHash();
}

function bindSetup(side) {
  const root = $("#view-" + side);
  root.addEventListener("input", (e) => {
    const f = e.target.dataset.f, b = S.builds[side];
    if (!f) return;
    const row = e.target.closest("tr");
    const i = row ? +row.dataset.i : 0;
    if (f === "level") b.level = Math.max(1, Math.min(100, Math.round(+e.target.value) || 1));
    else if (f === "iv") b.ivs[i] = Math.max(0, Math.min(31, Math.round(+e.target.value) || 0));
    else if (f === "ev") {
      const others = evTotal(b) - b.evs[i];
      let v = Math.max(0, Math.min(252, Math.round(+e.target.value) || 0));
      v = Math.min(v, Math.max(0, 510 - others));
      b.evs[i] = v;
      if (String(v) !== e.target.value && e.target.value !== "") e.target.value = v;
    } else if (f === "nature") b.nature = +e.target.value;
    else if (f === "ability") b.ability = e.target.value;
    else if (f === "item") b.item = e.target.value;
    else return;
    refreshSetup(side);
  });
  root.addEventListener("click", (e) => {
    const t = e.target.closest("[data-act]");
    if (!t) return;
    const b = S.builds[side], act = t.dataset.act;
    if (act === "pick-species") openSpeciesSheet(side);
    else if (act === "pick-move") openMoveSheet(side, +t.dataset.k);
    else if (act === "clear-move") { b.moves.splice(+t.dataset.k, 1); refreshSetup(side); }
    else if (act === "ev-zero") { b.evs = [0, 0, 0, 0, 0, 0]; syncInputs(side); refreshSetup(side); }
    else if (act === "iv-max") { b.ivs = [31, 31, 31, 31, 31, 31]; syncInputs(side); refreshSetup(side); }
    else if (act === "reset") { S.builds[side] = defaultBuild(data, b.species, b.level); renderSetup(side); toast("Đã đặt lại bản dựng"); }
    else if (act === "random") {
      const rb = randomBuild(data, makeRng(String(Math.random())), b.level);
      const nb = { ...rb, species: b.species, ability: abilityList(spOf(b.species))[Math.floor(Math.random() * abilityList(spOf(b.species)).length)] };
      const learn = (data.learnsets[String(b.species)] || []).filter((id) => mvOf(id));
      const pool = [...learn]; const moves = [];
      while (moves.length < 4 && pool.length) moves.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      nb.moves = moves;
      S.builds[side] = nb; renderSetup(side); toast("Đã tạo bộ ngẫu nhiên hợp lệ");
    }
    else if (act === "preset-save") {
      const name = $('[data-f="pname"]', root).value.trim();
      if (!name) return toast("Nhập tên bản dựng trước");
      const p = presets(); p[name] = packBuild(b);
      if (savePresets(p)) { toast(`Đã lưu "${name}"`); refreshSetup(side); }
    }
    else if (act === "preset-load" || act === "preset-del") {
      const name = $('[data-f="plist"]', root).value;
      const p = presets();
      if (!name || !p[name]) return toast("Chưa chọn bản dựng");
      if (act === "preset-del") { delete p[name]; savePresets(p); refreshSetup(side); return; }
      try { S.builds[side] = unpackBuild(p[name]); renderSetup(side); toast(`Đã tải "${name}"`); } catch { toast("Bản dựng hỏng"); }
    }
    else if (act === "copy-link") copyLink();
    else if (act === "to-battle") setTab("battle");
  });
}
function syncInputs(side) {
  const b = S.builds[side];
  $("#view-" + side).querySelectorAll("tbody tr").forEach((tr) => { $('[data-f="iv"]', tr).value = b.ivs[+tr.dataset.i]; $('[data-f="ev"]', tr).value = b.evs[+tr.dataset.i]; });
}
async function copyLink() {
  writeHash();
  await new Promise((r) => setTimeout(r, 200));
  try { await navigator.clipboard.writeText(location.href); toast("Đã sao chép liên kết"); }
  catch { window.prompt("Sao chép liên kết:", location.href); }
}

// ---------------------------------------------------------------- sheets
function closeSheet() { const s = $("#sheet"); s.hidden = true; s.innerHTML = ""; }
function openSheet(headHtml, onBuild) {
  const s = $("#sheet");
  s.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="sheet-head">${headHtml}<button data-close>Đóng</button></div><div class="sheet-list"></div></div>`;
  s.hidden = false;
  s.onclick = (e) => { if (e.target === s || e.target.closest("[data-close]")) closeSheet(); };
  onBuild($(".sheet-list", s), $(".sheet-head", s));
}
function openSpeciesSheet(side) {
  openSheet(`<input type="search" placeholder="Tìm theo tên, số hoặc hệ…" autocomplete="off" aria-label="Tìm Pokémon">`, (list, head) => {
    const input = $("input", head);
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      const rows = data.species.filter((sp) => !q || sp.name.toLowerCase().includes(q) || String(sp.id).padStart(3, "0").includes(q.replace("#", "")) || sp.types.some((t) => t.toLowerCase().includes(q)));
      list.innerHTML = "";
      for (const sp of rows) {
        const b = document.createElement("button");
        b.className = "sheet-row" + (S.builds[side].species === sp.id ? " sel" : "");
        b.dataset.id = sp.id;
        b.append(monArt(sp, { size: 40, mini: true }));
        const d = document.createElement("div");
        d.innerHTML = `<div class="nm">${esc(sp.name)}</div><div class="sub">${sp.types.map(badgeHtml).join("")}<span>HP ${sp.base[0]} · Atk ${sp.base[1]} · Def ${sp.base[2]} · SpA ${sp.base[3]} · SpD ${sp.base[4]} · Spe ${sp.base[5]}</span></div>`;
        b.append(d);
        b.onclick = () => {
          const old = S.builds[side];
          const nb = defaultBuild(data, sp.id, old.level);
          nb.nature = old.nature; nb.ivs = old.ivs; nb.evs = old.evs; nb.item = old.item;
          S.builds[side] = nb;
          closeSheet(); renderSetup(side);
        };
        list.append(b);
      }
      if (!rows.length) list.innerHTML = '<p class="mut" style="padding:12px">Không tìm thấy.</p>';
    };
    input.addEventListener("input", draw); draw();
    setTimeout(() => input.focus({ preventScroll: true }), 50);
  });
}
function openMoveSheet(side, k) {
  const b = S.builds[side];
  openSheet(`<input type="search" placeholder="Tìm chiêu hoặc hệ…" autocomplete="off" aria-label="Tìm chiêu"><label class="mut" style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-any ${S.anyMove[side] ? "checked" : ""}> Mọi chiêu</label>`, (list, head) => {
    const input = $("input[type=search]", head), any = $("[data-any]", head);
    const draw = () => {
      S.anyMove[side] = any.checked;
      const learn = new Set(data.learnsets[String(b.species)] || []);
      const q = input.value.trim().toLowerCase();
      const rows = data.moves.filter((m) => (any.checked || learn.has(m.id)) && (!q || m.name.toLowerCase().includes(q) || m.type.toLowerCase().includes(q) || CAT_FULL[m.cat].toLowerCase().includes(q)));
      list.innerHTML = "";
      for (const m of rows) {
        const btn = document.createElement("button");
        btn.className = "sheet-row" + (b.moves.includes(m.id) ? " sel" : "");
        btn.innerHTML = `<div style="min-width:0;flex:1"><div class="nm">${esc(m.name)}${learn.has(m.id) ? "" : ' <span class="mut">(ngoài bộ học)</span>'}</div><div class="sub">${moveMetaHtml(m)}</div></div>`;
        btn.onclick = () => {
          if (b.moves.includes(m.id) && b.moves[k] !== m.id) return toast("Chiêu này đã có trong bộ");
          b.moves[k] = m.id;
          b.moves = b.moves.filter((x) => x != null).slice(0, 4);
          closeSheet(); refreshSetup(side);
        };
        list.append(btn);
      }
      if (!rows.length) list.innerHTML = '<p class="mut" style="padding:12px">Không có chiêu phù hợp. Bật "Mọi chiêu" để xem tất cả.</p>';
    };
    input.addEventListener("input", draw); any.addEventListener("change", draw); draw();
    setTimeout(() => input.focus({ preventScroll: true }), 50);
  });
}

// ---------------------------------------------------------------- battle view
function renderBattleShell() {
  const root = $("#view-battle");
  root.innerHTML = `
  <div class="ctl">
    <div class="seg" role="group" aria-label="Chế độ"><button data-mode="manual">Thủ công</button><button data-mode="auto">Tự động</button></div>
    <label>Seed <input type="text" id="seed" value="${esc(S.seed)}" maxlength="24" aria-label="Seed"></label>
    <button id="btn-new" title="Bắt đầu trận mới với seed hiện tại">Trận mới</button>
    <label style="display:flex;gap:4px;align-items:center"><input type="checkbox" id="vfx-on" ${S.vfxOn ? "checked" : ""}> VFX</label>
  </div>
  <div class="sidelab"><span>B — đối thủ</span><span id="vfx-state" class="mut"></span></div>
  <div class="movegrid" id="mv-B"></div>
  <div class="stagewrap"><div class="stage" id="stage"><canvas id="fx"></canvas>
    <div class="mcard cB" id="card-B"></div><div class="mcard cA" id="card-A"></div></div>
    <div class="banner" id="banner" hidden></div></div>
  <div class="movegrid" id="mv-A"></div>
  <div class="sidelab"><span>A — bạn</span><span class="mut" id="turnlab"></span></div>
  <div class="actions">
    <button class="primary" id="btn-turn">Lượt</button>
    <button id="btn-end">Chạy tới cuối</button>
    <button id="btn-skip" title="Bỏ qua hiệu ứng, ghi log nhanh">Chạy nhanh</button>
    <button id="btn-sim" class="blue wide">Mô phỏng 1000 trận</button>
  </div>
  <div class="log" id="log" aria-live="polite"></div>
  <div id="simbox"></div>`;
  const stage = $("#stage");
  for (const s of ["A", "B"]) {
    const p = monArt(spOf(S.builds[s].species), { size: 96 });
    p.classList.add("p" + s); p.id = "plate-" + s;
    stage.prepend(p); plates[s] = p;
  }
  vfx = new Vfx($("#fx"), stage, plates);
  vfx.init().then((ok) => { $("#vfx-state").textContent = ok ? "VFX: đã tải" : "VFX: không tải được (dùng hiệu ứng nháy)"; });
  root.onclick = (e) => {
    const t = e.target.closest("button, input");
    if (!t) return;
    if (t.dataset.mode) { S.mode = t.dataset.mode; S.choice = { A: null, B: null }; updateModeUi(); updateMoves(); writeHash(); }
    else if (t.id === "btn-new") { S.seed = $("#seed").value || "1"; newBattle(); }
    else if (t.id === "btn-turn") doTurn(false);
    else if (t.id === "btn-end") runToEnd(false);
    else if (t.id === "btn-skip") runToEnd(true);
    else if (t.id === "btn-sim") runSim();
    else if (t.closest(".mb")) pickMove(t.closest(".mb"));
  };
  $("#seed").addEventListener("change", (e) => { const v = e.target.value || "1"; if (v === S.seed) return; S.seed = v; writeHash(); newBattle(); });
  $("#vfx-on").addEventListener("change", (e) => (S.vfxOn = e.target.checked));
  updateModeUi();
  newBattle();
}
function updateModeUi() { document.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === S.mode))); }

function newBattle() {
  S.token++;
  S.busy = false;
  S.choice = { A: null, B: null };
  S.sim = null;
  $("#simbox").innerHTML = "";
  $("#log").innerHTML = "";
  $("#banner").hidden = true;
  try { S.battle = new Battle(data, S.builds.A, S.builds.B, S.seed); }
  catch (e) { toast("Không dựng được trận: " + e.message); return; }
  for (const s of ["A", "B"]) {
    const old = plates[s];
    const np = monArt(spOf(S.builds[s].species), { size: 96 });
    np.classList.add("p" + s); np.id = "plate-" + s;
    old.replaceWith(np); plates[s] = np;
  }
  const first = S.battle.events.splice(0);
  renderSnap(first[first.length - 1]?.snap || snapNow());
  for (const ev of first) appendLog(ev);
  updateMoves();
  writeHash();
}
const snapNow = () => ({ A: snapOf(S.battle.m.A), B: snapOf(S.battle.m.B) });
const snapOf = (m) => ({ hp: m.hp, max: m.maxHp, status: m.status, conf: m.confused > 0, stages: { ...m.stages }, item: m.itemLost ? null : m.item, ability: m.ability, seeded: m.seeded, sub: m.sub });

function renderSnap(snap) {
  if (!snap) return;
  for (const s of ["A", "B"]) {
    const m = S.battle.m[s], c = snap[s], card = $("#card-" + s);
    const pct = Math.max(0, (c.hp / c.max) * 100);
    const chips = [];
    if (c.status) chips.push(`<span class="chip st-${c.status}">${STATUS_VI[c.status]}</span>`);
    if (c.conf) chips.push('<span class="chip st-conf">Rối loạn</span>');
    if (c.seeded) chips.push('<span class="chip st-seed">Leech Seed</span>');
    if (c.sub > 0) chips.push(`<span class="chip st-sub">Sub ${c.sub}</span>`);
    for (const [k, v] of Object.entries(c.stages)) if (v) chips.push(`<span class="chip ${v > 0 ? "up" : "dn"}">${STAGE_ABBR[k]} ${v > 0 ? "+" : ""}${v}</span>`);
    const old = $(".hp i", card);
    const w = old ? old.style.width : "100%";
    card.innerHTML = `<div class="l1"><span class="nm">${esc(m.name)}</span><span class="lv">Lv${m.level}</span></div>
      <div class="tbs">${m.types.map(badgeHtml).join("")}</div>
      <div class="hp"><i class="${pct <= 20 ? "low" : pct <= 50 ? "mid" : ""}" style="width:${w}"></i></div>
      <div class="hpn"><span>${c.hp} / ${c.max}</span><span>${Math.ceil(pct)}%</span></div>
      <div class="chips">${chips.join("")}</div>
      <div class="iline">${esc(c.item || "không đồ")} · ${esc(c.ability || "—")}</div>`;
    const i = $(".hp i", card);
    requestAnimationFrame(() => { i.style.width = pct + "%"; });
    plates[s].classList.toggle("fainted", c.hp <= 0);
  }
  $("#turnlab").textContent = `Lượt ${S.battle.turn}${S.battle.over ? " · kết thúc" : ""}`;
}

function appendLog(ev) {
  const log = $("#log");
  const d = document.createElement("div");
  d.className = ev.k;
  d.textContent = ev.msg || "";
  if (ev.k === "info" && ev.partial) d.classList.add("miss");
  log.append(d);
  log.scrollTop = log.scrollHeight;
}

function updateMoves() {
  const b = S.battle;
  if (!b) return;
  for (const s of ["A", "B"]) {
    const u = b.m[s], t = b.m[s === "A" ? "B" : "A"];
    const grid = $("#mv-" + s);
    grid.innerHTML = "";
    const usable = new Set(b.usable(u).map((x) => x.i));
    const forced = !!(u.charging || u.thrash);
    u.moves.forEach((m, i) => {
      const dr = damageRange(data, u, t, m, s);
      const spec = m.spec;
      const btn = document.createElement("button");
      const ok = usable.has(i) && !b.over;
      btn.className = "mb" + (S.choice[s] === i ? " sel" : "") + (!ok || S.mode === "auto" ? " dim" : "");
      btn.style.borderLeftColor = typeColor(m.type);
      btn.dataset.side = s; btn.dataset.i = i;
      btn.disabled = !ok;
      const dmg = b.over || t.hp <= 0 ? "<span>—</span>" : dr ? `<b>${dr.pctMin.toFixed(0)}–${dr.pctMax.toFixed(0)}%</b>${dr.hits[1] > 1 ? ` ×${dr.hits[0] === dr.hits[1] ? dr.hits[0] : dr.hits[0] + "-" + dr.hits[1]}` : ""} · <span class="ko">${esc(dr.koText)}</span>` : `<span>${m.cat === "status" ? "Trạng thái" : "Không sát thương"}</span>`;
      btn.title = `${m.name} — ${m.type} ${CAT_FULL[m.cat]}\nSức mạnh ${m.power ?? "—"} · CX ${m.acc ?? "—"} · PP ${m.ppLeft}/${m.maxPp} · Ưu tiên ${m.prio}\n${m.effect}${spec.partial ? "\n(Một phần: " + spec.note + ")" : ""}`;
      btn.innerHTML = `${spec.partial ? `<span class="partial" title="${esc(spec.note)}">~</span>` : ""}<span class="n">${esc(m.name)}</span><span class="d">${badgeHtml(m.type)} <span class="cat ${m.cat}">${CAT_VI[m.cat]}</span> PP ${m.ppLeft}/${m.maxPp}${m.prio ? ` · ưu tiên ${m.prio > 0 ? "+" : ""}${m.prio}` : ""}</span><span class="d">${dmg}</span>`;
      grid.append(btn);
    });
    if (forced) { const n = document.createElement("div"); n.className = "mut"; n.style.gridColumn = "1/-1"; n.textContent = `${u.name} đang bị khóa vào đòn đang thực hiện`; grid.append(n); }
  }
  $("#btn-turn").disabled = S.busy || b.over;
  $("#btn-end").disabled = S.busy || b.over;
  $("#btn-skip").disabled = S.busy || b.over;
}
function pickMove(btn) {
  if (S.busy || S.mode === "auto" || btn.disabled) return;
  const s = btn.dataset.side, i = +btn.dataset.i;
  S.choice[s] = S.choice[s] === i ? null : i;
  updateMoves();
  if (S.choice.A != null && S.choice.B != null) $("#btn-turn").focus({ preventScroll: true });
}

// ---- playing events
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function playEvents(events, fast, token) {
  for (const ev of events) {
    if (token !== S.token) return false;
    renderSnap(ev.snap);
    appendLog(ev);
    if (fast) continue;
    const side = ev.side, other = side === "A" ? "B" : "A";
    let delay = 260;
    if (ev.k === "turn") delay = 120;
    else if (ev.k === "move") {
      let played = false;
      if (S.vfxOn && vfx && vfx.ok) { try { played = await vfx.playMove(side, ev.move, ev.mtype, ev.cat); } catch { played = false; } }
      if (!played) { flash(plates[other], typeColor(ev.mtype)); await wait(420); }
      delay = 120;
    } else if (ev.k === "hit") { if (!ev.indirectHit) { if (ev.crit && S.vfxOn && vfx?.ok) await vfx.playSimple(ev.side, "crit-hit", { mode: "center", max: 500 }); } delay = 380; }
    else if (ev.k === "miss") { if (S.vfxOn && vfx?.ok) await vfx.playSimple(ev.side === "A" ? "B" : "A", "miss", { max: 700 }); else await wait(300); delay = 200; }
    else if (ev.k === "stat" && S.vfxOn && vfx?.ok) { await vfx.playSimple(ev.side, ev.up ? "stat-up" : "stat-down", { max: 650 }); delay = 100; }
    else if (ev.k === "heal" && S.vfxOn && vfx?.ok) { await vfx.playSimple(ev.side, "heal", { max: 650 }); delay = 100; }
    else if (ev.k === "status" && ev.status && S.vfxOn && vfx?.ok) {
      const id = { brn: "status-burn", psn: "status-poison", tox: "status-poison", par: "status-paralysis", slp: "status-sleep", frz: "status-freeze", conf: "status-confusion" }[ev.status];
      if (id) await vfx.playSimple(ev.side, id, { max: 750 }); delay = 100;
    } else if (ev.k === "faint") {
      if (S.vfxOn && vfx?.ok) await vfx.playSimple(ev.side, "faint-vanish", { max: 800 }); else await wait(300);
      delay = 150;
    } else if (ev.k === "end") delay = 100;
    await wait(delay);
  }
  return true;
}
function flash(el, color) { el.style.boxShadow = `0 0 0 4px ${color}, 0 0 24px ${color}`; el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); setTimeout(() => (el.style.boxShadow = ""), 450); }

function showResult() {
  const b = S.battle;
  if (!b.over) return;
  const ban = $("#banner");
  ban.hidden = false;
  ban.textContent = b.winner === "draw" ? "Hòa" : `${b.m[b.winner].name} (${b.winner}) thắng · ${b.turn} lượt`;
}
async function doTurn(fast) {
  const b = S.battle;
  if (!b || b.over || S.busy) return;
  const token = S.token;
  let ca = S.choice.A, cb = S.choice.B;
  if (S.mode === "auto") { ca = b.aiChoice("A"); cb = b.aiChoice("B"); }
  else if (ca == null || cb == null) return toast("Chọn chiêu cho cả A và B rồi bấm Lượt");
  S.busy = true; updateMoves();
  const ev = b.step(ca, cb);
  const ok = await playEvents(ev, fast, token);
  if (!ok) return;
  S.busy = false; S.choice = { A: null, B: null };
  renderSnap(ev[ev.length - 1]?.snap);
  updateMoves(); showResult();
}
async function runToEnd(fast) {
  const b = S.battle;
  if (!b || b.over || S.busy) return;
  const token = S.token;
  S.busy = true; updateMoves();
  while (!b.over && b.turn < 300 && token === S.token) {
    const ev = b.step(b.aiChoice("A"), b.aiChoice("B"));
    if (!(await playEvents(ev, fast, token))) return;
  }
  S.busy = false; S.choice = { A: null, B: null };
  renderSnap(snapNow()); updateMoves(); showResult();
}
function runSim() {
  const box = $("#simbox");
  box.innerHTML = '<div class="sim mut">Đang mô phỏng…</div>';
  setTimeout(() => {
    const t0 = performance.now();
    const r = simulate(data, S.builds.A, S.builds.B, S.seed, 1000);
    const ms = Math.round(performance.now() - t0);
    S.sim = r;
    const pa = (r.a / r.n) * 100, pb = (r.b / r.n) * 100, pd = (r.draw / r.n) * 100;
    box.innerHTML = `<div class="sim"><b>Kết quả 1000 trận</b> <span class="mut">(AI chọn chiêu tốt nhất, seed "${esc(S.seed)}", ${ms} ms)</span>
      <div class="simbar"><i class="a" style="width:${pa}%">${pa >= 8 ? pa.toFixed(1) + "%" : ""}</i><i class="d" style="width:${pd}%"></i><i class="b" style="width:${pb}%">${pb >= 8 ? pb.toFixed(1) + "%" : ""}</i></div>
      <div class="row" style="justify-content:space-between;margin:2px 0"><span>A ${esc(spOf(S.builds.A.species).name)}: <b id="sim-a">${r.a}</b> thắng (${pa.toFixed(1)}%)</span></div>
      <div class="row" style="justify-content:space-between;margin:2px 0"><span>B ${esc(spOf(S.builds.B.species).name)}: <b id="sim-b">${r.b}</b> thắng (${pb.toFixed(1)}%)</span></div>
      <div class="row" style="justify-content:space-between;margin:2px 0"><span>Hòa: <b>${r.draw}</b></span><span>Số lượt trung bình: <b id="sim-turns">${r.avgTurns.toFixed(2)}</b></span></div></div>`;
    box.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, 30);
}

// ---------------------------------------------------------------- tabs / boot
function setTab(t) {
  S.tab = t;
  for (const id of ["A", "B", "battle"]) {
    $("#view-" + id).hidden = id !== t;
    $("#tab-" + id).setAttribute("aria-selected", String(id === t));
  }
  if (t === "battle") {
    renderBattleShell();
  }
  window.scrollTo(0, 0);
}
async function boot() {
  await loadData();
  if (!readHash()) {
    S.builds.A = defaultBuild(data, 6, 50);
    S.builds.B = defaultBuild(data, 9, 50);
  }
  for (const s of ["A", "B"]) { renderSetup(s); bindSetup(s); }
  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
  setTab(/#m=/.test(location.hash) && new URLSearchParams(location.search).get("tab") === "battle" ? "battle" : "A");
  window.__pbl = { S, data, get vfx() { return vfx; }, setTab, newBattle, doTurn, runToEnd, runSim, plates };
  document.documentElement.dataset.ready = "1";
}
boot().catch((e) => { document.body.insertAdjacentHTML("beforeend", `<pre style="color:#f88;padding:12px">Lỗi tải: ${esc(e.message)}</pre>`); console.error(e); });
