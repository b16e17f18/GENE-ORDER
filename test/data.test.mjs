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
// Master sizes may grow while users edit CSV. Distinguish intentional blanks from invalid definitions.
const csvRows = name => go.run('rowsFromCsv(' + JSON.stringify(read('data/' + name + '.csv').toString('utf8')) + ')');
const passiveRows = csvRows('passive');
const pendingPassiveIds = passiveRows.filter(row => row.name && [1,2,3].every(slot => !row['passive_type'+slot] || row['passive_type'+slot] === 'none')).map(row => row.passive_id);
const reservedPassives = passiveRows.filter(row => row.passive_id && !row.name && !row.text).length;
const reservedMasters = reservedPassives + csvRows('character').filter(row => row.character_id && !row.name).length + csvRows('skill').filter(row => row.skill_id && !row.name && !row.category).length;


test("production scripts parse and evaluate in index.html order", () => {
  assert.deepEqual(scripts, ["data-validation.js", "passive.js", "battle-core.js", "battle-ai.js",
    "bgm.js", "dialogue-manager.js", "go-ui.js", "app.js"]);
  assert.match(go.elements.get("#go-status").textContent, /46体.*89件.*9種/);
});

test("reads only the official UTF-8 tables", () => {
  assert.deepEqual(go.requested.sort(), ["animation", "battle_effect", "character", "effect", "element",
    "element_effectiveness", "passive", "passive_type", "power_rule", "skill", "species"].map((name) => "./data/" + name + ".csv"));
  assert.equal(go.run("state.enemyParties.size"), 0);
  assert.equal(go.run("state.rankBattles.size"), 0);
});

test("normal effect IDs use snake_case and renamed references resolve with unchanged definitions", () => {
  assert.equal(go.run('[...state.effects.keys()].every((id) => /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(id))'), true);
  for (const [id, name, value, turns] of [
    ["evasion_up", "回避率倍化", 2, 1],
    ["clear_field", "フィールド解除", 0, 0],
    ["bind", "締めつけ", 10, 3],
    ["recoil_25", "反動ダメージ", 25, 0],
  ]) {
    const effect = go.run(`state.effects.get("${id}")`);
    assert.equal(effect.name, name);
    assert.equal(effect.damage_value, value);
    assert.equal(effect.turn, turns);
    assert.ok(go.run(`geneOrderBattle.effectKind(state.effects.get("${id}"))`));
    assert.equal(go.run(`state.dataDiagnostics.some((issue) => issue.level === "参照不一致" && issue.value === "${id}")`), false);
  }
  assert.equal(go.run('state.effects.get("evasion_up").start_delay'), 1);
  assert.equal(go.run('state.effects.get("clear_buff").name'), "能力上昇解除");
  for (const [skill, effect] of [["034", "evasion_up"], ["039", "clear_field"], ["046", "recoil_25"],
    ["052", "bind"], ["059", "bind"]]) {
    assert.equal(go.run(`state.skills.get("skill_${skill}").effect1`), effect);
    assert.ok(go.run(`state.effects.has(state.skills.get("skill_${skill}").effect1)`));
  }
});

test("imported fixed heal tuning reloads from CSV and matches actual healing", async () => {
  const revised = runtime({ transforms: {
    "./data/effect.csv": (csv) => csv.replace("heal_hp1,体力回復,heal,fixed_hp,300", "heal_hp1,体力回復,heal,fixed_hp,125"),
  } });
  await revised.boot();
  const scenario = `(() => {
    const go = geneOrderBattle;
    const move = { ...state.skills.get("skill_003"), effect1: "heal_hp1", effect2: "none", effect3: "none", cost: 0 };
    const actor = { ...state.characterMap.get("character_001"), hp: 1000, skillIds: [move.skill_id] };
    const match = go.createBattle({ player: [actor], enemy: [actor], skills: new Map([[move.skill_id, move]]),
      effects: state.effects, effectiveness: state.effectiveness });
    const fighter = go.activeFighter(match, "player");
    fighter.hp = 1;
    const predicted = go.previewDamage(match, "player", move).actorHp;
    go.resolveTurn(match, { player: { type: "move", moveId: move.skill_id }, enemy: { type: "wait" } });
    return JSON.stringify([predicted, fighter.hp]);
  })()`;
  assert.deepEqual(JSON.parse(go.run(scenario)), [301, 326]);
  assert.deepEqual(JSON.parse(revised.run(scenario)), [126, 151]);
  assert.equal(go.run('state.dataDiagnostics.some((issue) => ["heal_hp1", "heal_hp2", "heal_hp3", "phy_protect", "phy_protect2", "sp_protect2", "fire_protect", "thunder_protect", "ice_protect", "wind_protect", "earth_protect", "light_protect", "dark_protect", "none_protect"].includes(issue.id))'), false);
});

test("natural recovery reloads from character CSV and emits the actual recovered HP", async () => {
  const revised = runtime({ transforms: {
    "./data/character.csv": (csv) => {
      const lines = csv.split(/\r?\n/);
      const column = lines[0].split(",").indexOf("regen_value");
      const index = lines.findIndex((line) => line.startsWith("character_001,"));
      const cells = lines[index].split(",");
      cells[column] = "30";
      lines[index] = cells.join(",");
      return lines.join("\n");
    },
  } });
  await revised.boot();
  const scenario = `(() => {
    const go = geneOrderBattle;
    const match = go.createBattle({ player: [state.characterMap.get("character_001")],
      enemy: [state.characterMap.get("character_002")], skills: state.skills, effectiveness: state.effectiveness });
    const actor = go.activeFighter(match, "player");
    actor.hp = 50;
    const result = go.resolveTurn(match, { player: { type: "wait" }, enemy: { type: "wait" } });
    const event = result.events.find((entry) => entry.source === "natural");
    return JSON.stringify([actor.hp, event.recovered, describeGeneOrderEvent(event)]);
  })()`;
  const normal = JSON.parse(go.run(scenario));
  const changed = JSON.parse(revised.run(scenario));
  assert.deepEqual(normal.slice(0, 2), [75, 25]);
  assert.deepEqual(changed.slice(0, 2), [80, 30]);
  assert.match(normal[2], /自然回復.*25/);
  assert.match(changed[2], /自然回復.*30/);
});

test("passive type master covers the handlers, configured effects and legacy alias", () => {
  assert.equal(go.run("state.passiveTypes.size"), 34);
  assert.equal(go.run('state.passives.size'), passiveRows.filter(row=>row.name).length);
  assert.equal(go.run('[...state.passives.values()].filter(p=>!'+JSON.stringify([...pendingPassiveIds,"passive_026","passive_029"])+'.includes(p.passive_id)).every(p=>p.status==="implemented")'),true);
  assert.deepEqual(JSON.parse(go.run('JSON.stringify([...state.passives.values()].filter(p=>p.issues.length).map(p=>[p.passive_id,p.status,p.issues.map(i=>[i.field,i.value])]))')), [["passive_026","partial",[["target_id3","all"]]],["passive_029","partial",[["target_id1","all"]]]]);
  assert.equal(go.run('state.passives.get("passive_007").effects[0].value'), 0.5);
  assert.equal(go.run('state.passives.get("passive_007").effects[0].element'), "none");
  assert.equal(go.run('state.dataDiagnostics.some((issue) => issue.table === "passiveTypes")'), false);
  assert.equal(go.run(`geneOrderPassives.normalize({ name: "Old EN", passive_type1: "start_energy",
    target_id1: "en", value1: "3" }, new Set(), new Set(),
    geneOrderPassives.readTypes([...state.passiveTypes.values()])).effects[0].type`), "starting_en");
});

test("a new passive type ID and alias reuse an existing handler through CSV", async () => {
  const revised = runtime({ transforms: {
    "./data/passive_type.csv": (csv) => csv.trimEnd() + "\n" +
      "custom_reduction,試験軽減,element_damage_multiplier,incoming-damage,element,number,0,1,FALSE,TRUE,none,test_reduction,既存の被ダメージ処理を再利用する\n",
    "./data/passive.csv": (csv) => csv.replace("element_damage_multiplier,neutral,0.5", "test_reduction,neutral,0.25"),
  } });
  await revised.boot();
  assert.equal(revised.run('state.passives.get("passive_007").effects[0].type'), "custom_reduction");
  assert.equal(revised.run('state.passives.get("passive_007").status'), "implemented");
  const scenario = `(() => {
    const go = geneOrderBattle;
    const skill = state.skills.get("skill_023");
    const actor = { ...state.characterMap.get("character_006"), skillIds: [skill.skill_id] };
    const target = { ...state.characterMap.get("character_007"), hp: 1000 };
    const battle = go.createBattle({ player: [actor], enemy: [target], skills: state.skills,
      effects: state.effects, battleEffects: state.battleEffects, effectiveness: state.effectiveness, passives: state.passives });
    go.changeEnergy(go.activeFighter(battle, "player"), 7);
    const preview = go.previewDamage(battle, "player", skill);
    const hp = go.activeFighter(battle, "enemy").hp;
    const result = go.resolveTurn(battle, { player: { type: "move", moveId: skill.skill_id }, enemy: { type: "wait" } });
    return JSON.stringify([preview.damage, result.events.find((event) => event.type === "move" && event.side === "player").actualDamage]);
  })()`;
  const original = JSON.parse(go.run(scenario));
  const updated = JSON.parse(revised.run(scenario));
  assert.equal(original[0], original[1]);
  assert.equal(updated[0], updated[1]);
  assert.ok(updated[0] > 0 && updated[0] < original[0]);
});

