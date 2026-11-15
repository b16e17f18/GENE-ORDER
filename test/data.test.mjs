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
    "bgm.js", "dialogue-manager.js", "go-ui.js", "app.js"]);
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

test("diagnoses unresolved move references and keeps passive placeholders separate", () => {
  assert.equal(go.run('state.dataDiagnostics.some((d) => d.level === "参照不一致" && d.value === "burn")'), true);
  assert.equal(go.run('state.skills.get("skill_001").effect1'), "bf_pa_down1");
  assert.equal(go.run('[...state.passives.values()].every((p) => p.status === "implemented")'), true);
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
  assert.equal(go.run('state.characters[0].imageSrc'), "./asset/character/character_001.png");
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
  assert.deepEqual(simulate(go, 0.9), [42, 41, 6, 0, false]);
  assert.deepEqual(simulate(revised, 0.4), [84, 62, 7, 0, true]);
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
  assert.equal(go.run('state.dataDiagnostics.filter(d => d.level === "効果未設定").length'), 0);
  assert.equal(go.run('state.dataDiagnostics.filter(d => d.table === "passives" && d.level === "効果未対応").length'), 0);
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
  assert.deepEqual(JSON.parse(go.run(scenario)), [77, 96, 122, 1]);
  assert.deepEqual(JSON.parse(revised.run(scenario)), [107, 144, 122, 0]);
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

test("formal CSV has 24 playable passives and reports actionable numeric bounds", async () => {
  assert.equal(go.run('state.dataDiagnostics.filter(d => ["数値異常", "重複ID", "相性欠落", "相性重複"].includes(d.level)).length'), 0);
  assert.equal(go.run('state.dataDiagnostics.filter(d => d.level === "参照不一致").length'), 4);
  assert.equal(go.run('state.dataDiagnostics.filter(d => d.table === "passives" && d.level === "予約行").length'), 40);
  const invalid = runtime({ transforms: {
    "./data/character.csv": (text) => text.replace("獣族,125,81,75", "獣族,0,81.5,75"),
    "./data/skill.csv": (text) => text.replace("pa_down1,enemy,100", "pa_down1,enemy,101")
      .replace(",0,1,相手のPAを", ",0,8,相手のPAを"),
    "./data/battle_effect.csv": (text) => text.replace("none,0,1,TRUE,none,none,50", "none,0,0,TRUE,none,none,101"),
    "./data/power_rule.csv": (text) => text.replace("go_en_value_7,en_value,7,7,1.5", "go_en_value_7,en_value,7,6,0"),
  } });
  await invalid.boot();
  const detected = JSON.parse(invalid.run('JSON.stringify(state.dataDiagnostics.filter(d => d.level === "数値異常").map(d => [d.id,d.field].join("/")).sort())'));
  assert.deepEqual(detected, ["bf_half_guard/damage_cut", "bf_half_guard/turn", "character_001/hp", "character_001/phy_atk",
    "go_en_value_7/max_ratio", "go_en_value_7/power_multiplier", "skill_001/cost", "skill_001/effect_chance1"]);
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

test("official UI rejects unready, invalid, duplicate and oversized teams using the formal roster", () => {
  assert.equal(go.run('geneOrderUI.fighterIssue(state.characterMap.get("character_047"), state)'), "習得技未設定");
  assert.equal(go.run('geneOrderUI.fighterIssue(state.characterMap.get("character_005"), state)'), "");
  assert.equal(go.run(`(${formalMatch()}).battle.teams.player[0].base.name`), "ユーズドマウス");
  assert.throws(() => go.run(formalMatch().replace('"character_016", "character_015", "character_019"', "")), /先発/);
  assert.throws(() => go.run(formalMatch().replace('"character_016"', '"character_015"')), /先発/);
  assert.throws(() => go.run(formalMatch().replace("random: ()", "limit: 2, random: ()")), /1〜2体/);
  assert.throws(() => go.run(formalMatch().replace('"character_016"', '"character_047"')), /習得技未設定/);
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
      match.resolve({ player: { type: "switch", index: 2 }, enemy: wait });
      const poison = { type: "move", moveId: "skill_053" };
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
  assert.deepEqual(actual, [7, 6, 0, true, "player", true, 1, null, 146]);
});


test("GO character stat card uses Japanese labels and independent graph maxima", () => {
  const stats = ["hp", "phy_atk", "phy_def", "sp_atk", "sp_def", "speed"];
  for (const key of stats) {
    const max = key === "hp" ? 275 : 225;
    const markup = go.run(`goCharacterStat("${key}", ${max})`);
    assert.match(markup, /--bar-width: 100%/);
    assert.match(go.run(`goCharacterStat("${key}", ${Math.floor(max / 2)})`), /--bar-width: 50%/);
  }
  assert.match(go.run('goCharacterStat("regen_value", 25)'), /--bar-width: 50%/);
  assert.match(go.run('goCharacterStat("regen_value", 50)'), /--bar-width: 100%/);
  assert.match(go.run('goCharacterStat("hp", 300)'), />300<\/strong>/);
  assert.match(go.run('goCharacterStat("regen_value", 25)'), /回復力/);
  assert.equal(go.run('goStatText("HPとPA・PD・SA・SD・SP")'), "体力と物理攻撃・物理防御・特殊攻撃・特殊防御・敏捷");
  assert.equal(go.run('state.characterMap.get("character_001").regen_value'), 25);
});
