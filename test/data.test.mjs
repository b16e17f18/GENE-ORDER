import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(join(root, path));
const html = read("index.html").toString("utf8");
const scripts = [...html.matchAll(/<script src="\.\/([^"?]+)(?:\?[^"]*)?"/g)].map((match) => match[1]);

function runtime({ protocol = "http:", missing = "", invalid = "", utf8Error = "", transforms = {} } = {}) {
  const requested = [];
  const images = [];
  const storageCalls = [];
  const elements = new Map();
  const storage = new Map([["mhb_save_1", "MHB original"]]);
  let boot;
  const context = vm.createContext({
    TextDecoder,
    console: { error() {} },
    document: {
      addEventListener(event, callback) {
        if (event === "DOMContentLoaded") boot = callback;
      },
      querySelector(id) {
        if (id === "#go-battle") return null;
        if (!elements.has(id)) elements.set(id, {
          setAttribute(name, value) { this[name] = value; },
        });
        return elements.get(id);
      },
    },
    window: {
      location: { protocol },
      MHB_CSV: new Proxy({}, { get() { throw new Error("MHB fallback attempted"); } }),
      localStorage: {
        getItem(key) {
          storageCalls.push(["read", key]);
          return storage.get(key);
        },
        setItem(key, value) {
          storageCalls.push(["write", key]);
          storage.set(key, value);
        },
      },
    },
    async fetch(path) {
      requested.push(path);
      if (path.endsWith(missing) && missing) return { ok: false, status: 404 };
      const bytes = invalid && path.endsWith(invalid) ? Buffer.from("not,a,valid,header")
        : utf8Error && path.endsWith(utf8Error) ? Buffer.from([0xff]) : read(path);
      const transform = transforms[path];
      return { ok: true, arrayBuffer: async () => transform ? Buffer.from(transform(bytes.toString("utf8"))) : bytes };
    },
    Image: class {
      set src(path) {
        images.push(path);
        if (existsSync(join(root, decodeURIComponent(path)))) this.onload();
        else this.onerror();
      }
    },
  });
  for (const path of scripts) vm.runInContext(read(path).toString("utf8"), context, { filename: path });
  const run = (code) => vm.runInContext(code, context);
  return { requested, images, storage, storageCalls, elements, run, boot };
}

const go = runtime();
await go.boot();

test("production scripts parse and evaluate in index.html order", () => {
  assert.deepEqual(scripts, ["data-validation.js", "passive.js", "battle-core.js", "battle-ai.js",
    "bgm.js", "dialogue-manager.js", "app.js"]);
  assert.match(go.elements.get("#go-status").textContent, /46体.*65件.*7種/);
});

test("reads only the nine official UTF-8 tables", () => {
  assert.deepEqual(go.requested.sort(), ["battle_effect", "character", "effect", "element",
    "element_effectiveness", "passive", "power_rule", "skill", "species"].map((name) => "./data/" + name + ".csv"));
  assert.equal(go.run("state.enemyParties.size"), 0);
  assert.equal(go.run("state.rankBattles.size"), 0);
});

test("loads Japanese character, skill and passive names and keeps passive linkage", () => {
  assert.equal(go.run('state.characters[0].name'), "チャイ");
  assert.equal(go.run('state.skills.get("skill_001").name'), "歌声");
  assert.equal(go.run('state.passives.get("passive_001").name'), "リバイブ");
  assert.equal(go.run('state.characters[0].passive === state.passives.get("passive_001")'), true);
  assert.equal(go.run('state.passives.size'), 24);
});