test("CSV value bounds validate passive values after reload", async () => {
  const revised = runtime({ transforms: {
    "./data/passive_type.csv": (csv) => csv.replace("incoming-damage,element,number,0,1,FALSE", "incoming-damage,element,number,0,0.4,FALSE"),
  } });
  await revised.boot();
  assert.equal(revised.run('state.passives.get("passive_007").status'), "pending");
  assert.equal(revised.run('state.dataDiagnostics.some((issue) => issue.id === "passive_007" && issue.field === "value1")'), true);
});

test("invalid passive type definitions stop startup with the master path", async () => {
  const mutations = [
    (csv) => csv.replace("初期EN,starting_en,", "初期EN,missing_handler,"),
    (csv) => csv.replace("starting_en,battle-start,", "starting_en,turn-end,"),
    (csv) => csv.replace("battle-start,energy,", "battle-start,element,"),
    (csv) => csv.replace("energy,integer,", "energy,unknown,"),
    (csv) => csv.replace("integer,0,,TRUE", "integer,NaN,,TRUE"),
    (csv) => csv.replace("number,0,1,FALSE,TRUE", "number,2,1,FALSE,TRUE"),
    (csv) => csv.replace("none,start_energy,", "none,element_immunity,"),
    (csv) => csv.replace("none,start_energy,", "none,none,"),
    (csv) => csv.replace("stat_condition,,", "priority,,"),
    (csv) => csv.split(/\r?\n/).filter((row) => !row.startsWith("starting_en,")).join("\n"),
    (csv) => csv.trimEnd() + "\n" + csv.split(/\r?\n/)[1],
  ];
  for (const mutate of mutations) {
    const revised = runtime({ transforms: { "./data/passive_type.csv": mutate } });
    await revised.boot();
    assert.equal(revised.elements.get("#go-status").role, "alert");
    assert.match(revised.elements.get("#go-status").textContent, /passive_type[.]csv/);
    assert.equal(revised.run("state.characters.length"), 0);
  }
  const missing = runtime({ missing: "passive_type.csv" });
  await missing.boot();
  assert.equal(missing.elements.get("#go-status").role, "alert");
  assert.match(missing.elements.get("#go-status").textContent, /passive_type[.]csv/);
});

test("each named skill uses valid animation metadata and a matching PNG sheet", () => {
  const missing = go.run('[...state.skills.values()].filter(move => !state.moveAnimations.has(move.animation_id)).map(move => move.skill_id)');
  assert.equal(missing.length, 0);
  const sheets = go.run("[...state.moveAnimations.values()]");
  assert.ok(sheets.length > 5);
  for (const { path, width, height, columns, rows } of sheets) {
    const image = read(path);
    assert.equal(image.toString("ascii", 1, 4), "PNG", path);
    assert.equal(image.readUInt32BE(16), width * columns, path);
    assert.equal(image.readUInt32BE(20), height * rows, path);
  }
  assert.equal(go.run('state.skills.get("skill_045").animation_id'), "attack_slash03");
  assert.equal(go.run('state.skills.get("skill_038").repeat_count'), 2);
});

