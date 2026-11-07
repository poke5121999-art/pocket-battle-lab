// Placeholder art. No official artwork: each mon is a type-coloured rounded plate with the dex number and name.
// monArt() is the ONLY place that draws a creature, so real art can be swapped in here later.

export const TYPE_COLORS = {
  Normal: "#a8a77a", Fire: "#ee8130", Water: "#6390f0", Electric: "#f7d02c", Grass: "#7ac74c", Ice: "#96d9d6",
  Fighting: "#c22e28", Poison: "#a33ea1", Ground: "#e2bf65", Flying: "#a98ff3", Psychic: "#f95587", Bug: "#a6b91a",
  Rock: "#b6a136", Ghost: "#735797", Dragon: "#6f35fc", Dark: "#705746", Steel: "#b7b7ce", Fairy: "#d685ad",
};
const DARK_TEXT = new Set(["Electric", "Ice", "Ground", "Steel", "Normal", "Bug", "Grass", "Rock"]);

export const typeColor = (t) => TYPE_COLORS[t] || "#777";
export function badge(t) {
  const s = document.createElement("span");
  s.className = "tb";
  s.textContent = t;
  s.style.background = typeColor(t);
  s.style.color = DARK_TEXT.has(t) ? "#1a1a1a" : "#fff";
  return s;
}
export const badgeHtml = (t) => `<span class="tb" style="background:${typeColor(t)};color:${DARK_TEXT.has(t) ? "#1a1a1a" : "#fff"}">${t}</span>`;

/** monArt(species, {size}) -> element. species = {id, name, types}. */
export function monArt(sp, opts = {}) {
  const size = opts.size || 96;
  const el = document.createElement("div");
  el.className = "plate";
  const c1 = typeColor(sp.types[0]), c2 = typeColor(sp.types[1] || sp.types[0]);
  el.style.cssText = `width:${size}px;height:${size}px;background:linear-gradient(145deg,${c1} 0%,${c1} 45%,${c2} 100%)`;
  const dark = DARK_TEXT.has(sp.types[0]);
  el.style.color = dark ? "#1a1a1a" : "#fff";
  const num = document.createElement("div");
  num.className = "plate-num";
  num.textContent = "#" + String(sp.id).padStart(3, "0");
  num.style.fontSize = Math.round(size * 0.26) + "px";
  el.append(num);
  if (!opts.mini) {
    const nm = document.createElement("div");
    nm.className = "plate-name";
    nm.textContent = sp.name;
    nm.style.fontSize = Math.max(10, Math.round(size * 0.13)) + "px";
    el.append(nm);
  }
  return el;
}
