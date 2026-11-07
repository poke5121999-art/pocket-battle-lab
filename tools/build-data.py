#!/usr/bin/env python3
"""Turn the researched CSVs in ~/handoff/pkgen1 into data/*.json for the static site.
Usage: python3 tools/build-data.py [SRC_DIR]   (default ~/handoff/pkgen1)"""
import csv, json, os, sys

SRC = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else "~/handoff/pkgen1")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
os.makedirs(OUT, exist_ok=True)

def rows(p):
    with open(os.path.join(SRC, p), newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))

def dump(name, obj):
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))

def num(v):
    v = (v or "").strip()
    if v == "":
        return None
    try:
        return int(v)
    except ValueError:
        return None

species = []
for r in rows("species/species.csv"):
    abil = [a for a in (r["ability1"], r["ability2"], r["hidden_ability"]) if a]
    species.append({
        "id": int(r["id"]), "name": r["name"],
        "types": [t for t in (r["type1"], r["type2"]) if t],
        "base": [int(r[k]) for k in ("hp", "atk", "def", "spa", "spd", "spe")],
        "abilities": [r["ability1"]] + ([r["ability2"]] if r["ability2"] else []),
        "hidden": r["hidden_ability"] or None,
        "stage": int(r["evolution_stage"] or 1),
        "evolves": bool(r["evolves_from"]) or None,
    })
# can still evolve = some other species has evolves_from == this name
frm = {r["evolves_from"] for r in rows("species/species.csv") if r["evolves_from"]}
for s in species:
    s["canEvolve"] = s["name"] in frm
    s.pop("evolves", None)
dump("species.json", species)

abilities = {}
for r in rows("species/abilities.csv"):
    abilities[r["ability"]] = {"text": r["short_effect"], "relevant": r["combat_relevant"] == "yes"}
dump("abilities.json", abilities)

moves = []
for r in rows("battle/moves.csv"):
    moves.append({
        "id": int(r["id"]), "name": r["name"], "type": r["type"], "cat": r["category"],
        "power": num(r["power"]), "acc": num(r["accuracy"]), "pp": num(r["pp"]) or 5,
        "prio": num(r["priority"]) or 0, "effect": r["effect_short"],
        "chance": num(r["effect_chance"]), "target": r["target"],
    })
dump("moves.json", moves)

# learnset: only the modern version groups, union by species -> list of move ids
ls = {}
mid = {m["name"]: m["id"] for m in moves}
for r in rows("battle/learnsets.csv"):
    if r["version_group"] not in ("brilliant-diamond-shining-pearl", "lets-go-pikachu-lets-go-eevee", "red-blue", "yellow"):
        continue
    m = int(r["move_id"])
    ls.setdefault(int(r["dex"]), set()).add(m)
dump("learnsets.json", {str(k): sorted(v) for k, v in ls.items()})

natures = []
stat_key = {"Attack": 1, "Defense": 2, "Sp. Atk": 3, "Sp. Def": 4, "Speed": 5}
for r in rows("battle/natures.csv"):
    natures.append({"name": r["name"], "up": stat_key.get(r["increased_stat_x1.1"]), "down": stat_key.get(r["decreased_stat_x0.9"])})
dump("natures.json", natures)

tc = rows("battle/type-chart.csv")
types = [k for k in tc[0].keys() if k != "attacker\\defender"]
chart = {r["attacker\\defender"]: [float(r[t]) for t in types] for r in tc}
dump("types.json", {"types": types, "chart": chart})

items = []
for r in rows("items/held-items.csv"):
    items.append({"name": r["item"], "effect": r["effect"], "group": r["group"]})
dump("items.json", items)
print("species", len(species), "moves", len(moves), "learnsets", len(ls), "items", len(items), "abilities", len(abilities))