test("loads Japanese character, skill and passive names and keeps passive linkage", () => {
  assert.equal(go.run('state.characters[0].name'), "チャイ");
  assert.equal(go.run('state.skills.get("skill_001").name'), "歌声");
  assert.equal(go.run('state.passives.get("passive_001").name'), "リバイブ");
  assert.equal(go.run('state.characters[0].passive === state.passives.get("passive_001")'), true);
  assert.equal(go.run('state.passives.size'), passiveRows.filter(row=>row.name).length);
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

test("keeps the ordered nine elements, all 81 matchups and the three immunities", () => {
  assert.equal(go.run('JSON.stringify([...state.elements.keys()])'),
    JSON.stringify(['fire', 'water', 'thunder', 'ice', 'wind', 'earth', 'light', 'dark', 'none']));
  assert.equal(go.run('[...state.effectiveness.values()].reduce((n, row) => n + row.size, 0)'), 81);
  assert.equal(go.run('[...state.effectiveness.values()].flatMap((row) => [...row.values()]).filter((n) => n === 0).length'), 3);
  assert.equal(go.run('state.effectiveness.get("dark").get("earth")'), 0);
});

test("excludes placeholders and never fills absent moves with MHB attacks", () => {
  assert.equal(go.run('state.characterMap.has("character_045")'), false);
  assert.equal(go.run('state.skills.size'), 89);
  assert.equal(go.run('movesForCharacter(state.characterMap.get("character_025")).length'), 4);
  assert.equal(go.run('movesForCharacter(state.characterMap.get("character_047")).length'), 4);
  assert.equal(go.run('state.characters.every((character) => movesForCharacter(character).length === 4)'), true);
  assert.equal(go.run('JSON.stringify([...state.skills.values()].filter((move) => geneOrderBattle.moveAvailability(move, state).issues.length).map((move) => [move.skill_id, geneOrderBattle.moveAvailability(move, state).issues]))'),
    JSON.stringify([["skill_047", ["どろぼう"]],
      ["skill_084", ["攻撃分類・属性・対象"]], ["skill_085", ["攻撃分類・属性・対象"]],
      ["skill_086", ["攻撃分類・属性・対象"]], ["skill_087", ["攻撃分類・属性・対象"]]]));
  assert.equal(go.run('JSON.stringify(state.characters.filter((character) => geneOrderUI.fighterIssue(character, state)).map((character) => character.character_id))'),
    JSON.stringify([]));
  assert.equal(go.run('state.skills.has("basic_strike")'), false);
});

test("diagnoses unresolved move references and keeps passive placeholders separate", () => {
  assert.equal(go.run('state.dataDiagnostics.some((d) => d.level === "参照不一致" && ["burn", "speed_advantage"].includes(d.value))'), false);
  assert.equal(go.run('state.dataDiagnostics.some((d) => d.level === "参照不一致" && d.value === "どろぼう")'), true);
  assert.equal(go.run('state.skills.get("skill_001").effect1'), "bf_pa_down1");
  assert.equal(go.run('[...state.passives.values()].filter(p=>!'+JSON.stringify([...pendingPassiveIds,"passive_026","passive_029"])+'.includes(p.passive_id)).every(p=>p.status==="implemented")'),true);
  assert.deepEqual(JSON.parse(go.run('JSON.stringify([...state.passives.values()].filter(p=>p.issues.length).map(p=>[p.passive_id,p.status,p.issues.map(i=>[i.field,i.value])]))')), [["passive_026","partial",[["target_id3","all"]]],["passive_029","partial",[["target_id1","all"]]]]);
  assert.equal(go.run('state.dataDiagnostics.some((d) => d.level === "参照先未設定" && d.value === "passive_025")'), false);
  assert.equal(go.run('state.dataDiagnostics.filter((d) => d.level === "予約行" && d.id).length'), reservedMasters);
  assert.equal(go.run('state.dataDiagnostics.filter((d) => d.level === "ID未設定" && d.table === "characters").length'), 10);
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
  assert.equal(go.run('state.characters[0].imageSrc'), "./asset/character/character_001.png");
  assert.equal(go.run('state.characterMap.get("character_047").imageSrc'), "./asset/character/character_047.png");
  assert.equal(go.run('state.characters.filter((c) => c.imageSrc).length'), 45);
  assert.equal(go.run('state.dataDiagnostics.filter((d) => d.level === "画像欠落").length'), 1);
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

test("CSV-only next power definitions are read at runtime and validate their attribute and multiplier", async () => {
  const revised = runtime({ transforms: {
    "./data/battle_effect.csv": (csv) => csv + "\n" + [
      "test_custom,テスト,next_element_power,none,0,1,TRUE,none,none,0,,,thunder,2,,,,",
      "test_unknown,属性違い,next_element_power,none,0,1,TRUE,none,none,0,,,unknown,1.5,,,,",
      "test_zero,倍率違い,next_element_power,none,0,1,TRUE,none,none,0,,,none,0,,,,",
    ].join("\n"),
    "./data/skill.csv": (csv) => csv.replace("next_thunder_power_150", "test_custom"),
  } });
  await revised.boot();
  const scenario = `
    (() => {
      const go = geneOrderBattle;
      const fighter = state.characterMap.get("character_005");
      const battle = go.createBattle({ player: [fighter], enemy: [fighter], skills: state.skills,
        effects: state.effects, battleEffects: state.battleEffects, powerRules: state.powerRules, effectiveness: state.effectiveness });
      const selection = { player: { type: "move", moveId: "skill_020" }, enemy: { type: "wait" } };
      go.resolveTurn(battle, selection);
      return go.previewDamage(battle, "player", state.skills.get("skill_018")).power;
    })()
  `;
  assert.equal(go.run(scenario), 120);
  assert.equal(revised.run(scenario), 140);
  assert.equal(revised.run("state.dataDiagnostics.some((d) => d.id === \"test_unknown\" && d.field === \"element\" && d.level === \"参照不一致\")"), true);
  assert.equal(revised.run("state.dataDiagnostics.some((d) => d.id === \"test_zero\" && d.field === \"modifier\" && d.level === \"数値異常\")"), true);
  assert.equal(revised.run("geneOrderBattle.battleEffectKind(state.battleEffects.get(\"test_unknown\"))"), null);
  assert.equal(go.run("state.dataDiagnostics.some((d) => d.value === \"next_thunder_power_150\")"), false);
});

test("loads the current official skill balance adjustments from CSV", () => {
  const tuning = JSON.parse(go.run(`JSON.stringify([
    "skill_018", "skill_023", "skill_026", "skill_029", "skill_040", "skill_042", "skill_044", "skill_046", "skill_049", "skill_058"
  ].map((id) => {
    const skill = state.skills.get(id);
    return [id, skill.power, skill.cost, skill.priority, skill.power_rule, skill.power_cap,
      skill.effect1, skill.effect_chance1, skill.effect2, skill.effect_chance2, skill.battle_effect1, skill.text];
  }))`));
  assert.deepEqual(tuning, [
    ["skill_018", 80, 2, 0, "en_value", 140, "none", 0, "none", 0, "none", "ENが高い程威力が上がる。最大140。"],
    ["skill_023", 150, 5, 0, "", null, "bf_sp_down1", 100, "none", 0, "none", "相手のSPを1段階下げる。"],
    ["skill_026", 60, 1, 0, "", null, "bf_sp_down1", 100, "none", 0, "none", "相手のSPを1段階下げる。"],
    ["skill_029", 60, 1, 0, "", null, "bf_sd_down1", 100, "none", 0, "none", "相手のSDを1段階下げる。"],
    ["skill_040", 90, 2, 0, "en_value", 140, "none", 0, "none", 0, "none", "ENが高い程威力が上がる。最大140。"],
    ["skill_042", 0, 1, 0, "", null, "none", 0, "none", 0, "バトンタッチ", "交代する。ステータス変化、デコイ等を引き継ぐ。"],
    ["skill_044", 0, 0, 0, "", null, "bf_pa_up1", 100, "none", 0, "none", "PAが1段階上がる。"],
    ["skill_046", 100, 2, 0, "", null, "recoil_25", 100, "poison", 100, "none", "与ダメージの1/4のダメージを自分も受ける。相手を毒にする。"],
    ["skill_049", 90, 2, 0, "en_value", 140, "none", 0, "none", 0, "none", "ENが高い程威力が上がる。最大140。"],
    ["skill_058", 0, 3, 1, "", null, "none", 0, "none", 0, "bf_half_guard", "優先度+1。被ダメージを1/2にし、反撃する。"],
  ]);
});

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
  assert.deepEqual(JSON.parse(go.run(scenario)), [195, 35, 4, 100, 150]);
  assert.deepEqual(JSON.parse(updated.run(scenario)), [200, 70, 2, 50, 200]);
});

test("the HTTP loader re-reads decoy cost, durability, use cap, EN and proc rate", async () => {
  const revised = runtime({ transforms: {
    "./data/battle_effect.csv": (csv) => csv.replace("2/3,1/3,1", "1/3,1/2,2"),
    "./data/skill.csv": (csv) => csv.replace(",shed_tail,100,none,0,self,0,2,", ",shed_tail,50,none,0,self,0,1,"),
  } });
  await revised.boot();
  function simulate(environment, roll) {
    return JSON.parse(environment.run(`
      (() => {
        const b = geneOrderBattle.createBattle({
          player: [state.characterMap.get("character_001"), state.characterMap.get("character_015")],
          enemy: [state.characterMap.get("character_009")], skills: state.skills, effects: state.effects,
          battleEffects: state.battleEffects, powerRules: state.powerRules, effectiveness: state.effectiveness,
          random: () => ${roll},
        });
        const original = geneOrderBattle.activeFighter(b, "player");
        geneOrderBattle.changeEnergy(original, 6);
        geneOrderBattle.resolveTurn(b, { player: { type: "move", moveId: "skill_006", switchIndex: 1 }, enemy: { type: "wait" } });
        const decoy = geneOrderBattle.activeFighter(b, "player").decoy?.maxHp ?? 0;
        if (b.active.player === 1) {
          geneOrderBattle.resolveTurn(b, { player: { type: "switch", index: 0 }, enemy: { type: "wait" } });
        }
        const allowedAgain = geneOrderBattle.checkAction(b, "player", { type: "move", moveId: "skill_006" }) === "";
        return JSON.stringify([original.hp, decoy, original.energy, b.active.player, allowedAgain]);
      })()
    `));
  }
  assert.deepEqual(simulate(go, 0.9), [67, 41, 6, 0, false]);
  assert.deepEqual(simulate(revised, 0.4), [109, 62, 7, 0, true]);
  assert.deepEqual(simulate(revised, 0.5), [125, 0, 7, 0, true]);
});

test("the HTTP loader re-reads passive values and target attributes for new battles", async () => {
  const revised = runtime({ transforms: {
    "./data/passive.csv": (csv) => csv.replace("starting_en,none,4", "starting_en,none,3")
      .replace("turn_end_stat_stage,pa,1", "turn_end_stat_stage,pa,2")
      .replace("element_power_multiplier,neutral,1.2", "element_power_multiplier,neutral,1.3")
      .replace("element_immunity,water,1", "element_immunity,fire,1"),
  } });
  await revised.boot();
  const simulate = `
    (() => {
      const go = geneOrderBattle;
      const character = (id) => state.characterMap.get("character_" + id);
      const data = { passives: state.passives, skills: state.skills, effects: state.effects,
        battleEffects: state.battleEffects, powerRules: state.powerRules, effectiveness: state.effectiveness };
      const match = go.createBattle({ ...data, player: [character("005"), character("003")], enemy: [character("007")] });
      go.resolveTurn(match, { player: { type: "wait" }, enemy: { type: "wait" } });
      const second = go.createBattle({ ...data, player: [character("006")], enemy: [character("002")] });
      const neutral = state.skills.get("skill_023");
      const preview = (element) => go.previewDamage(second, "player", { ...neutral, element });
      return JSON.stringify([match.teams.player[1].energy, match.teams.player[0].stages.phy_atk, preview("none").power,
        preview("water").immunity?.element ?? "", preview("fire").immunity?.element ?? ""]);
    })()
  `;
  assert.deepEqual(JSON.parse(go.run(simulate)), [4, 1, 180, "water", ""]);
  assert.deepEqual(JSON.parse(revised.run(simulate)), [3, 2, 195, "", "fire"]);
});

test("the data loader diagnoses pending and partial passives using the same registry as battle", async () => {
  const revised = runtime({ transforms: {
    "./data/passive.csv": (csv) => csv
      .replace("starting_en,none,4,turn_end_stat_stage,sa,1", "starting_en,none,4,turn_end_stat_stage,unknown,1")
      .replace("on_evade_stat_stage,sa,1", "none,sa,1"),
  } });
  await revised.boot();
  assert.equal(revised.run('state.passives.get("passive_003").status'), "partial");
  assert.equal(revised.run('state.passives.get("passive_003").effects.length'), 1);
  assert.equal(revised.run('state.dataDiagnostics.some(d => d.id === "passive_003" && d.field === "target_id2" && d.level === "効果未対応")'), true);
  assert.equal(revised.run('state.passives.get("passive_023").status'), "pending");
  assert.equal(revised.run('state.dataDiagnostics.some(d => d.id === "passive_023" && d.level === "効果未設定")'), true);
  assert.equal(go.run('state.dataDiagnostics.filter(d => d.level === "効果未設定").length'), pendingPassiveIds.length);
  assert.deepEqual(JSON.parse(go.run('JSON.stringify(state.dataDiagnostics.filter(d => d.table === "passives" && d.level === "効果未対応").map(d=>[d.id,d.field,d.value]))')), [["passive_026","target_id3","all"],["passive_029","target_id1","all"]]);
});

test("the HTTP loader re-reads v0.41 thresholds, multipliers, priority HP costs and poison chance", async () => {
  const revised = runtime({ transforms: {
    "./data/passive.csv": (csv) => csv.replaceAll("self_hp_lte:1/2", "self_hp_lte:2/3")
      .replace("conditional_stat_multiplier,pa,1.2", "conditional_stat_multiplier,pa,1.4")
      .replace("opponent_hp_lte:1/3", "opponent_hp_lte:1/2")
      .replace("priority_move_hp_cost,hp,-0.1", "priority_move_hp_cost,hp,-0.2")
      .replace(/(passive_020,.*),1,,/, "$1,2,,")
      .replace("on_hit_inflict_status,poison,1", "on_hit_inflict_status,poison,0"),
  } });
  await revised.boot();
  const scenario = `
    (() => {
      const go = geneOrderBattle;
      const fighter = (id) => state.characterMap.get("character_" + id);
      const data = { passives: state.passives, skills: state.skills, effects: state.effects,
        battleEffects: state.battleEffects, powerRules: state.powerRules, effectiveness: state.effectiveness, random: () => 0 };
      const battle = (player, enemy) => go.createBattle({ ...data, player: [fighter(player)], enemy: [fighter(enemy)] });
      const active = (match, side = "player") => go.activeFighter(match, side);
      const actions = (match, id) => go.resolveTurn(match, { player: { type: "move", moveId: id }, enemy: { type: "wait" } });
      const burn = battle("017", "019");
      active(burn).hp = 100;
      const hunter = battle("018", "019");
      active(hunter, "enemy").hp = 120;
      const cost = battle("020", "019");
      go.changeEnergy(active(cost), 6);
      actions(cost, "skill_055");
      actions(cost, "skill_000");
      const toxic = battle("016", "022");
      go.changeEnergy(active(toxic), 6);
      actions(toxic, "skill_013");
      return JSON.stringify([go.statValue(active(burn), "phy_atk"), go.effectiveSpeed(hunter, "player"),
        active(cost).hp, active(toxic).statuses.length]);
    })()
  `;
  assert.deepEqual(JSON.parse(go.run(scenario)), [77, 96, 152, 1]);
  assert.deepEqual(JSON.parse(revised.run(scenario)), [107, 144, 137, 0]);
});

test("diagnoses invalid passive conditions and missing status targets", async () => {
  const invalid = runtime({ transforms: {
    "./data/passive.csv": (csv) => csv.replace("opponent_hp_lte:1/3", "opponent_hp_lte:1/0")
      .replace("on_hit_inflict_status,poison,1", "on_hit_inflict_status,unknown,1"),
  } });
  await invalid.boot();
  assert.equal(invalid.run('state.dataDiagnostics.some(d => d.id === "passive_018" && d.field === "condition1" && d.level === "効果未対応")'), true);
  assert.equal(invalid.run('state.dataDiagnostics.some(d => d.id === "passive_022" && d.field === "target_id1" && d.level === "効果未対応")'), true);
});

test("formal CSV has 27 playable passives and reports actionable numeric bounds", async () => {
  assert.equal(go.run('state.dataDiagnostics.filter(d => ["数値異常", "重複ID", "相性欠落", "相性重複"].includes(d.level)).length'), 0);
  assert.equal(go.run('state.dataDiagnostics.filter(d => d.level === "参照不一致").length'), 1);
  assert.equal(go.run('state.dataDiagnostics.filter(d => d.table === "passives" && d.level === "予約行").length'), reservedPassives);
  const invalid = runtime({ transforms: {
    "./data/character.csv": (text) => text.replace("獣族,125,81,75", "獣族,0,81.5,75"),
    "./data/skill.csv": (text) => patchCsv(text, "skill_id", "skill_001", { effect_chance1: 101, cost: 8 }),
    "./data/battle_effect.csv": (text) => text.replace("none,0,1,TRUE,none,none,50", "none,0,0,TRUE,none,none,101"),
    "./data/power_rule.csv": (text) => text.replace("go_en_value_7,en_value,7,7,1.5", "go_en_value_7,en_value,7,6,0"),
  } });
  await invalid.boot();
  const detected = JSON.parse(invalid.run('JSON.stringify(state.dataDiagnostics.filter(d => d.level === "数値異常").map(d => [d.id,d.field].join("/")).sort())'));
  assert.deepEqual(detected, ["bf_half_guard/damage_cut", "bf_half_guard/turn", "character_001/hp", "character_001/phy_atk",
    "go_en_value_7/max_ratio", "go_en_value_7/power_multiplier", "skill_001/cost", "skill_001/effect_chance1"]);
});

test("CSV edits change the speed multiplier and burn damage and duration in a new battle", async () => {
  const revised = runtime({ transforms: {
    "./data/power_rule.csv": (csv) => csv.replace("speed_advantage,0,100,0.5", "speed_advantage,0,100,0.6"),
    "./data/effect.csv": (csv) => csv.replace("burn,火やられ,damage,percent_maxhp,5,5", "burn,火やられ,damage,percent_maxhp,12,3"),
  } });
  await revised.boot();
  const result = revised.run(`
    (() => {
      const go = geneOrderBattle;
      const base = state.characters[0];
      const match = go.createBattle({
        player: [{ ...base, passive_id: null, speed: 80, skillIds: ["skill_015", "skill_038"] }],
        enemy: [{ ...base, passive_id: null, speed: 100, hp: 200, element_1: "earth", element_2: null }],
        skills: state.skills, effects: state.effects, battleEffects: state.battleEffects,
        powerRules: state.powerRules, effectiveness: state.effectiveness, random: () => 0,
      });
      const preview = go.previewDamage(match, "player", state.skills.get("skill_015"));
      const turn = go.resolveTurn(match, { player: { type: "move", moveId: "skill_038" }, enemy: { type: "wait" } });
      return JSON.stringify([preview.power, turn.events.find(e => e.type === "residual").damage,
        go.activeFighter(match, "enemy").statuses[0].turns]);
    })()
  `);
  assert.deepEqual(JSON.parse(result), [36, 24, 2]);
});

test("existing CSVs configure both bind moves, attack reference, and evasion timing", async () => {
  const revised = runtime({ transforms: {
    "./data/skill.csv": (csv) => csv.replace(/(^skill_033,.*),phy_def\r?$/m, "$1,sp_def"),
    "./data/effect.csv": (csv) => patchCsv(patchCsv(csv, "effect_id", "bind", { damage_value: 20, turn: 2 }), "effect_id", "evasion_up", { start_delay: 0 }),
  } });
  await revised.boot();
  const result = revised.run(`
    (() => {
      const go = geneOrderBattle;
      const base = state.characterMap.get("character_010");
      const make = (id) => go.createBattle({
        player: [{ ...base, passive_id: null, skillIds: [id] }],
        enemy: [{ ...base, passive_id: null, hp: 200 }, base],
        skills: state.skills, effects: state.effects, battleEffects: state.battleEffects,
        powerRules: state.powerRules, effectiveness: state.effectiveness, random: () => 0,
      });
      const cast = (match, id) => {
        go.changeEnergy(go.activeFighter(match, "player"), 6);
        return go.resolveTurn(match, { player: { type: "move", moveId: id }, enemy: { type: "wait" } });
      };
      const bind = ["skill_052", "skill_059"].map(id => {
        const match = make(id);
        const turn = cast(match, id);
        const blocked = go.checkAction(match, "enemy", { type: "switch", index: 1 });
        return [turn.events.find(e => e.type === "residual").damage,
          go.activeFighter(match, "enemy").bind.turns, Boolean(blocked)];
      });
      const shell = make("skill_033");
      const ref = go.previewDamage(shell, "player", state.skills.get("skill_033")).attack;
      const evade = make("skill_034");
      const starts = cast(evade, "skill_034").events.find(e => e.type === "evasion-boost").starts;
      return JSON.stringify([bind, ref, starts]);
    })()
  `);
  assert.deepEqual(JSON.parse(result), [[[40, 1, true], [40, 1, true]], 88, 1]);
});

test("all 60 rank effects can be assigned by short ID and change the correct rank", () => {
  assert.equal(go.run(`
    (() => {
      const engine = geneOrderBattle;
      const base = state.characters[0];
      const names = masterIdLookup([...state.elements.values()], "element_id");
      let checked = 0;
      for (const [prefix, stat] of [["pa", "phy_atk"], ["pd", "phy_def"], ["sa", "sp_atk"], ["sd", "sp_def"], ["sp", "speed"]]) {
        for (const dir of ["down", "up"]) {
          for (let amount = 1; amount <= 6; amount++) {
            const short = prefix + "_" + dir + amount;
            const move = normalizeSkill({ skill_id: "fixture", name: "ランク検証", category: "status",
              element: "none", cost: "0", priority: "0",
              effect1: short, effect_chance1: "100", effect_target1: "self" }, names);
            if (move.effect1 !== "bf_" + short) throw new Error(short + " alias");
            const battle = engine.createBattle({
              player: [{ ...base, skillIds: ["fixture"] }], enemy: [base],
              skills: new Map([["fixture", move]]), effects: state.effects, effectiveness: state.effectiveness,
            });
            engine.resolveTurn(battle, { player: { type: "move", moveId: "fixture" }, enemy: { type: "wait" } });
            const rank = engine.activeFighter(battle, "player").stages[stat];
            if (rank !== (dir === "down" ? -amount : amount)) throw new Error(short + " rank " + rank);
            checked++;
          }
        }
      }
      return checked;
    })()
  `), 60);
});

test("new CSV status and evasion IDs work in other moves without adding JS registrations", async () => {
  const configured = runtime({ transforms: {
    "./data/effect.csv": (csv) => csv.trimEnd() + "\nfixture_residual,検証用継続,damage,percent_maxhp,12,2,TRUE,none,,\n" +
      "fixture_evasion,検証用回避,evasion,multiplier,1.5,2,TRUE,evasion_percent,,2\n",
    "./data/skill.csv": (csv) => csv.replace(/^skill_021,.*$/m, (row) =>
      row.replace(/,pa_up[12],self,100,pd_up[12],self,100,/, ",fixture_residual,enemy,100,fixture_evasion,self,100,")),
  } });
  await configured.boot();
  const result = configured.run(`
    (() => {
      const engine = geneOrderBattle;
      const base = state.characters[0];
      const battle = engine.createBattle({
        player: [{ ...base, evasion_percent: 40, skillIds: ["skill_021"] }],
        enemy: [{ ...base, hp: 200 }], skills: state.skills, effects: state.effects, effectiveness: state.effectiveness,
      });
      const wait = { type: "wait" };
      const first = engine.resolveTurn(battle, { player: { type: "move", moveId: "skill_021" }, enemy: wait });
      const player = engine.activeFighter(battle, "player");
      const rates = [engine.evasionRate(player, battle.turn)];
      const damage = [first.events.find(e => e.type === "residual").damage];
      for (let i = 0; i < 3; i++) {
        const turn = engine.resolveTurn(battle, { player: wait, enemy: wait });
        rates.push(engine.evasionRate(player, battle.turn));
        damage.push(turn.events.find(e => e.type === "residual")?.damage ?? 0);
      }
      const boost = first.events.find(e => e.type === "evasion-boost");
      return JSON.stringify([rates, damage, describeGeneOrderEvent(boost)]);
    })()
  `);
  const [rates, damage, log] = JSON.parse(result);
  assert.deepEqual(rates, [40, 60, 60, 40]);
  assert.deepEqual(damage, [24, 24, 0, 0]);
  assert.match(log, /2ターン後から2ターン、1\.5倍/);
});

test("Drumming Beat keeps its CSV stage gains without triggering the attack-only Full Commitment penalty", async () => {
  const configured = runtime({ transforms: {
    "./data/skill.csv": (csv) => csv.replace(/^skill_021,.*$/m, (row) =>
      row.replace(/,pa_up[12],self,100,pd_up[12],self,100,/, ",pa_up1,self,100,pd_up2,self,100,")),
  } });
  await configured.boot();
  const result = configured.run(`
    (() => {
      const engine = geneOrderBattle;
      const move = state.skills.get("skill_021");
      const battle = engine.createBattle({
        player: [state.characterMap.get("character_006")], enemy: [state.characters[0]],
        skills: state.skills, effects: state.effects, passives: state.passives,
        effectiveness: state.effectiveness, random: () => 0,
      });
      const turn = engine.resolveTurn(battle, { player: { type: "move", moveId: move.skill_id }, enemy: { type: "wait" } });
      const fighter = engine.activeFighter(battle, "player");
      return JSON.stringify([move.effect2, fighter.stages.phy_atk, fighter.stages.phy_def,
        turn.events.filter(e => e.type === "stage").map(e => [e.stat, e.delta])]);
    })()
  `);
  assert.deepEqual(JSON.parse(result), ["bf_pd_up2", 1, 2, [["phy_atk", 1], ["phy_def", 2]]]);
});

test("an invalid CSV attack stat is diagnosed and blocks the move", async () => {
  const invalid = runtime({ transforms: {
    "./data/skill.csv": (csv) => csv.replace(/(^skill_033,.*),phy_def\r?$/m, "$1,hp"),
  } });
  await invalid.boot();
  assert.equal(invalid.run('state.dataDiagnostics.some(d => d.id === "skill_033" && d.field === "attack_stat")'), true);
  assert.match(invalid.run('geneOrderBattle.unsupportedMoveReason(state.skills.get("skill_033"), state)'), /攻撃参照能力 hp/);
});

test("a three-slot fixture from the CSV response works with no new JavaScript handler", async () => {
  const run = async (boost) => {
    const fixture = runtime({ transforms: {
      "./data/character.csv": (text) => text.replace("passive_003,", "passive_test,"),
      "./data/passive.csv": (text) => text.trimEnd() + "\n" + [
        "passive_test", "検証用", "starting_en", "none", "3", "turn_end_stat_stage", "pd", "1",
        "element_power_multiplier", "fire", boost, "3効果の検証", "none", "none", "none", "", "", "",
      ].join(",") + "\n",
    } });
    await fixture.boot();
    return JSON.parse(fixture.run(`
      (() => {
        const battle = geneOrderBattle.createBattle({ player: [state.characterMap.get("character_003")],
          enemy: [state.characterMap.get("character_001")], skills: state.skills, passives: state.passives,
          effects: state.effects, battleEffects: state.battleEffects, powerRules: state.powerRules, effectiveness: state.effectiveness });
        const active = geneOrderBattle.activeFighter(battle, "player");
        const valid = geneOrderBattle.checkAction(battle, "player", { type: "move", moveId: "skill_009" });
        const move = [...state.skills.values()].find((entry) => entry.category === "attack" && entry.element === "fire" &&
          geneOrderBattle.moveAvailability(entry, battle).issues.length === 0);
        const target = geneOrderBattle.activeFighter(battle, "enemy");
        const live = geneOrderBattle.calculateDamage(active, target, move, battle.effectiveness);
        const base = geneOrderBattle.calculateDamage({ ...active, passiveEffects: [] }, target, move, battle.effectiveness);
        const result = geneOrderBattle.resolveTurn(battle, { player: { type: "wait" }, enemy: { type: "wait" } });
        return JSON.stringify([battle.startEvents[0].energy, active.stages.phy_def, active.passive.status, valid,
          live.power, base.power, result.events.some(event => event.phase === "turn-end")]);
      })()
    `));
  };
  for (const multiplier of [1.2, 1.3]) {
    const [energy, stage, implementation, legal, boosted, base, logged] = await run(multiplier);
    assert.deepEqual([energy, stage, implementation, legal, logged], [3, 1, "implemented", "", true]);
    assert.equal(boosted, Math.round(base * multiplier));
  }
});

test("AI CSV preferences diagnose unknown profiles and unlearned skills without changing fallback", async () => {
  const synthetic = runtime({ transforms: {
    "./data/character.csv": (csv) => csv.replace("1,,,,passive_001,", "1,unknown,skill_013,skill_001,passive_001,"),
  } });
  await synthetic.boot();
  assert.equal(synthetic.run('state.dataDiagnostics.some(d => d.level === "AIタイプ未対応" && d.id === "character_001")'), true);
  assert.equal(synthetic.run('state.dataDiagnostics.some(d => d.level === "AI指定技未習得" && d.field === "ai_setup_skill")'), true);
  assert.equal(synthetic.run('enemyAiTypeFor({base: state.characterMap.get("character_001")})'), "balanced");
});

const formalMatch = (mode = "manual") => `
  geneOrderUI.createMatch(state, {
    team: { player: ["character_016", "character_015", "character_019"], enemy: ["character_009", "character_005"] },
    lead: { player: "character_015", enemy: "character_009" }, mode: "${mode}"
  }, { random: () => 0.1, aiRoll: () => 0 })
`;

test("random battle draws three distinct usable fighters per side and leads with the minimum slot", () => {
  assert.equal(go.run(`(() => {
    for (let seed = 1; seed <= 100; seed++) {
      let value = seed;
      const random = () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 4294967296);
      const settings = geneOrderUI.randomBattleSettings(state, random);
      if (settings.mode !== "enemy") return false;
      const match = geneOrderUI.createMatch(state, settings, { random: () => 0, aiRoll: () => 0 });
      if (match.isAI("player") || !match.isAI("enemy")) return false;
      for (const side of ["player", "enemy"]) {
        const ids = settings.team[side];
        if (ids.length !== 3 || new Set(ids).size !== 3) return false;
        const selected = ids.map((id) => state.characterMap.get(id));
        if (selected.some((base) => geneOrderUI.fighterIssue(base, state))) return false;
        const minimum = Math.min(...selected.map((base) => base.slot));
        if (state.characterMap.get(settings.lead[side]).slot !== minimum) return false;
        if (match.battle.teams[side][0].base.slot !== minimum) return false;
      }
    }
    return true;
  })()`), true);
});

test("random battle excludes placeholders and invalid slots, preserves data and handles ties", () => {
  const scenario = `(() => {
    const bases = ["001", "002", "003"].map((id) => state.characterMap.get("character_" + id));
    const characters = bases.map((base) => ({ ...base, slot: 2 }));
    const data = { ...state, characters: characters.concat(
      { ...bases[0], character_id: "blank", name: "" },
      { ...bases[0], character_id: "bad-slot", slot: -1 },
      { ...bases[0], character_id: "unready", skillIds: [] }, characters[0]) };
    const before = JSON.stringify(data.characters);
    const selected = geneOrderUI.randomBattleSettings(data, () => 0);
    return JSON.stringify([selected.team.player, selected.team.enemy, selected.lead, before === JSON.stringify(data.characters)]);
  })()`;
  const [player, enemy, lead, unchanged] = JSON.parse(go.run(scenario));
  assert.deepEqual(player, ["character_001", "character_002", "character_003"]);
  assert.deepEqual(enemy, player);
  assert.deepEqual(lead, { player: "character_001", enemy: "character_001" });
  assert.equal(unchanged, true);
  assert.throws(() => go.run('geneOrderUI.randomBattleSettings({ ...state, characters: state.characters.slice(0, 2) })'), /3体以上/);
  for (const invalid of ["1", "-0.1", "NaN", "Infinity"]) {
    assert.throws(() => go.run(`geneOrderUI.randomBattleSettings(state, () => ${invalid})`), /乱数/);
  }
  assert.equal(go.run('geneOrderUI.randomBattleSettings(state, () => 0.999999).team.player.length'), 3);
});

test("official UI accepts newly configured fighters and rejects invalid, duplicate and oversized teams", () => {
  assert.equal(go.run('geneOrderUI.fighterIssue(state.characterMap.get("character_047"), state)'), "");
  assert.equal(go.run('geneOrderUI.fighterIssue(state.characterMap.get("character_005"), state)'), "");
  assert.equal(go.run(`(${formalMatch()}).battle.teams.player[0].base.name`), "ユーズドマウス");
  assert.throws(() => go.run(formalMatch().replace('"character_016", "character_015", "character_019"', "")), /先発/);
  assert.throws(() => go.run(formalMatch().replace('"character_016"', '"character_015"')), /先発/);
  assert.throws(() => go.run(formalMatch().replace("random: ()", "limit: 2, random: ()")), /1〜2体/);
  assert.equal(go.run(`(${formalMatch().replace('"character_016"', '"character_047"')}).battle.teams.player[1].base.name`), "K-12");
});

test("official match maps manual versus AI through GO and records display frames without legacy state", () => {
  const priorCalls = go.storageCalls.length;
  const actual = JSON.parse(go.run(`
    (() => {
      const match = ${formalMatch("enemy")};
      const battle = match.battle;
      const act = { type: "move", moveId: "skill_000" };
      const result = match.resolve({ player: act, enemy: { type: "unknown" } });
      return JSON.stringify([match.isAI("player"), match.isAI("enemy"), result.frames.length === result.events.length,
        result.events.some(e => e.type === "dodge-attempt"), result.events.some(e => e.side === "enemy"), battle.turn,
        state.playerTeam.length, state.enemyTeam.length]);
    })()
  `));
  assert.deepEqual(actual, [false, true, true, true, true, 2, 0, 0]);
  assert.equal(go.storageCalls.length, priorCalls);
});

test("official match presents decoy, Relay, entry passive and rejects duplicate continuation", () => {
  const actual = JSON.parse(go.run(`
    (() => {
      const match = ${formalMatch()};
      const battle = match.battle;
      const wait = { type: "wait" };
      const turn = (moveId) => match.resolve({ player: moveId ? { type: "move", moveId } : wait, enemy: wait });
      turn();
      const decoy = turn("skill_041");
      const created = decoy.frames[decoy.events.findIndex(e => e.type === "decoy-created")].teams.player[0].decoy.hp;
      const pending = turn("skill_042");
      const before = battle.teams.player[0].energy;
      let blocked = false, invalid = false, repeated = false;
      try { turn(); } catch { blocked = true; }
      try { match.resume(0); } catch { invalid = true; }
      const result = match.resume(1);
      try { match.resume(1); } catch { repeated = true; }
      const beforeDamage = result.frames.find((_, i) => result.events[i].type === "switch");
      return JSON.stringify([created, pending.pendingSwitch.reason, blocked, invalid, repeated, before,
        battle.teams.player[0].energy, beforeDamage.teams.player[1].decoy.hp, battle.teams.player[1].decoy.hp,
        result.events.filter(e => e.phase === "entry").length, battle.turn]);
    })()
  `));
  assert.deepEqual(actual, [72, "relay", true, true, true, 1, 0, 72, 72, 1, 4]);
});

test("official match captures poison and HP0 before resuming a replacement, then supports replay", () => {
  const actual = JSON.parse(go.run(`
    (() => {
      const make = () => ${formalMatch()};
      const match = make();
      const battle = match.battle;
      const wait = { type: "wait" };
      match.resolve({ player: { type: "switch", index: 1 }, enemy: wait });
      const poison = { type: "move", moveId: "skill_046" };
      const afflicted = match.resolve({ player: poison, enemy: wait });
      const statusIndex = afflicted.events.findIndex(e => e.type === "status-applied");
      const atApplication = afflicted.frames[statusIndex].teams.enemy[0].statuses[0].turns;
      const after = battle.teams.enemy[0].statuses[0].turns;
      let turn;
      for (let i = 0; i < 15 && !battle.pendingSwitch; i++) {
        const choice = geneOrderBattle.checkAction(battle, "player", poison) ? wait : poison;
        turn = match.resolve({ player: choice, enemy: wait });
      }
      const faint = turn.events.findIndex(e => e.type === "faint");
      const atFaint = turn.frames[faint].teams.enemy[0].hp;
      const replacement = match.resume(1);
      for (let i = 0; i < 15 && !battle.winner; i++) {
        const choice = geneOrderBattle.checkAction(battle, "player", poison) ? wait : poison;
        match.resolve({ player: choice, enemy: wait });
      }
      let blocked = false;
      try { match.resolve({ player: wait, enemy: wait }); } catch { blocked = true; }
      const replay = make().battle;
      return JSON.stringify([atApplication, after, atFaint, replacement.events.some(e => e.type === "replacement"),
        battle.winner, blocked, replay.turn, replay.winner, replay.teams.enemy[0].hp]);
    })()
  `));
  assert.deepEqual(actual, [5, 4, 0, true, "player", true, 1, null, 146]);
});


test("playback timing preserves the current configured reading time for each visible event", () => {
  const timing = go.run("geneOrderUI.PLAYBACK_TIMING");
  assert.equal(Object.isFrozen(timing), true);
  assert.equal(timing.moveName, 500);
  assert.equal(timing.hpGauge, 750);
  for (const [type, minimum] of [["move", 1000], ["stage", 1000], ["passive", 1000],
    ["status-applied", 1000], ["residual", 1000], ["faint", 1000], ["switch", 1000],
    ["replacement", 1000], ["energy", 750], ["charge", 1500]]) {
    assert.ok(go.run(`geneOrderUI.eventHold({ type: "${type}", category: "attack" })`) >= minimum, type);
  }
  assert.ok(timing.damage >= timing.hpGauge);
});

test("GO stat graphs use base scores against 200 while displaying actual stats", () => {
  const stats = ["hp", "phy_atk", "phy_def", "sp_atk", "sp_def", "speed"];
  for (const key of stats) {
    const offset = key === "hp" ? 75 : 20;
    const max = 200 + offset;
    const markup = go.run(`goCharacterStat("${key}", ${max})`);
    assert.match(markup, /--bar-width: 100%/);
    assert.match(go.run(`goCharacterStat("${key}", ${100 + offset})`), /--bar-width: 50%/);
    assert.match(go.run(`goCharacterStat("${key}", ${offset})`), /--bar-width: 0%/);
    assert.match(go.run(`goCharacterStat("${key}", ${offset - 1})`), /--bar-width: 0%/);
    assert.match(go.run(`goCharacterStat("${key}", ${max + 20})`), /--bar-width: 100%/);
  }
  assert.match(go.run('goCharacterStat("regen_value", 25)'), /--bar-width: 50%/);
  assert.match(go.run('goCharacterStat("regen_value", 50)'), /--bar-width: 100%/);
  assert.match(go.run('goCharacterStat("hp", 300)'), />300<\/strong>/);
  assert.match(go.run('goCharacterStat("regen_value", 25)'), /回復力/);
  assert.match(go.run('goCharacterStat("hp", 125)'), /--bar-width: 25%/);
  assert.match(go.run('goCharacterStat("phy_atk", 81)'), /--bar-width: 31%/);
  assert.equal(go.run('goStatText("HPとPA・PD・SA・SD・SP")'), "体力と物理攻撃・物理防御・特殊攻撃・特殊防御・敏捷");
  assert.equal(go.run('state.characterMap.get("character_001").regen_value'), 25);
});


test("GO stat grades use the specified inclusive boundaries and base stat offsets", () => {
  const bounds = [
    [20, "G", "#A855F7"], [21, "F", "#35CFFF"], [40, "F", "#35CFFF"],
    [41, "E", "#9ACD32"], [60, "E", "#9ACD32"], [61, "D", "#FFFF00"],
    [80, "D", "#FFFF00"], [81, "C", "#FFA500"], [100, "C", "#FFA500"],
    [101, "B", "#FF0000"], [120, "B", "#FF0000"], [121, "A", "#FF69B4"],
    [140, "A", "#FF69B4"], [141, "S", "#F7B9D4"],
  ];
  for (const [stat, offset] of [["hp", 75], ...["phy_atk", "phy_def", "sp_atk", "sp_def", "speed"].map(stat => [stat, 20])]) {
    for (const [score, letter, color] of bounds) {
      const { letter: actualLetter, color: actualColor } = go.run(`goStatRank("${stat}", ${score + offset})`);
      assert.deepEqual([actualLetter, actualColor], [letter, color], `${stat}, score ${score}`);
    }
  }
  assert.equal(go.run('goStatRank("regen_value", 200)'), null);
  const chai = go.run('goCharacterStat("hp", state.characterMap.get("character_001").hp)');
  assert.match(chai, /種族値ランク E.*#9ACD32.*>E<\/span>/);
  const chaiAttack = go.run('goCharacterStat("phy_atk", state.characterMap.get("character_001").phy_atk)');
  assert.match(chaiAttack, /種族値ランク D.*#FFFF00.*>D<\/span>/);
  assert.doesNotMatch(go.run('goCharacterStat("regen_value", 25)'), /detail-stat-grade"/);
});

test("GO matchup chart renders all official CSV multipliers and shared attribute icons", () => {
  const html = go.run("goAttributeChart(state)");
  assert.equal((html.match(/data-attack=/g) || []).length, 81);
  assert.equal((html.match(/class="go-attribute-icon /g) || []).length, 18);
  assert.match(html, /BattleFactory_属性相性表_9属性[.]png/);
  assert.match(html, /data-attack="ice" data-defense="thunder" aria-label="2倍">○/);
  assert.match(html, /data-attack="earth" data-defense="wind" aria-label="0倍">×/);
  assert.match(html, /data-attack="fire" data-defense="none" aria-label="2倍">○/);
  assert.match(html, /data-attack="water" data-defense="dark" aria-label="0.5倍">△/);
});


test("move card matchups use all 81 CSV pairs without STAB or guard adjustments", () => {
  const result = JSON.parse(go.run(`(() => {
    const defender = geneOrderBattle.createBattle({ ...state,
      player: [state.characterMap.get("character_001")], enemy: [state.characterMap.get("character_001")] }).teams.enemy[0];
    defender.passive = null;
    defender.halfGuard = 100;
    const move = { ...state.skills.get("skill_002"), category: "attack", battle_effect1: "none", battle_effect2: "none", battle_effect3: "none" };
    const pairs = [];
    for (const attack of state.elements.keys()) for (const defense of state.elements.keys()) {
      defender.base = { ...defender.base, element_1: defense, element_2: null };
      const info = geneOrderUI.moveMatchup({ ...move, element: attack }, defender, state);
      pairs.push([info.multiplier, state.effectiveness.get(attack).get(defense), info.passiveImmune]);
    }
    return JSON.stringify(pairs);
  })()`));
  assert.equal(result.length, 81);
  for (const [actual, expected, immune] of result) {
    assert.equal(actual, expected);
    assert.equal(immune, false);
  }
});

test("move card matchups multiply dual types, preserve zero, and omit status skills", () => {
  const result = JSON.parse(go.run(`(() => {
    const defender = { base: { element_1: "thunder", element_2: "wind" }, passive: null };
    const move = { ...state.skills.get("skill_002"), category: "attack", element: "ice" };
    const dual = geneOrderUI.moveMatchup(move, defender, state).multiplier;
    const zero = geneOrderUI.moveMatchup({ ...move, element: "earth" }, defender, state).multiplier;
    const status = geneOrderUI.moveMatchup({ ...move, category: "status" }, defender, state);
    defender.base.element_2 = "thunder";
    const duplicate = geneOrderUI.moveMatchup(move, defender, state).multiplier;
    return JSON.stringify([dual, zero, status, duplicate]);
  })()`));
  assert.deepEqual(result, [4, 0, null, 2]);
});

test("move card passive immunity is separate and inspection does not mutate battle or consume RNG", () => {
  const result = JSON.parse(go.run(`(() => {
    let calls = 0;
    const base = { ...state.characterMap.get("character_001"), passive_id: "passive_002" };
    const battle = geneOrderBattle.createBattle({ ...state, player: [base], enemy: [base], random: () => { calls++; return .5; } });
    const defender = geneOrderBattle.activeFighter(battle, "enemy");
    const before = JSON.stringify(battle);
    const move = { ...state.skills.get("skill_002"), category: "attack" };
    const water = geneOrderUI.moveMatchup({ ...move, element: "water" }, defender, state);
    const none = geneOrderUI.moveMatchup({ ...move, element: "none" }, defender, state);
    return JSON.stringify([water.passiveImmune, none.passiveImmune, before === JSON.stringify(battle), calls]);
  })()`));
  assert.deepEqual(result, [true, false, true, 0]);
});


test("MHB-style random BGM includes all 26 copied battle tracks and excludes non-battle or unset paths", async () => {
  const local = runtime();
  await local.boot();
  const result = JSON.parse(local.run(`(() => {
    registerGoBattleBgm(state.bgmMap);
    state.bgmMap.set("title", { bgm_id: "title", name: "title", bgm_path: "./title.mp3" });
    state.bgmMap.set("empty", { bgm_id: "empty", name: "arena_empty", bgm_path: "" });
    const tracks = GO_BATTLE_BGM_TRACKS.map((name, index) => {
      const id = randomBattleModeBgmId(() => (index + .5) / GO_BATTLE_BGM_TRACKS.length);
      return [id, state.bgmMap.get(id).bgm_path, "go_" + name];
    });
    const last = randomBattleModeBgmId(() => 1 - Number.EPSILON);
    state.bgmMap.clear();
    return JSON.stringify([tracks, last, randomBattleModeBgmId(() => 0)]);
  })()`));
  assert.equal(result[0].length, 26);
  assert.equal(new Set(result[0].map(([id]) => id)).size, 26);
  for (const [id, path, expected] of result[0]) {
    assert.equal(id, expected);
    assert.ok(existsSync(join(root, path)), path);
  }
  assert.equal(result[1], "go_arena_x_1");
  assert.equal(result[2], "");
});


test("selected player party gets three distinct random AI opponents with minimum-slot leads", () => {
  assert.equal(go.run(`(() => {
    const ids = Object.freeze(["character_016", "character_015", "character_019"]);
    const before = JSON.stringify(state.characters);
    for (let seed = 1; seed <= 100; seed++) {
      let value = seed;
      const random = () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 4294967296);
      const settings = geneOrderUI.randomOpponentSettings(state, ids, random);
      if (JSON.stringify(settings.team.player) !== JSON.stringify(ids) || settings.team.player === ids) return false;
      if (settings.mode !== "enemy" || settings.team.enemy.length !== 3 || new Set(settings.team.enemy).size !== 3) return false;
      if (settings.team.enemy.some(id => ids.includes(id) || geneOrderUI.fighterIssue(state.characterMap.get(id), state))) return false;
      const match = geneOrderUI.createMatch(state, settings, { random: () => .1, aiRoll: () => 0 });
      if (match.isAI("player") || !match.isAI("enemy")) return false;
      if (seed === 1) {
        const result = match.resolve({ player: { type: "wait" } });
        if (!result.events.some(event => event.side === "enemy" && ["move", "wait", "charge", "switch"].includes(event.type))) return false;
      }
      for (const side of ["player", "enemy"]) {
        const minimum = Math.min(...settings.team[side].map(id => state.characterMap.get(id).slot));
        if (match.battle.teams[side][0].base.slot !== minimum) return false;
      }
    }
    return before === JSON.stringify(state.characters);
  })()`), true);
});

test("random opponent selection rejects incomplete, duplicate and placeholder player parties before drawing", () => {
  for (const ids of [[], ["character_001"], ["character_001", "character_002"],
    ["character_001", "character_002", "character_003", "character_004"],
    ["character_001", "character_001", "character_003"], ["character_001", "character_002", "character_045"],
    ["character_001", "character_002", "unknown"]]) {
    assert.throws(() => go.run('geneOrderUI.randomOpponentSettings(state, ' + JSON.stringify(ids) +
      ', () => { throw new Error("draw must not happen"); })'), /3体/);
  }
  for (const invalid of ["1", "-1", "NaN", "Infinity"]) {
    assert.throws(() => go.run('geneOrderUI.randomOpponentSettings(state, ["character_001", "character_002", "character_003"], () => ' + invalid + ')'), /乱数/);
  }
});

test("random opponents fall back to the usable roster when fewer than three non-player fighters exist", () => {
  const value = JSON.parse(go.run(`(() => {
    const ids = ["character_001", "character_002", "character_003"];
    const characters = ids.map(id => ({ ...state.characterMap.get(id), slot: 2 }));
    const data = { ...state, characters, characterMap: new Map(characters.map(base => [base.character_id, base])) };
    const picked = geneOrderUI.randomOpponentSettings(data, ids, () => 0);
    return JSON.stringify([picked.team.enemy, picked.lead]);
  })()`));
  assert.deepEqual(value, [["character_001", "character_002", "character_003"], { player: "character_001", enemy: "character_001" }]);
});

test("saved random-opponent settings replay both parties without carrying HP or passive state", () => {
  const value = JSON.parse(go.run(`(() => {
    const settings = geneOrderUI.randomOpponentSettings(state, ["character_016", "character_015", "character_019"], () => .1);
    const before = JSON.stringify(settings);
    const first = geneOrderUI.createMatch(state, settings, { random: () => .1, aiRoll: () => 0 });
    first.battle.teams.player[0].hp = 1;
    first.battle.teams.enemy[0].hp = 0;
    const replay = geneOrderUI.createMatch(state, settings, { random: () => .1, aiRoll: () => 0 });
    return JSON.stringify([before === JSON.stringify(settings), replay.battle.teams.player[0].hp === replay.battle.teams.player[0].maxHp,
      replay.battle.teams.enemy[0].hp === replay.battle.teams.enemy[0].maxHp, replay.battle.turn]);
  })()`));
  assert.deepEqual(value, [true, true, true, 1]);
});


test("dodge outcome and defense expiry notifications are silent without hiding actions or other expiries", () => {
  const result = JSON.parse(go.run(`(() => {
    const silent = [
      { type: "dodge-attempt", actor: "test", chance: 50, success: true },
      { type: "dodge-attempt", actor: "test", chance: 50, success: false },
      { type: "evaded", actor: "test", move: "attack" },
      { type: "defense-expired", actor: "test", dodge: true, guard: 50 },
      ...[...state.battleEffects.values()].filter(d => geneOrderBattle.battleEffectKind(d) === "dodge" || Number(d.damage_cut) > 0)
        .flatMap(d => ["effect-expired", "field-expired"].map(type => ({ type, actor: "test", side: "player", name: d.name }))),
      { type: "effect-expired", actor: "test", name: state.effects.get("evasion_up").name },
    ];
    const before = JSON.stringify(silent);
    const quiet = silent.every(event => describeGeneOrderEvent(event) === "");
    const action = describeGeneOrderEvent({ type: "move", actor: "test", move: "回避", moveId: "skill_000", category: "status", cost: 0 });
    const guardStart = describeGeneOrderEvent({ type: "half-guard", actor: "test" });
    const poisonEnd = describeGeneOrderEvent({ type: "effect-expired", actor: "test", name: state.effects.get("poison").name });
    const windEnd = describeGeneOrderEvent({ type: "field-expired", side: "player", name: "追い風" });
    const unknownEnd = describeGeneOrderEvent({ type: "effect-expired", actor: "test", name: "未登録効果" });
    return JSON.stringify([quiet, before === JSON.stringify(silent), action, guardStart, poisonEnd, windEnd, unknownEnd]);
  })()`));
  assert.deepEqual(result.slice(0, 2), [true, true]);
  assert.match(result[2], /回避/);
  assert.match(result[3], /半減/);
  assert.match(result[4], /毒.*終了/);
  assert.match(result[5], /追い風.*終了/);
  assert.match(result[6], /未登録効果.*終了/);
});

// Test fixtures address columns by name so optional CSV columns cannot shift edits.
function patchCsv(text, key, id, patch) {
  const headers = text.split(/\r?\n/, 1)[0].replace(/^\uFEFF/, '').split(',');
  const rows = go.run('rowsFromCsv')(text);
  const target = rows.find(row => row[key] === id);
  assert.ok(target, id);
  for (const column of Object.keys(patch)) assert.ok(headers.includes(column), column);
  Object.assign(target, patch);
  const cell = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
  return headers.join(',') + '\n' + rows.map(row => headers.map(column => cell(row[column])).join(',')).join('\n');
}

test('status CSV normalizes all three new columns and diagnoses no unsupported paralysis or frostbite', () => {
  for (const [id, stat, multiplier, failure] of [['poison','none',1,0],['burn','phy_atk',.5,0],['paralysis','speed',.5,25],['frostbite','sp_atk',.5,0]]) {
    const row = go.run('state.effects.get(' + JSON.stringify(id) + ')');
    assert.equal(row.stat_modifier_target, stat);assert.equal(row.stat_modifier_multiplier,multiplier);assert.equal(row.action_failure_chance,failure);
    assert.equal(go.run('state.dataDiagnostics.some(d => d.table === "effects" && d.id === ' + JSON.stringify(id) + ' && ["数値異常", "効果未対応", "参照不一致"].includes(d.level))'),false);
  }
});

test('status CSV validation rejects invalid targets, multipliers and action failure percentages', async () => {
  for (const [patch, field] of [[{stat_modifier_target:'hp'},'stat_modifier_target'],[{stat_modifier_multiplier:0},'stat_modifier_multiplier'],
    [{stat_modifier_multiplier:-1},'stat_modifier_multiplier'],[{stat_modifier_multiplier:'NaN'},'stat_modifier_multiplier'],
    [{action_failure_chance:-1},'action_failure_chance'],[{action_failure_chance:101},'action_failure_chance'],
    [{action_failure_chance:'invalid'},'action_failure_chance'],[{stat_modifier_target:'none',stat_modifier_multiplier:.5},'stat_modifier_target']]) {
    const r=runtime({transforms:{'./data/effect.csv':text=>patchCsv(text,'effect_id','paralysis',patch)}});await r.boot();
    assert.equal(r.run('state.dataDiagnostics.some(d => d.table === "effects" && d.id === "paralysis" && d.field === ' + JSON.stringify(field) + ')'),true,JSON.stringify(patch));
    assert.equal(r.run('geneOrderBattle.effectKind(state.effects.get("paralysis"))'),null);
  }
});

test('status performance changes by reloading test CSV without editing JavaScript', async () => {
  const r=runtime({transforms:{'./data/effect.csv':text=>patchCsv(patchCsv(text,'effect_id','burn',{damage_value:7,turn:3,stat_modifier_multiplier:.25}),
    'effect_id','paralysis',{stat_modifier_multiplier:.75,action_failure_chance:50})}});await r.boot();
  const scenario=`(() => {
    const g=geneOrderBattle, base={...state.characterMap.get("character_001"),hp:200,phy_atk:120,speed:120,regen_value:0,energy_charge:0,passive_id:null};
    const b=g.createBattle({...state,player:[base],enemy:[base]});const f=g.activeFighter(b,"player");
    for(const id of ["burn","paralysis"])f.statuses.push({definition:state.effects.get(id),turns:state.effects.get(id).turn});
    const before=[g.statValue(f,"phy_atk"),g.effectiveSpeed(b,"player"),g.actionFailureChance(f)];
    const out=g.resolveTurn(b,{player:{type:"wait"},enemy:{type:"wait"}});
    return JSON.stringify([...before,out.events.find(e=>e.type==="residual"&&e.side==="player").damage,f.statuses[0].turns]);
  })()`;
  assert.deepEqual(JSON.parse(go.run(scenario)),[60,60,25,10,4]);
  assert.deepEqual(JSON.parse(r.run(scenario)),[30,90,50,14,2]);
});

test('old ten-column effects still load with neutral modifiers and no action failure chance', async () => {
  const r=runtime({transforms:{'./data/effect.csv':text=>{
    const headers=text.split(/\r?\n/,1)[0].split(',').slice(0,10);const rows=go.run('rowsFromCsv')(text);
    const cell=value=>'"'+String(value??'').replaceAll('"','""')+'"';
    return headers.join(',')+'\n'+rows.map(row=>headers.map(h=>cell(row[h])).join(',')).join('\n');
  }}});await r.boot();
  for(const id of ['burn','paralysis','frostbite']) {
    assert.equal(r.run('state.effects.get('+JSON.stringify(id)+').stat_modifier_multiplier'),1);
    assert.equal(r.run('state.effects.get('+JSON.stringify(id)+').action_failure_chance'),0);
  }
});