test("distinguishes explicit neutral, absent and unknown attributes, and loads evasion and species", () => {
  assert.equal(go.run('state.characters[0].element_1'), "none");
  assert.equal(go.run('state.characters[0].element_2'), null);
  assert.equal(go.run('state.characters[0].evasion_percent'), 85);
  assert.equal(go.run('state.characters[0].species_id'), "beast");
  assert.equal(go.run('state.skills.get("skill_001").element'), "none");
  assert.equal(go.run('state.skills.get("skill_001").element2'), null);
  assert.equal(go.run(`normalizeCharacter({ element_1: "unknown" }, masterIdLookup([...state.elements.values()], "element_id"), new Map()).element_1`), null);
});

test("keeps all 49 matchups and all four zeros", () => {
  assert.equal(go.run('state.elements.size'), 7);
  assert.equal(go.run('[...state.effectiveness.values()].reduce((n, row) => n + row.size, 0)'), 49);
  assert.equal(go.run('[...state.effectiveness.values()].flatMap((row) => [...row.values()]).filter((n) => n === 0).length'), 4);
  assert.equal(go.run('state.effectiveness.get("none").get("dark")'), 0);
});

test("excludes placeholders and never fills absent moves with MHB attacks", () => {
  assert.equal(go.run('state.characterMap.has("character_045")'), false);
  assert.equal(go.run('state.skills.size'), 65);
  assert.equal(go.run('movesForCharacter(state.characterMap.get("character_025")).length'), 0);
  assert.equal(go.run('state.skills.has("basic_strike")'), false);
});

test("diagnoses unresolved move references and unset passive definitions", () => {
  assert.equal(go.run('state.dataDiagnostics.some((d) => d.level === "参照不一致" && d.value === "burn")'), true);
  assert.equal(go.run('state.skills.get("skill_001").effect1'), "bf_pa_down1");
  assert.equal(go.run('state.dataDiagnostics.some((d) => d.level === "効果未設定" && d.id === "passive_015")'), true);
  assert.equal(go.run('state.dataDiagnostics.some((d) => d.level === "参照先未設定" && d.value === "passive_025")'), true);
  assert.equal(go.run('state.dataDiagnostics.filter((d) => d.level === "予約行").length'), 93);
});

test("validator catches duplicate IDs, matrix pair gaps and invalid numbers", () => {
  assert.equal(go.run(`
    (() => {
      const tables = Object.fromEntries(Object.keys(GO_DATA_IDS).map((key) => [key, []]));
      tables.elements = [{ element_id: "fire", name: "火" }, { element_id: "fire", name: "火" },
        { element_id: "none", name: "無" }];
      tables.effectiveness = [{ attack_element: "fire", defense_element: "fire", multiplier: "0" },
        { attack_element: "fire", defense_element: "fire", multiplier: "bad" }];
      const levels = validateGeneOrderData(tables, () => true).map((d) => d.level);
      return ["重複ID", "相性欠落", "相性重複", "数値異常"].every((level) => levels.includes(level));
    })()
  `), true);
});

test("uses the local image path, reports missing files, and renders a placeholder", () => {
  assert.equal(go.run('state.characters[0].imageSrc'), "./asset/character_001.png");
  assert.equal(go.run('state.characters.filter((c) => c.imageSrc).length'), 44);
  assert.equal(go.run('state.dataDiagnostics.filter((d) => d.level === "画像欠落").length'), 2);
  assert.match(go.elements.get("#go-roster").innerHTML, /画像未設定/);
});

test("storage rejects MHB keys and uses only the GO namespace", () => {
  assert.deepEqual(go.storageCalls, []);
  assert.equal(go.run('readStorageValue("mhb_save_1")'), "");
  assert.throws(() => go.run('setStorageValue("mhb_save_1", "overwrite")'), /Invalid GO save key/);
  go.run('setStorageValue(MANUAL_SAVE_STORAGE_KEYS[0], "GO");');
  assert.equal(go.run('readStorageValue(MANUAL_SAVE_STORAGE_KEYS[0])'), "GO");
  assert.equal(go.storage.get("mhb_save_1"), "MHB original");
  assert.deepEqual(go.storageCalls, [["write", "gene_order:save:1"], ["read", "gene_order:save:1"]]);
});

test("HTTP failures and invalid inputs produce explicit errors without fallback", async () => {
  for (const [options, error] of [
    [{ missing: "character.csv" }, /character\.csv.*HTTP 404/],
    [{ invalid: "passive.csv" }, /passive\.csv.*必須のCSV列/],
    [{ utf8Error: "skill.csv" }, /skill\.csv.*UTF-8/i],
  ]) {
    const failure = runtime(options);
    await failure.boot();
    assert.match(failure.elements.get("#go-status").textContent, error);
    assert.equal(failure.elements.get("#go-status").role, "alert");
    assert.equal(failure.run("state.characters.length"), 0);
  }
});

test("file protocol tells the user to start HTTP and performs no CSV fetch", async () => {
  const file = runtime({ protocol: "file:" });
  await file.boot();
  assert.match(file.elements.get("#go-status").textContent, /HTTPサーバー/);
  assert.deepEqual(file.requested, []);
});

if (process.env.GO_REPORT === "1") {
  const issues = JSON.parse(go.run("JSON.stringify(state.dataDiagnostics)"));
  const report = Object.groupBy(issues, ({ level }) => level);
  for (const [level, entries] of Object.entries(report)) {
    console.log(level, entries.length, [...new Set(entries.map((entry) => entry.value).filter(Boolean))].sort().join(", "));
  }
}

test("reloading CSV over the data loader changes live battle tuning without code changes", async () => {
  const updateCell = (csv, id, column, value) => {
    const rows = csv.split(/\r?\n/);
    const index = rows[0].split(",").indexOf(column);
    const rowIndex = rows.findIndex((row) => row.startsWith(id + ","));
    assert.notEqual(index, -1);
    assert.notEqual(rowIndex, -1);
    const cells = rows[rowIndex].split(",");
    cells[index] = value;
    rows[rowIndex] = cells.join(",");
    return rows.join("\n");
  };
  const updated = runtime({ transforms: {
    "./data/effect.csv": (text) => updateCell(updateCell(text, "poison", "damage_value", "20"), "poison", "turn", "3"),
    "./data/skill.csv": (text) => updateCell(text, "skill_027", "effect_chance1", "50"),
    "./data/battle_effect.csv": (text) => updateCell(text, "revenge", "damage_value", "200"),
    "./data/power_rule.csv": (text) => updateCell(text, "go_en_value_7", "power_multiplier", "2"),
  } });
  await updated.boot();
  const scenario = `
    (() => {
      const battle = geneOrderBattle.createBattle({
        player: [state.characterMap.get("character_007")], enemy: [{ ...state.characterMap.get("character_020"), hp: 352 }],
        skills: state.skills, effects: state.effects, battleEffects: state.battleEffects,
        powerRules: state.powerRules, effectiveness: state.effectiveness, random: () => 0.49,
      });
      const fighter = geneOrderBattle.activeFighter(battle, "player");
      const foe = geneOrderBattle.activeFighter(battle, "enemy");
      geneOrderBattle.changeEnergy(fighter, 6);
      geneOrderBattle.changeEnergy(foe, 6);
      const charge = state.skills.get("skill_054");
      const power = geneOrderBattle.previewDamage(battle, "enemy", charge).power;
      const result = geneOrderBattle.resolveTurn(battle, {
        player: { type: "move", moveId: "skill_027" }, enemy: { type: "wait" },
      });
      return JSON.stringify([power, result.events.find(e => e.type === "residual").damage, foe.statuses[0].turns,
        state.skills.get("skill_027").effect_chance1, state.battleEffects.get("revenge").damage_value]);
    })()
  `;
  assert.deepEqual(JSON.parse(go.run(scenario)), [195, 35, 6, 100, 150]);
  assert.deepEqual(JSON.parse(updated.run(scenario)), [200, 70, 2, 50, 200]);
});
