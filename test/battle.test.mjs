import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const context = vm.createContext({ document: { addEventListener() {} } });
for (const file of ["data-validation.js", "passive.js", "battle-core.js", "battle-ai.js", "bgm.js", "dialogue-manager.js", "app.js"]) {
  vm.runInContext(read(file), context, { filename: file });
}
const go = vm.runInContext("geneOrderBattle", context);
const csv = vm.runInContext("rowsFromCsv", context);
const normalizeCharacter = vm.runInContext("normalizeCharacter", context);
const normalizeSkill = vm.runInContext("normalizeSkill", context);
const lookup = vm.runInContext("masterIdLookup", context);
const elements = lookup(csv(read("data/element.csv")), "element_id");
const species = lookup(csv(read("data/species.csv")), "species_id");
const chart = new Map();
for (const row of csv(read("data/element_effectiveness.csv"))) {
  if (!chart.has(row.attack_element)) chart.set(row.attack_element, new Map());
  chart.get(row.attack_element).set(row.defense_element, Number(row.multiplier));
}

const strike = { skill_id: "strike", name: "Test strike", category: "attack", attack_type: "physical",
  element: "fire", element2: null, power: 80, priority: 0, cost: 1 };
const character = (overrides = {}) => ({
  name: "Fighter", hp: 200, phy_atk: 120, phy_def: 100, sp_atk: 160, sp_def: 110, speed: 100,
  element_1: "fire", element_2: null, energy_charge: 1, skillIds: ["strike"], ...overrides,
});
const select = (moveId = "strike") => ({ type: "move", moveId });
const wait = { type: "wait" };

function battle({ player = [character()], enemy = [character({ name: "Target", element_1: "light" })],
  skills = [strike], random = () => 0, ...options } = {}) {
  return go.createBattle({ player, enemy, skills: new Map(skills.map((move) => [move.skill_id, move])), effectiveness: chart, random, ...options });
}
const active = (match, side = "player") => go.activeFighter(match, side);
const fighters = (match) => [active(match), active(match, "enemy")];

test("physical and special damage use their own stats with an optional attack stat input", () => {
  const [a, b] = fighters(battle());
  b.base.element_1 = "thunder";
  const physical = go.calculateDamage(a, b, strike, chart);
  assert.deepEqual([physical.attack, physical.defense, physical.baseDamage, physical.damage], [120, 100, 44, 55]);
  const special = go.calculateDamage(a, b, { ...strike, attack_type: "special" }, chart);
  assert.deepEqual([special.attack, special.defense, special.baseDamage], [160, 110, 53]);
  assert.equal(go.calculateDamage(a, b, strike, chart, { attackStat: "phy_def" }).attack, 100);
});

test("preview does not mutate state, use RNG, or roll critical hits", () => {
  const match = battle({ random: () => { throw Error("turn RNG used"); } });
  const [a, b] = fighters(match);
  b.base.element_1 = "thunder";
  a.passiveState = { survive_once_used: false };
  const snapshot = JSON.stringify(match);
  vm.runInContext('const originalRandom = Math.random; Math.random = () => { throw Error("damage RNG used"); };', context);
  try {
    const result = go.calculateDamage(a, b, strike, chart);
    for (let i = 0; i < 10; i++) assert.deepEqual(go.calculateDamage(a, b, strike, chart), result);
    assert.equal(result.damage, 55);
    assert.equal(JSON.stringify(match), snapshot);
  } finally {
    vm.runInContext("Math.random = originalRandom;", context);
  }
});

test("GO rounding, STAB, resistance, weakness, zero, and minimum damage", () => {
  for (const [value, expected] of [[0, 0], [0.49, 0], [0.5, 0], [0.51, 1], [97.5, 97], [97.75, 98]]) {
    assert.equal(go.roundHalfDown(value), expected);
  }
  const [a, b] = fighters(battle());
  for (const [type, expected] of [["thunder", 55], ["earth", 110], ["water", 27]]) {
    b.base.element_1 = type;
    assert.equal(go.calculateDamage(a, b, strike, chart).damage, expected);
  }
  b.base.element_1 = "thunder";
  go.changeStage(a, "phy_atk", 1);
  const boosted = go.calculateDamage(a, b, strike, chart);
  assert.deepEqual([boosted.attack, boosted.baseDamage, boosted.damage], [180, 65, 81]);
  assert.equal(go.calculateDamage(a, b, strike, chart, { finalMultiplier: 0.5 }).damage, 40);
  assert.equal(go.calculateDamage(a, b, strike, chart, { finalMultiplier: 0 }).damage, 0);
  assert.equal(go.calculateDamage(a, b, strike, chart, { blocked: true }).damage, 0);
  assert.equal(go.calculateDamage(a, b, strike, chart, { finalMultiplier: 0.001 }).damage, 1);
  a.base.element_1 = "water";
  assert.equal(go.calculateDamage(a, b, strike, chart).damage, 65);
  a.base.element_2 = "fire";
  assert.equal(go.calculateDamage(a, b, strike, chart).damage, 81);
});

test("every one of the 81 official matchups is read directly from the chart", () => {
  const [a, b] = fighters(battle());
  assert.equal(chart.size, 9);
  let count = 0;
  for (const [element, row] of chart) {
    for (const [target, expected] of row) {
      b.base.element_1 = target;
      assert.equal(go.calculateDamage(a, b, { ...strike, element }, chart).effectiveness, expected);
      count += 1;
    }
  }
  assert.equal(count, 81);
});

test("dual defense multiplies to 4, 1, 0.25 and 0, and STAB is applied once", () => {
  const [a, b] = fighters(battle());
  for (const [element, type1, type2, factor] of [
    ["fire", "earth", "dark", 4], ["fire", "earth", "water", 1],
    ["fire", "wind", "water", 0.25], ["earth", "light", "wind", 0],
  ]) {
    b.base.element_1 = type1;
    b.base.element_2 = type2;
    const result = go.calculateDamage(a, b, { ...strike, element }, chart);
    assert.equal(result.effectiveness, factor);
    assert.equal(result.damage, Math.floor(result.afterStab * factor));
  }
  a.base.element_2 = "fire";
  assert.equal(go.calculateDamage(a, b, strike, chart).stab, 1.25);
});

test("all 324 dual defenses multiply, with Thunder and Ice STAB applied once", () => {
  const [attacker, defender] = fighters(battle());
  const types = [...chart.keys()];
  let count = 0;
  for (const [element, row] of chart) {
    attacker.base.element_1 = "fire";
    attacker.base.element_2 = element;
    for (const [index, first] of types.entries()) {
      for (const second of types.slice(index + 1)) {
        defender.base.element_1 = first;
        defender.base.element_2 = second;
        const result = go.calculateDamage(attacker, defender, { ...strike, element }, chart);
        assert.equal(result.stab, 1.25);
        assert.equal(result.effectiveness, row.get(first) * row.get(second));
        assert.equal(result.damage === 0, result.effectiveness === 0);
        count += 1;
      }
    }
  }
  assert.equal(count, 324);
});

test("neutral, blank, status and supported compound attacks remain distinct", () => {
  const [a, b] = fighters(battle());
  a.base.element_1 = "none";
  const neutral = { ...strike, element: "none" };
  assert.equal(go.calculateDamage(a, b, neutral, chart).stab, 1.25);
  a.base.element_1 = null;
  assert.equal(go.calculateDamage(a, b, neutral, chart).stab, 1);
  b.base.element_1 = "dark";
  assert.equal(go.calculateDamage(a, b, neutral, chart).effectiveness, 0.5);
  assert.throws(() => go.calculateDamage(a, b, { ...neutral, element: null }, chart), /未定義/);
  assert.equal(go.calculateDamage(a, b, { ...neutral, element2: "fire" }, chart).effectiveness, 1);
  const status = go.calculateDamage(a, b, { category: "status", power: 0 }, chart);
  assert.equal(status.reason, "not-attack");
  assert.equal(status.damage, 0);
});

test("all 13 stage ratios, clamping, cumulative changes and stat flooring", () => {
  const fighter = active(battle({ player: [character({ phy_atk: 105, sp_atk: 1 })] }));
  const expected = [26, 30, 35, 42, 52, 70, 105, 157, 210, 262, 315, 367, 420];
  assert.equal(go.changeStage(fighter, "phy_atk", -100), -6);
  for (let i = 0; i < expected.length; i++) {
    assert.equal(go.statValue(fighter, "phy_atk"), expected[i]);
    go.changeStage(fighter, "phy_atk", 1);
  }
  assert.equal(fighter.stages.phy_atk, 6);
  assert.equal(go.changeStage(fighter, "phy_atk", 1), 0);
  go.changeStage(fighter, "sp_atk", -6);
  assert.equal(go.statValue(fighter, "sp_atk"), 1);
  assert.throws(() => go.changeStage(fighter, "hp", 1), /能力ランク/);
});

test("EN costs, zero-cost moves, and clamping", () => {
  const move = { ...strike, cost: 0 };
  const match = battle({ skills: [move] });
  go.changeEnergy(active(match), -100);
  assert.equal(active(match).energy, 0);
  const result = go.resolveTurn(match, { player: select(), enemy: wait });
  assert.equal(result.events[0].type, "move");
  assert.equal(active(match).energy, 1);
  go.changeEnergy(active(match), 100);
  assert.equal(active(match).energy, 7);
  const paid = battle();
  let costAtRegeneration;
  const base = paid.teams.player[0].base;
  Object.defineProperty(base, "energy_charge", { get() { costAtRegeneration = active(paid).energy; return 1; } });
  go.resolveTurn(paid, { player: select(), enemy: wait });
  assert.equal(costAtRegeneration, 0);
  assert.equal(active(paid).energy, 1);

  const immune = battle({ player: [character({ energy_charge: 0 })],
    enemy: [character({ element_1: "wind" })], skills: [{ ...strike, element: "earth" }] });
  const blocked = go.resolveTurn(immune, { player: select(), enemy: wait });
  assert.equal(blocked.events[0].damage, 0);
  assert.equal(active(immune, "enemy").hp, 200);
  assert.equal(active(immune).energy, 0);
});

test("EN shortage and unsupported selections do not advance or consume EN", () => {
  const costly = { ...strike, cost: 2 };
  const match = battle({ skills: [costly] });
  assert.throws(() => go.resolveTurn(match, { player: wait, enemy: select() }), /ENが不足/);
  assert.equal(match.turn, 1);
  assert.equal(active(match).energy, 1);
  const unsupported = battle({ skills: [{ ...strike, effect1: "poison" }] });
  assert.throws(() => go.resolveTurn(unsupported, { player: select(), enemy: wait }), /未対応.*poison/);
  assert.equal(active(unsupported, "enemy").hp, 200);
  for (const move of [{ ...strike, battle_effect1: "protect" }, { ...strike, power_rule: "hp_exact_1" },
    { ...strike, category: "status" }]) {
    assert.match(go.unsupportedMoveReason(move), /未対応/);
  }
  assert.equal(go.unsupportedMoveReason({ ...strike, hit_type: "guard_break" }), "");
});

test("action order compares priority, stage-adjusted speed, then injected random", () => {
  const fast = { ...strike, skill_id: "fast", priority: 1 };
  const setup = {
    player: [character({ speed: 80, skillIds: ["strike", "fast"] })],
    enemy: [character({ speed: 100 })], skills: [strike, fast],
  };
  const rngMustNotRun = () => { throw Error("unexpected tie"); };
  const first = (match, player = select()) => go.resolveTurn(match, { player, enemy: select() }).events[0].side;
  assert.equal(first(battle({ ...setup, random: rngMustNotRun }), select("fast")), "player");
  assert.equal(first(battle({ ...setup, random: rngMustNotRun })), "enemy");
  const boosted = battle({ ...setup, random: rngMustNotRun });
  go.changeStage(active(boosted), "speed", 1);
  assert.equal(first(boosted), "player");
  for (const [roll, expected] of [[0, "player"], [0.5, "enemy"]]) {
    assert.equal(first(battle({ random: () => roll })), expected);
  }
});

test("switch priority targets the incoming fighter, clears outgoing stages and preserves bench EN", () => {
  const match = battle({ player: [character(), character({ name: "Bench" })] });
  const outgoing = active(match);
  go.changeStage(outgoing, "phy_def", 2);
  go.changeEnergy(outgoing, 3);
  const result = go.resolveTurn(match, { player: { type: "switch", index: 1 }, enemy: select() });
  assert.equal(result.events[0].type, "switch");
  assert.equal(result.events[1].target, "Bench");
  assert.equal(outgoing.stages.phy_def, 0);
  assert.equal(outgoing.energy, 4);
  assert.equal(active(match).energy, 2);
  go.resolveTurn(match, { player: { type: "switch", index: 0 }, enemy: wait });
  assert.equal(active(match), outgoing);
  assert.equal(outgoing.energy, 5);
});

test("fainting cancels the queued move, replaces at end of turn and decides the winner", () => {
  const match = battle({ enemy: [character({ name: "First", hp: 1 }), character({ name: "Second", hp: 1 })] });
  const defeated = active(match, "enemy");
  const first = go.resolveTurn(match, { player: select(), enemy: select() });
  assert.deepEqual(Array.from(first.events.slice(0, 3), ({ type }) => type), ["move", "faint", "skipped"]);
  assert.equal(defeated.energy, 1);
  assert.equal(active(match, "enemy").base.name, "Second");
  assert.equal(active(match, "enemy").energy, 1);
  const second = go.resolveTurn(match, { player: select(), enemy: select() });
  assert.equal(second.winner, "player");
  assert.equal(active(match, "enemy").hp, 0);
  assert.throws(() => go.resolveTurn(match, { player: select(), enemy: wait }), /行動できません/);
});

test("official CSV integration: natural recovery offsets weak water attacks", () => {
  const characters = new Map(csv(read("data/character.csv")).filter((row) => row.name)
    .map((row) => [row.character_id, normalizeCharacter(row, elements, species)]));
  const skills = csv(read("data/skill.csv")).filter((row) => row.category).map((row) => normalizeSkill(row, elements));
  const match = battle({ ...assets, player: [characters.get("character_007")], enemy: [characters.get("character_021")], skills });
  for (let turn = 1; turn <= 10; turn++) {
    const [a, b] = fighters(match);
    const move = match.skills.get("skill_026");
    const expected = [go.calculateDamage(a, b, move, chart, assets).damage,
      go.calculateDamage(b, a, move, chart, assets).damage].sort((left, right) => left - right);
    const { events, winner } = go.resolveTurn(match, { player: select("skill_026"), enemy: select("skill_026") });
    const damages = events.filter((event) => event.category === "attack").map((event) => event.damage)
      .sort((left, right) => left - right);
    assert.deepEqual([...damages], [9, 13]);
    assert.deepEqual([...damages], expected);
    assert.equal(winner, null);
    assert.equal(events.filter((event) => event.source === "natural").length, 2);
  }
  assert.equal(active(match).hp, active(match).maxHp);
  assert.equal(active(match, "enemy").hp, active(match, "enemy").maxHp);
});

const officialCharacters = new Map(csv(read("data/character.csv")).filter((row) => row.name)
  .map((row) => [row.character_id, normalizeCharacter(row, elements, species)]));
const officialSkills = csv(read("data/skill.csv")).filter((row) => row.category).map((row) => normalizeSkill(row, elements));
const officialEffects = new Map(csv(read("data/effect.csv")).map((row) => [row.effect_id,
  vn("normalizeEffect")(row)]));
const officialDefense = new Map(csv(read("data/battle_effect.csv")).map((row) => [row.battle_effect_id,
  vn("normalizeBattleEffect")(row)]));
function vn(name) { return vm.runInContext(name, context); }
const officialPower = new Map();
for (const rule of csv(read("data/power_rule.csv")).map(vn("normalizePowerRule"))) {
  if (!officialPower.has(rule.power_rule_group)) officialPower.set(rule.power_rule_group, []);
  officialPower.get(rule.power_rule_group).push(rule);
}
const assets = { effects: officialEffects, battleEffects: officialDefense, powerRules: officialPower };
const skill = (id) => officialSkills.find((move) => move.skill_id === id);
const official = (...ids) => ids.map((id) => officialCharacters.get(id));
const action = (match, id, other = wait) => go.resolveTurn(match, { player: select(id), enemy: other });
const statusMove = (fields) => ({ ...strike, category: "status", power: 0, cost: 0, ...fields });

test("status moves apply all signed stages and healing on the declared target", () => {
  const multi = statusMove({ effect1: "bf_pa_up2", effect_target1: "self", effect_chance1: 100,
    effect2: "bf_pa_down1", effect_target2: "enemy", effect_chance2: 100,
    effect3: "bf_heal_half", effect_target3: "self", effect_chance3: 100, element: "earth" });
  const match = battle({ ...assets, skills: [multi], player: [character({ hp: 125 })],
    enemy: [character({ element_1: "wind" })] });
  const [a, b] = fighters(match);
  a.hp = 10;
  a.stages.phy_atk = 5;
  b.stages.phy_atk = -6;
  const result = action(match, "strike");
  assert.equal(a.stages.phy_atk, 6);
  assert.equal(b.stages.phy_atk, -6);
  assert.equal(a.hp, 72);
  assert.equal(b.hp, 200);
  assert.equal(result.events[0].reason, "not-attack");
  action(match, "strike");
  assert.equal(a.hp, 125);
});

test("effect chances handle 0, 100 and a strict middle threshold", () => {
  const move = statusMove({ effect1: "bf_pa_up1", effect_chance1: 0, effect_target1: "self",
    effect2: "bf_sa_up1", effect_chance2: 50, effect_target2: "self",
    effect3: "bf_sd_up1", effect_chance3: 100, effect_target3: "self", priority: 1 });
  for (const [roll, expected] of [[0.499, 1], [0.5, 0]]) {
    let calls = 0;
    const match = battle({ ...assets, skills: [move], random: () => { calls++; return roll; } });
    action(match, "strike");
    const f = active(match);
    assert.deepEqual([f.stages.phy_atk, f.stages.sp_atk, f.stages.sp_def, calls], [0, expected, 1, 1]);
  }
});

test("drain uses actual HP loss, including overkill and zero", () => {
  const drain = { ...strike, effect1: "bf_drain_50", effect_target1: "self", effect_chance1: 100 };
  const match = battle({ ...assets, skills: [drain], enemy: [character({ hp: 20, element_1: "light" })] });
  active(match).hp = 100;
  const result = action(match, "strike");
  assert.equal(result.events[0].damage, 27);
  assert.equal(result.events[0].actualDamage, 20);
  assert.equal(active(match).hp, 110);
  const immune = battle({ ...assets, skills: [{ ...drain, element: "earth" }],
    enemy: [character({ element_1: "wind" })] });
  active(immune).hp = 100;
  assert.equal(action(immune, "strike").events.some((e) => e.type === "heal"), false);
  assert.equal(active(immune).hp, 100);
});

test("imported fixed HP heals preserve MHB amounts independently of maximum HP", () => {
  for (const [id, amount] of [["heal_hp1", 300], ["heal_hp2", 250], ["heal_hp3", 150]]) {
    for (const maxHp of [1000, 2000]) {
      const move = statusMove({ skill_id: "test-heal", effect1: id, effect_target1: "self", effect_chance1: 100 });
      const match = battle({ ...assets, skills: [move], player: [character({ hp: maxHp, skillIds: [move.skill_id] })] });
      const actor = active(match);
      actor.hp = 1;
      const preview = go.previewDamage(match, "player", move);
      assert.equal(preview.actorHp, 1 + amount);
      assert.equal(actor.hp, 1);
      const turn = action(match, move.skill_id);
      assert.equal(actor.hp, 1 + amount);
      assert.equal(turn.events.find((event) => event.type === "heal").recovered, amount);
      actor.hp = maxHp - 20;
      assert.equal(go.previewDamage(match, "player", move).actorHp, maxHp);
      action(match, move.skill_id);
      assert.equal(actor.hp, maxHp);
      action(match, move.skill_id);
      assert.equal(actor.hp, maxHp);
    }
  }
});

test("imported guards cover all nine elements and physical or special attacks", () => {
  const ids = [...chart.keys()].map((element) => element + "_protect")
    .concat("phy_protect", "phy_protect2", "sp_protect2");
  for (const id of ids) {
    const definition = officialDefense.get(id);
    assert.ok(definition, id);
    const attack_type = id.startsWith("sp_") ? "special" : "physical";
    const element = definition.guard_type.endsWith("_damage") && !["phy_damage", "sp_damage"].includes(definition.guard_type)
      ? definition.guard_type.slice(0, -7) : "fire";
    const attack = { ...strike, element, attack_type, cost: 0 };
    const setup = statusMove({ skill_id: "test-guard", battle_effect1: id, battle_effect_chance1: 100 });
    const match = battle({ ...assets, skills: [setup, attack],
      player: [character({ hp: 1000, skillIds: [setup.skill_id] })] });
    action(match, setup.skill_id);
    assert.equal(match.fields.player.size, 1);
    const expected = go.calculateDamage(active(match, "enemy"), active(match), attack, chart,
      { finalMultiplier: 1 - definition.damage_cut / 100 });
    const preview = go.previewDamage(match, "enemy", attack);
    assert.equal(preview.damage, expected.damage, id);
    const other = id.startsWith("phy_") ? { ...attack, attack_type: "special" }
      : id.startsWith("sp_") ? { ...attack, attack_type: "physical" }
      : { ...attack, element: element === "none" ? "fire" : "none" };
    assert.equal(go.previewDamage(match, "enemy", other).damage,
      go.calculateDamage(active(match, "enemy"), active(match), other, chart).damage, id + " unrelated attack");
    const hp = active(match).hp;
    go.resolveTurn(match, { player: wait, enemy: select() });
    assert.equal(hp - active(match).hp, preview.actualDamage, id);
    const timed = match.fields.player.get(id);
    assert.equal(timed.expires - timed.starts, definition.turn);
  }
});

test("imported definitions stay unassigned unless an official skill explicitly configures one", () => {
  const unused = new Set(["heal_hp1", "heal_hp2", "heal_hp3", "phy_protect", "phy_protect2", "sp_protect2",
    "fire_protect", "thunder_protect", "ice_protect", "wind_protect", "earth_protect", "none_protect"]);
  for (const move of officialSkills) {
    assert.equal(go.moveEffects(move).some((effect) => unused.has(effect.id)), false, move.skill_id);
  }
  assert.equal(officialSkills.filter((move) => go.moveEffects(move).some((effect) => ["dark_protect", "light_protect"].includes(effect.id)))
    .map((move) => move.skill_id).join(","), "skill_068,skill_073");
});

test("EN recovery and guard from 大地の恵み are independent and capped", () => {
  const move = skill("skill_032");
  const match = battle({ ...assets, skills: [strike, move], player: [character({ skillIds: [move.skill_id] })] });
  active(match).energy = 6;
  const result = action(match, move.skill_id, select());
  assert.equal(result.events.find((e) => e.type === "effect-energy").recovered, 1);
  assert.equal(result.events.find((e) => e.side === "enemy" && e.type === "move").damage, 11);
  assert.equal(active(match).energy, 7);
  assert.equal(active(match).halfGuard, 0);
});

test("the common evasion action is independent of skill slots and has exact chance thresholds", () => {
  for (const [rate, roll, success] of [[0, 0, false], [50, 0.4999, true], [50, 0.5, false],
    [85, 0.8499, true], [85, 0.85, false], [100, 0.999, true], [-1, 0, false], [120, 0.999, true]]) {
    const match = battle({ ...assets, skills: [strike, skill("skill_000")],
      player: [character({ skillIds: [], evasion_percent: rate })], random: () => roll });
    assert.equal(go.checkAction(match, "player", select("skill_000")), "");
    const result = action(match, "skill_000", select());
    assert.equal(result.events.find((e) => e.type === "dodge-attempt").success, success);
    assert.equal(result.events.some((e) => e.type === "evaded"), success);
    assert.equal(result.events.find((e) => e.side === "enemy" && e.type === "move").damage, success ? 0 : 22);
    assert.equal(active(match).hp, success ? 200 : 178);
    assert.equal(active(match).energy, 2);
    assert.equal(active(match).dodgeActive, false);
    go.resolveTurn(match, { player: wait, enemy: select() });
    assert.equal(active(match).hp, success ? 178 : 156);
  }
});

test("刃研ぎ shares evasion and still raises PA", () => {
  const match = battle({ ...assets, skills: [strike, skill("skill_043")],
    player: [character({ skillIds: ["skill_043"], evasion_percent: 85 })], random: () => 0.84 });
  const result = action(match, "skill_043", select());
  assert.equal(active(match).stages.phy_atk, 1);
  assert.equal(result.events.some((e) => e.type === "evaded"), true);
});

test("ignore_dodge bypasses evasion but not guard or type immunity", () => {
  const ignore = { ...strike, hit_type: "ignore_dodge" };
  const guard = skill("skill_031");
  const dodge = skill("skill_000");
  const match = battle({ ...assets, skills: [ignore, guard, dodge],
    player: [character({ skillIds: [guard.skill_id], evasion_percent: 100 })] });
  const avoided = action(match, dodge.skill_id, select());
  assert.equal(avoided.events.some((e) => e.type === "dodge-attempt" && e.success), true);
  assert.equal(avoided.events.some((e) => e.type === "evaded"), false);
  assert.equal(active(match).hp, 178);
  const reduced = action(match, guard.skill_id, select());
  assert.equal(reduced.events.find((e) => e.side === "enemy" && e.type === "move").damage, 11);
  assert.equal(active(match).hp, 167);
  const [a, b] = fighters(match);
  b.base.element_1 = "wind";
  b.dodgeActive = true;
  b.halfGuard = 50;
  assert.equal(go.calculateDamage(a, b, { ...ignore, element: "earth" }, chart).damage, 0);
  assert.equal(go.calculateDamage(a, b, ignore, chart).damage, 13);
});

test("evaded and immune attacks skip enemy effects, retain self penalties, and never debuff a KO", () => {
  const move = { ...strike, element: "earth", effect1: "bf_pa_down1", effect_chance1: 100,
    effect2: "bf_pd_down1", effect_target2: "self", effect_chance2: 100 };
  for (const { element_1, hp, useDodge } of [{ element_1: "wind", hp: 200 }, { element_1: "earth", hp: 200, useDodge: true },
    { element_1: "light", hp: 1 }]) {
    const match = battle({ ...assets, skills: [move, skill("skill_000")],
      enemy: [character({ element_1, hp, evasion_percent: 100 })] });
    action(match, "strike", useDodge ? select("skill_000") : wait);
    assert.equal(active(match).stages.phy_def, -1);
    assert.equal(active(match, "enemy").stages.phy_atk, 0);
  }
});

test("evasion does not block an enemy-targeted status move", () => {
  const song = skill("skill_001");
  const match = battle({ ...assets, skills: [song, skill("skill_000")],
    player: [character({ evasion_percent: 100 })], enemy: [character({ skillIds: [song.skill_id] })] });
  const result = action(match, "skill_000", select(song.skill_id));
  assert.equal(result.events.some((e) => e.type === "evaded"), false);
  assert.equal(active(match).stages.phy_atk, -1);
});

test("シェルハード previews PD damage and applies its self PD penalty", () => {
  const shell = skill("skill_033");
  const match = battle({ ...assets, skills: [shell], player: [character({ skillIds: [shell.skill_id], phy_atk: 40, phy_def: 130 })] });
  const [a, b] = fighters(match);
  const preview = go.calculateDamage(a, b, shell, chart);
  assert.equal(preview.attack, 130);
  assert.equal(preview.defense, 100);
  assert.equal(action(match, shell.skill_id).events[0].damage, preview.damage);
  assert.equal(a.stages.phy_def, -1);
});

test("窮鼠猫噛 resolves exact HP 1 at action time", () => {
  const hpOne = skill("skill_005");
  const hit = { ...strike, power: 1, cost: 0, priority: 1 };
  const match = battle({ ...assets, skills: [hpOne, hit], player: [character({ skillIds: [hpOne.skill_id], hp: 200 })] });
  const [a, b] = fighters(match);
  for (const [hp, power] of [[1, 160], [2, 70], [3, 70], [200, 70]]) {
    a.hp = hp;
    assert.equal(go.calculateDamage(a, b, hpOne, chart, assets).power, power);
  }
  go.changeEnergy(a, 1);
  // Fire against fire: base 2, no STAB, 0.5x => 1 damage.
  const expected = go.calculateDamage({ ...a, hp: 1 }, b, hpOne, chart, assets).damage;
  a.hp = 2;
  const result = action(match, hpOne.skill_id, select());
  assert.equal(a.hp, 1);
  assert.equal(result.events[1].damage, expected);
});

test("formal data battle includes status, evasion, guard, heal, ranks, EN, switches and victory", () => {
  const match = battle({ ...assets, skills: officialSkills, player: official("character_002", "character_009"),
    enemy: official("character_007"), random: () => 0.1 });
  const water = select("skill_026");
  const allEvents = [];
  const turn = (player, enemy = water) => allEvents.push(...go.resolveTurn(match, { player, enemy }).events);
  turn(select("skill_000"));
  turn({ type: "switch", index: 1 });
  turn(select("skill_031"));
  turn({ type: "switch", index: 0 });
  turn(wait);
  turn(select("skill_003"));
  for (let i = 0; i < 15 && !match.winner; i++) {
    const player = active(match);
    turn(player.energy >= 1 ? select("skill_007") : wait, wait);
  }
  for (const type of ["move", "dodge-attempt", "evaded", "switch", "half-guard", "heal", "stage", "energy", "faint", "win"]) {
    assert.ok(allEvents.some((e) => e.type === type), type);
  }
  assert.ok(allEvents.some((e) => e.type === "heal" && e.recovered > 0));
  assert.equal(match.winner, "player");
});

test("official poison is guaranteed, rounds like MHB, refreshes and ticks the CSV five turns", () => {
  const poison = skill("skill_027");
  const match = battle({ ...assets, skills: [poison], player: official("character_007"),
    enemy: [character({ hp: 125, element_1: "water" })], random: () => { throw Error("100% must not roll"); } });
  const victim = active(match, "enemy");
  go.changeEnergy(active(match), 6);
  const first = action(match, poison.skill_id);
  assert.equal(first.events.find(e => e.type === "residual").damage, 13);
  assert.equal(victim.statuses[0].turns, 4);
  const pass = () => go.resolveTurn(match, { player: wait, enemy: wait });
  pass();
  victim.hp = victim.maxHp;
  go.changeEnergy(active(match), 6);
  action(match, poison.skill_id);
  assert.equal(victim.statuses.length, 1);
  assert.equal(victim.statuses[0].turns, 4);
  victim.hp = victim.maxHp;
  for (let i = 0; i < 4; i++) assert.equal(pass().events.find(e => e.type === "residual").damage, 13);
  assert.equal(victim.statuses.length, 0);
  assert.ok(!pass().events.some(e => e.type === "residual"));
});

test("poison is retained and paused on the bench, and is blocked by evasion or immunity", () => {
  const original = { ...skill("skill_053"), element: "earth" };
  const poisoner = character({ skillIds: [original.skill_id] });
  const match = battle({ ...assets, skills: [original, skill("skill_000")], player: [poisoner],
    enemy: [character({ element_1: "wind", evasion_percent: 100 }), character({ evasion_percent: 100 })] });
  go.changeEnergy(active(match), 6);
  const run = (enemy) => action(match, original.skill_id, enemy);
  run(wait);
  assert.equal(active(match, "enemy").statuses.length, 0);
  run({ type: "switch", index: 1 });
  const poisoned = active(match, "enemy");
  assert.equal(poisoned.statuses[0].turns, 4);
  const hp = poisoned.hp;
  go.resolveTurn(match, { player: wait, enemy: { type: "switch", index: 0 } });
  assert.equal(poisoned.hp, hp);
  assert.equal(poisoned.statuses[0].turns, 4);
  poisoned.statuses = [];
  go.resolveTurn(match, { player: wait, enemy: { type: "switch", index: 1 } });
  go.changeEnergy(active(match), 6);
  assert.ok(run(select("skill_000")).events.some(e => e.type === "evaded"));
  assert.equal(poisoned.statuses.length, 0);
});

test("natural recovery heals only living active fighters, caps HP, and captures the healed frame", () => {
  const match = battle({ player: [character({ regen_value: 25 }), character({ regen_value: 90 })],
    enemy: [character({ regen_value: 0 })], captureFrame: (battle) => ({ playerHp: active(battle).hp }) });
  const actor = active(match);
  const bench = match.teams.player[1];
  actor.hp = 100;
  bench.hp = 50;
  active(match, "enemy").hp = 100;
  const turn = go.resolveTurn(match, { player: wait, enemy: wait });
  const healing = turn.events.filter((event) => event.source === "natural");
  assert.equal(healing.length, 1);
  assert.equal(healing[0].recovered, 25);
  assert.equal(actor.hp, 125);
  assert.equal(bench.hp, 50);
  assert.equal(active(match, "enemy").hp, 100);
  const index = turn.events.indexOf(healing[0]);
  assert.equal(turn.frames[index].playerHp, 125);
  actor.hp = actor.maxHp - 10;
  assert.equal(go.resolveTurn(match, { player: wait, enemy: wait }).events.find((event) => event.source === "natural").recovered, 10);
  assert.equal(actor.hp, actor.maxHp);
  assert.equal(go.resolveTurn(match, { player: wait, enemy: wait }).events.some((event) => event.source === "natural"), false);
});

test("natural recovery follows poison, bind and end passives, before EN and replacements", () => {
  const match = passiveBattle({ player: [withPassive("014", { regen_value: 25 }), character({ regen_value: 100 })],
    enemy: [character({ regen_value: 100 })] });
  const actor = active(match);
  const target = active(match, "enemy");
  actor.hp = 100;
  actor.statuses = [{ definition: officialEffects.get("poison"), turns: 3 }];
  actor.bind = { definition: officialEffects.get("bind"), turns: 3, source: target };
  target.hp = 1;
  target.statuses = [{ definition: officialEffects.get("poison"), turns: 3 }];
  // Keep another enemy alive so end-of-turn processing proceeds after the active KO.
  match.teams.enemy.push(go.createBattle({ player: [character({ regen_value: 100 })], enemy: [character()] }).teams.player[0]);
  const result = go.resolveTurn(match, { player: wait, enemy: wait });
  const events = result.events;
  const residual = events.findLastIndex((event) => event.type === "residual");
  const passive = events.findIndex((event) => event.type === "passive" && event.phase === "turn-end");
  const recovered = events.findIndex((event) => event.source === "natural");
  const energy = events.findIndex((event) => event.type === "energy");
  const replacement = events.findIndex((event) => event.type === "replacement");
  assert.ok(residual < passive && passive < recovered && recovered < energy && energy < replacement);
  assert.equal(actor.hp, 85);
  assert.equal(target.hp, 0);
  assert.equal(target.fainted, true);
  assert.equal(events.some((event) => event.source === "natural" && event.side === "enemy"), false);
  assert.equal(active(match, "enemy").hp, active(match, "enemy").maxHp);
});

test("natural recovery cannot revive residual KOs or run after victory", () => {
  const match = battle({ player: [character({ regen_value: 100 })], enemy: [character({ regen_value: 100 })] });
  for (const fighter of fighters(match)) {
    fighter.hp = 1;
    fighter.statuses = [{ definition: officialEffects.get("poison"), turns: 3 }];
  }
  const draw = go.resolveTurn(match, { player: wait, enemy: wait });
  assert.equal(draw.winner, "draw");
  assert.equal(draw.events.some((event) => event.source === "natural"), false);
  const won = battle({ player: [character({ regen_value: 100 })], enemy: [character({ hp: 1 })] });
  active(won).hp = 100;
  const victory = action(won);
  assert.equal(victory.winner, "player");
  assert.equal(active(won).hp, 100);
  assert.equal(victory.events.some((event) => event.source === "natural"), false);
});

test("natural recovery occurs once across replacement selection and follows the incoming fighter on normal switches", () => {
  const move = { ...strike, power: 1000, priority: 1 };
  const match = battle({ skills: [move], player: [character({ regen_value: 25 })],
    enemy: [character({ hp: 1, regen_value: 100 }), character({ regen_value: 100 })], manualSwitches: true });
  active(match).hp = 50;
  const round = action(match);
  assert.equal(round.pendingSwitch.reason, "replacement");
  assert.equal(active(match).hp, 75);
  const continuation = go.continueSwitch(match, "enemy", 1);
  assert.equal(continuation.events.some((event) => event.source === "natural"), false);
  assert.equal(active(match).hp, 75);
  const switched = battle({ player: [character({ regen_value: 25 }), character({ regen_value: 40 })] });
  switched.teams.player[0].hp = 50;
  switched.teams.player[1].hp = 60;
  go.resolveTurn(switched, { player: { type: "switch", index: 1 }, enemy: wait });
  assert.equal(switched.teams.player[0].hp, 50);
  assert.equal(active(switched).hp, 100);
});

test("natural recovery preview and AI use regen without mutating state or rescuing lethal HP", () => {
  const move = { ...strike, cost: 0 };
  const match = battle({ skills: [move], player: [character({ regen_value: 25 })], enemy: [character({ regen_value: 30 })] });
  const actor = active(match);
  const target = active(match, "enemy");
  actor.hp = 100;
  target.hp = 100;
  actor.statuses = [{ definition: officialEffects.get("poison"), turns: 3 }];
  const snapshot = JSON.stringify(match);
  const board = ai.observe(match, "player");
  assert.equal(board.teams.player[0].base.regen_value, 25);
  assert.equal(board.teams.enemy[0].base.regen_value, 30);
  const candidate = ai.evaluate(board).find((entry) => entry.move?.skill_id === move.skill_id);
  const preview = go.previewTurnEndRecovery(actor);
  assert.deepEqual([preview.hp, preview.recovered], [105, 25]);
  assert.equal(go.previewTurnEndRecovery(actor, 1).recovered, 0);
  assert.equal(JSON.stringify(match), snapshot);
  const result = action(match);
  assert.equal(actor.hp, candidate.forecast.actorEndHp);
  assert.equal(target.hp, candidate.forecast.targetEndHp);
  assert.equal(result.events.filter((event) => event.source === "natural").length, 2);
});

test("AI values natural recovery when choosing healing or waiting", () => {
  const heal = statusMove({ skill_id: "heal", effect1: "bf_heal_half", effect_target1: "self", effect_chance1: 100 });
  const scores = (regen_value) => {
    const match = battle({ ...assets, skills: [strike, heal], player: [character({ regen_value, skillIds: ["strike", "heal"] })],
      enemy: [character({ hp: 1000 })] });
    active(match).hp = 80;
    const candidates = ai.evaluate(ai.observe(match, "player"));
    return {
      heal: candidates.find((entry) => entry.move?.skill_id === "heal").score,
      attack: candidates.find((entry) => entry.move?.skill_id === "strike").score,
      wait: candidates.find((entry) => entry.action.type === "wait").score,
    };
  };
  const none = scores(0);
  const high = scores(120);
  assert.ok(high.wait > none.wait);
  assert.ok(high.heal - high.attack < none.heal - none.attack);
});

test("residual KO cancels EN recovery and simultaneous residual KOs draw", () => {
  for (const withBench of [false, true]) {
    const match = battle({ ...assets, player: [character(), ...(withBench ? [character({name: "Bench"})] : [])] });
    const [a, b] = fighters(match);
    for (const f of [a, b]) {
      f.hp = 1;
      f.statuses.push({ definition: officialEffects.get("poison"), turns: 1 });
    }
    const result = go.resolveTurn(match, { player: wait, enemy: wait });
    assert.equal(result.winner, withBench ? "player" : "draw");
    assert.equal(result.events.filter(e => e.type === "faint").length, 2);
    assert.equal(result.events.filter(e => e.type === "energy").length, 0);
    assert.equal(a.energy, 1);
    assert.equal(b.energy, 1);
  }
});

test("official 六芒星術 halves now and cuts only special attacks in rounds 2–4", () => {
  const guard = skill("skill_025");
  const special = { ...strike, attack_type: "special" };
  const match = battle({ ...assets, skills: [guard, special],
    player: [character({ skillIds: [guard.skill_id] }), character({ name: "Bench" })] });
  const raw = go.previewDamage(match, "enemy", special).damage;
  const first = action(match, guard.skill_id, select());
  assert.equal(first.events.find(e => e.side === "enemy" && e.type === "move").damage, go.roundHalfDown(raw * 0.5));
  assert.equal(first.events.find(e => e.type === "field-applied").starts, 2);
  for (let turn = 2; turn <= 5; turn++) {
    const predicted = go.previewDamage(match, "enemy", special).damage;
    assert.equal(predicted, turn <= 4 ? go.roundHalfDown(raw * 0.75) : raw);
    assert.equal(go.previewDamage(match, "enemy", strike).damage, 22);
    const output = go.resolveTurn(match, { player: turn === 2 ? { type: "switch", index: 1 } : wait, enemy: select() });
    assert.equal(output.events.find(e => e.side === "enemy" && e.type === "move").damage, predicted);
  }
});

test("砂煙 is immediate for four turns and distinct guards multiply without duplicate stacking", () => {
  const water = { ...strike, element: "water", attack_type: "special" };
  const sand = skill("skill_050"), hex = skill("skill_025");
  const match = battle({ ...assets, skills: [water, sand, hex], player: [character({ skillIds: [sand.skill_id, hex.skill_id] })] });
  const raw = go.previewDamage(match, "enemy", water).damage;
  const damage = (result) => result.events.find(e => e.side === "enemy" && e.type === "move").damage;
  action(match, hex.skill_id);
  assert.equal(damage(action(match, sand.skill_id, select())), go.roundHalfDown(raw * 0.5 * 0.5 * 0.75));
  assert.equal(damage(action(match, sand.skill_id, select())), go.roundHalfDown(raw * 0.5 * 0.5 * 0.75));
  assert.equal(match.fields.player.size, 2);
  assert.equal(match.fields.player.get("water_protect").expires, 7);
  assert.equal(go.previewDamage(match, "enemy", water).damage, go.roundHalfDown(raw * 0.5 * 0.75));
  for (; match.turn < 7;) go.resolveTurn(match, { player: wait, enemy: wait });
  assert.equal(go.previewDamage(match, "enemy", water).damage, raw);
});

test("six-point field refresh preserves current coverage and extends the delayed window", () => {
  const guard = skill("skill_025");
  const match = battle({ ...assets, skills: [guard], player: [character({ skillIds: [guard.skill_id] })] });
  action(match, guard.skill_id);
  action(match, guard.skill_id);
  const state = match.fields.player.get("sp_protect");
  assert.deepEqual([state.createdTurn, state.starts, state.expires], [2, 2, 6]);
});

test("芭蕉扇 clears only the other field and tailwind modifies speed until expiry", () => {
  const fan = skill("skill_039"), guard = skill("skill_050");
  const match = battle({ ...assets, skills: [fan, guard], player: [character({ speed: 81, skillIds: [fan.skill_id] }), character({ speed: 91 })],
    enemy: [character({ skillIds: [guard.skill_id] })] });
  const foe = active(match, "enemy");
  foe.statuses.push({ definition: officialEffects.get("poison"), turns: 7 });
  go.changeStage(foe, "phy_def", 1);
  go.changeEnergy(active(match), 4);
  const initial = action(match, fan.skill_id, select(guard.skill_id));
  assert.ok(initial.events.some(e => e.type === "field-cleared" && e.removed.includes("水属性ダメージ軽減")));
  assert.equal(match.fields.enemy.size, 0);
  assert.equal(foe.stages.phy_def, 1);
  assert.equal(foe.statuses[0].turns, 6);
  assert.equal(go.effectiveSpeed(match, "player"), 121);
  go.resolveTurn(match, { player: { type: "switch", index: 1 }, enemy: wait });
  assert.equal(go.effectiveSpeed(match, "player"), 136);
  go.resolveTurn(match, { player: wait, enemy: wait });
  assert.equal(go.effectiveSpeed(match, "player"), 91);
});

test("ブロッサムシャイン applies capped evasion next turn only, including after a miss", () => {
  const shine = skill("skill_034");
  for (const [base, next] of [[25, 50], [50, 100], [85, 100]]) {
    const match = battle({ ...assets, skills: [shine, skill("skill_000")],
      player: [character({ evasion_percent: base, skillIds: [shine.skill_id] }), character()],
      enemy: [character({ evasion_percent: 100 })] });
    go.changeEnergy(active(match), 3);
    assert.equal(go.evasionRate(active(match), 1), base);
    const first = action(match, shine.skill_id, select("skill_000"));
    assert.ok(first.events.some(e => e.type === "evaded"));
    assert.equal(go.evasionRate(active(match), 1), base);
    assert.equal(go.evasionRate(active(match), 2), next);
    if (base === 85) go.resolveTurn(match, { player: { type: "switch", index: 1 }, enemy: wait });
    else go.resolveTurn(match, { player: wait, enemy: wait });
    assert.equal(go.evasionRate(match.teams.player[0], 3), base);
    assert.equal(match.teams.player[0].timedEffects.size, 0);
  }
});

test("binding combines residual and lock, refreshes, coexists with poison, and clears on source switch", () => {
  const coil = skill("skill_052");
  const match = battle({ ...assets, skills: [coil],
    player: [character({ skillIds: [coil.skill_id] }), character()],
    enemy: [character({ hp: 125, element_1: "water" }), character()] });
  const victim = active(match, "enemy");
  victim.statuses.push({ definition: officialEffects.get("poison"), turns: 7 });
  const first = action(match, coil.skill_id);
  assert.equal(first.events.filter(e => e.type === "residual").length, 2);
  assert.equal(victim.bind.turns, 2);
  assert.match(go.checkAction(match, "enemy", { type: "switch", index: 1 }), /締め付け/);
  action(match, coil.skill_id);
  assert.equal(victim.bind.turns, 2);
  const output = go.resolveTurn(match, { player: { type: "switch", index: 1 }, enemy: wait });
  assert.ok(output.events.some(e => e.type === "bind-ended"));
  assert.equal(victim.bind, null);
  assert.equal(go.checkAction(match, "enemy", { type: "switch", index: 1 }), "");
});

test("a bound fighter can be replaced after residual KO, and source KO releases the lock", () => {
  const coil = skill("skill_052");
  for (const sourceDies of [false, true]) {
    const match = battle({ ...assets, skills: [coil], player: [character({ skillIds: [coil.skill_id] }), character({name: "Source bench"})],
      enemy: [character({element_1: "water"}), character({name: "Target bench"})] });
    action(match, coil.skill_id);
    const [a, b] = fighters(match);
    (sourceDies ? a : b).hp = 1;
    if (sourceDies) a.statuses.push({ definition: officialEffects.get("poison"), turns: 1 });
    const turn = go.resolveTurn(match, { player: wait, enemy: wait });
    assert.equal(turn.events.find(e => e.type === "replacement").target, sourceDies ? "Source bench" : "Target bench");
    assert.equal(b.bind, null);
    assert.equal(b.fainted, !sourceDies);
  }
});

test("追い討ち reads the actual target's condition after a switch, excluding bind and stages", () => {
  const pursuit = skill("skill_061");
  const match = battle({ ...assets, skills: [pursuit], player: official("character_022"),
    enemy: [character({element_1: "light"}), character({element_1: "light", name: "Incoming"})] });
  const [source, target] = fighters(match);
  target.bind = { source, turns: 2, definition: officialEffects.get("bind") };
  go.changeStage(target, "sp_def", -1);
  assert.equal(go.previewDamage(match, "player", pursuit).power, 70);
  target.bind = null;
  const incoming = match.teams.enemy[1];
  incoming.statuses.push({ definition: officialEffects.get("poison"), turns: 4 });
  const expected = go.calculateDamage(source, incoming, pursuit, chart, assets);
  assert.equal(expected.power, 100);
  const output = action(match, pursuit.skill_id, { type: "switch", index: 1 });
  assert.equal(output.events.find(e => e.type === "move").damage, expected.damage);
});

test("official teams: 砂煙 persists through a swap, ベノムアシッド poisons the replacement, and residuals finish the fight", () => {
  const match = battle({ ...assets, skills: officialSkills, player: official("character_018", "character_009"),
    enemy: official("character_007") });
  go.changeEnergy(active(match, "enemy"), 6);
  const first = action(match, "skill_050", select("skill_026"));
  assert.ok(first.events.some(e => e.type === "field-applied"));
  const next = go.resolveTurn(match, { player: { type: "switch", index: 1 }, enemy: select("skill_027") });
  assert.ok(next.events.some(e => e.type === "status-applied" && e.name === "毒"));
  assert.equal(active(match).statuses[0].turns, 4);
  const events = [];
  while (!match.winner && match.turn < 25) {
    const enemy = active(match, "enemy").energy >= 3 ? select("skill_027") : select("skill_026");
    const player = active(match).base.skillIds.includes("skill_031") ? select("skill_031") : wait;
    events.push(...go.resolveTurn(match, { player, enemy }).events);
  }
  assert.equal(match.winner, "enemy");
  assert.ok(events.some(e => e.type === "field-expired"));
  assert.ok(events.some(e => e.type === "residual"));
});

test("binding expires after exactly three residuals", () => {
  const coil = skill("skill_059");
  const match = battle({ ...assets, skills: [coil], player: official("character_021"),
    enemy: [character({ hp: 125, element_1: "fire" }), character()] });
  go.changeEnergy(active(match), 1);
  const victim = active(match, "enemy");
  const switchAction = { type: "switch", index: 1 };
  const pass = () => go.resolveTurn(match, { player: wait, enemy: wait });
  for (const result of [action(match, coil.skill_id), pass()]) {
    assert.equal(result.events.find(e => e.type === "residual").damage, 13);
  }
  assert.match(go.checkAction(match, "enemy", switchAction), /締め付け/);
  assert.equal(pass().events.find(e => e.type === "residual").damage, 13);
  assert.equal(victim.bind, null);
  assert.equal(go.checkAction(match, "enemy", switchAction), "");
  assert.ok(!pass().events.some(e => e.type === "residual"));
});

test("direct victory skips residuals and active-side fields survive a forced replacement", () => {
  const sand = skill("skill_050");
  const attack = { ...strike, element: "light", power: 200 };
  const match = battle({ ...assets, skills: [attack, sand],
    player: [character({ element_1: "light" })],
    enemy: [character({ hp: 3, skillIds: [sand.skill_id] }), character({ hp: 1, name: "Bench" })] });
  const result = action(match, "strike", select(sand.skill_id));
  assert.ok(result.events.some(e => e.type === "replacement"));
  assert.equal(active(match, "enemy").energy, 1);
  assert.equal(match.fields.enemy.size, 1);
  const source = active(match);
  source.hp = 1;
  source.statuses.push({ definition: officialEffects.get("poison"), turns: 1 });
  const win = action(match, "strike");
  assert.equal(win.winner, "player");
  assert.equal(source.hp, 1);
  assert.ok(!win.events.some(e => e.type === "residual"));
});

test("legacy water override replaces only the water component without changing STAB", () => {
  const needle = { ...skill("skill_018"), battle_effect1: "bf_water_super_effective", battle_effect_chance1: 100 };
  const effectiveness = new Map(chart).set("thunder", new Map(chart.get("thunder")).set("water", 0.5));
  const match = battle({ ...assets, effectiveness, player: official("character_005"),
    enemy: [character({ element_1: "water", element_2: "earth" })], skills: [needle] });
  const ordinary = go.previewDamage(match, "player", { ...needle, battle_effect1: "none" });
  go.changeEnergy(active(match), 6);
  const preview = go.previewDamage(match, "player", needle);
  assert.equal(ordinary.effectiveness, 0.25);
  assert.equal(preview.effectiveness, 1);
  assert.equal(preview.stab, ordinary.stab);
  assert.equal(action(match, needle.skill_id).events.find(e => e.type === "move").damage, preview.damage);
});

test("Water absorb heals, stops hit effects, and halves non-water attacks", () => {
  const absorb = skill("skill_012"), poison = skill("skill_027"), waterStatus = skill("skill_014");
  const match = battle({ ...assets, skills: [absorb, poison, strike, waterStatus],
    player: [character({ hp: 100, element_1: "earth", skillIds: [absorb.skill_id] })],
    enemy: [character({ skillIds: [poison.skill_id, strike.skill_id, waterStatus.skill_id] })] });
  go.changeEnergy(active(match), 6); go.changeEnergy(active(match, "enemy"), 6);
  active(match).hp = 33;
  const first = action(match, absorb.skill_id, select(poison.skill_id));
  assert.equal(first.events.find(e => e.type === "absorbed").recovered, 67);
  assert.equal(active(match).statuses.length, 0);
  const raw = go.previewDamage(match, "enemy", strike).damage;
  const second = action(match, absorb.skill_id, select());
  assert.equal(second.events.find(e => e.side === "enemy" && e.type === "move").damage, go.roundHalfDown(raw * 0.5));
  const third = action(match, absorb.skill_id, select(waterStatus.skill_id));
  assert.ok(!third.events.some(e => e.type === "absorbed"));
  assert.equal(active(match, "enemy").stages.sp_def, 2);
  assert.equal(active(match).defenses.size, 0);
});

test("evasion and affinity immunity precede absorption; full HP still absorbs", () => {
  const absorb = skill("skill_012"), water = { ...strike, element: "water" };
  const match = battle({ ...assets, skills: [absorb, water],
    player: [character({ skillIds: [absorb.skill_id] })] });
  go.changeEnergy(active(match), 6);
  assert.equal(action(match, absorb.skill_id, select()).events.find(e => e.type === "absorbed").recovered, 0);
  action(match, absorb.skill_id);
  const fighter = active(match);
  fighter.defenses.set("bf_water_absorb_guard", { id: "bf_water_absorb_guard", definition: officialDefense.get("bf_water_absorb_guard"),
    starts: match.turn, expires: match.turn + 1 });
  fighter.dodgeActive = true;
  assert.equal(go.previewDamage(match, "enemy", water).reason, "evaded");
  const waterRow = new Map(chart.get("water")); waterRow.set("fire", 0);
  match.effectiveness = new Map(chart).set("water", waterRow);
  assert.equal(go.previewDamage(match, "enemy", water).reason, "blocked");
});

test("reflection uses post-guard virtual damage and cannot recurse", () => {
  const reflect = skill("skill_030"), hex = skill("skill_025");
  const hit = { ...strike, element: "light", attack_type: "special", effect1: "poison", effect_chance1: 100, effect_target1: "enemy" };
  const match = battle({ ...assets, skills: [reflect, hex, hit],
    player: [character({ skillIds: [reflect.skill_id, hex.skill_id] })] });
  go.changeEnergy(active(match), 5);
  action(match, hex.skill_id);
  const [a, b] = fighters(match);
  b.defenses.set("reflection", { definition: officialDefense.get("reflection"), id: "reflection", starts: 2, expires: 3 });
  const virtual = go.previewDamage(match, "enemy", hit).damage;
  const result = action(match, reflect.skill_id, select());
  assert.equal(result.events.filter(e => e.type === "reflected").length, 1);
  assert.equal(result.events.find(e => e.type === "reflected").damage, Math.round(virtual * 1.5));
  assert.ok(virtual > 0);
  assert.equal(a.hp, a.maxHp);
  assert.equal(a.statuses.length, 0);
  assert.equal(result.winner, null);
  go.changeEnergy(a, 3);
  b.hp = 1;
  assert.equal(action(match, reflect.skill_id, select()).winner, "player");
});

test("physical attacks pass through Ice Reflection without a normal counter", () => {
  const reflect = skill("skill_030");
  const match = battle({ ...assets, skills: [reflect, strike],
    player: [character({ skillIds: [reflect.skill_id] })] });
  go.changeEnergy(active(match), 1);
  const result = action(match, reflect.skill_id, select());
  assert.equal(active(match).hp, 178);
  assert.ok(!result.events.some(e => ["reflected", "revenge"].includes(e.type)));
});

test("Claw Guard returns MHB's rounded damage from a surviving hit", () => {
  const counter = skill("skill_058");
  const match = battle({ ...assets, skills: [counter, strike],
    player: [character({ skillIds: [counter.skill_id] })] });
  go.changeEnergy(active(match), counter.cost - active(match).energy);
  const result = action(match, counter.skill_id, select());
  assert.equal(active(match).hp, 189);
  assert.equal(active(match, "enemy").hp, 183);
  assert.equal(result.events.find(e => e.type === "revenge").damage, 17);
});

test("Poison Needle uses actual damage for recoil, skips a KO target, and can produce a draw", () => {
  const recoil = skill("skill_046");
  for (const bench of [false, true]) {
    const match = battle({ ...assets, skills: [recoil], player: [character({ hp: 4, skillIds: [recoil.skill_id] }),
      ...(bench ? [character({ name: "Reserve" })] : [])], enemy: [character({ hp: 20, element_1: "light" })] });
    go.changeEnergy(active(match), 2);
    const turn = action(match, recoil.skill_id);
    assert.equal(turn.events.find(e => e.type === "move").actualDamage, 20);
    assert.equal(turn.events.find(e => e.type === "recoil").damage, 4);
    assert.equal(turn.events.filter(e => e.type === "faint").length, 2);
    assert.equal(turn.winner, bench ? "player" : "draw");
    assert.equal(active(match, "enemy").statuses.length, 0);
  }
});

test("Poison Needle poisons a surviving target", () => {
  const needle = skill("skill_046");
  const match = battle({ ...assets, skills: [needle], player: [character({ skillIds: [needle.skill_id] })],
    enemy: [character({ hp: 500, element_1: "light" })] });
  go.changeEnergy(active(match), needle.cost - active(match).energy);
  const result = action(match, needle.skill_id);
  const target = active(match, "enemy");
  assert.ok(result.events.some((event) => event.type === "status-applied" && event.side === "enemy" && event.name === "毒"));
  assert.equal(target.statuses.filter(({ definition }) => definition.effect_id === "poison").length, 1);
});

test("zero damage from immunity or evasion never produces recoil", () => {
  const recoil = { ...skill("skill_046"), element: "earth" };
  for (const dodge of [false, true]) {
    const match = battle({ ...assets, skills: [recoil, skill("skill_000")], player: [character({ skillIds: [recoil.skill_id] })],
      enemy: [character({ element_1: dodge ? "fire" : "wind", evasion_percent: 100 })] });
    go.changeEnergy(active(match), 2);
    const result = action(match, recoil.skill_id, dodge ? select("skill_000") : wait);
    assert.ok(!result.events.some(e => e.type === "recoil"));
    assert.equal(active(match).hp, 200);
  }
});

test("charge snapshots pre-cost EN, caps power, uses live stats, and applies first-turn effects once", () => {
  const charge = skill("skill_054");
  const match = battle({ ...assets, skills: [charge], player: [character({ skillIds: [charge.skill_id] }), character()],
    enemy: [character({ hp: 500, element_1: "light" })] });
  const fighter = active(match);
  go.changeEnergy(fighter, 6);
  const first = action(match, charge.skill_id);
  assert.equal(first.events.find(e => e.type === "charge").power, 195);
  assert.equal(fighter.energy, 6);
  assert.equal(fighter.stages.phy_def, 1);
  assert.match(go.checkAction(match, "player", { type: "switch", index: 1 }), /予約行動/);
  go.changeEnergy(fighter, -6);
  go.changeStage(fighter, "phy_atk", 1);
  const predicted = go.previewDamage(match, "player", charge);
  assert.equal(predicted.power, 195);
  assert.equal(predicted.attack, 180);
  const second = action(match, charge.skill_id);
  assert.equal(second.events.find(e => e.type === "move").damage, predicted.damage);
  assert.equal(second.events.find(e => e.type === "move").cost, 0);
  assert.equal(fighter.energy, 1);
  assert.equal(fighter.stages.phy_def, 1);
  assert.equal(fighter.pending, null);
});

test("a queued move does not release if its owner is KO'd first", () => {
  const charge = skill("skill_054");
  const lethal = { ...strike, priority: 2, power: 1000 };
  const match = battle({ ...assets, skills: [charge, lethal], player: [character({ hp: 1, skillIds: [charge.skill_id] }), character()] });
  go.changeEnergy(active(match), 1);
  action(match, charge.skill_id);
  const fighter = active(match);
  const turn = action(match, charge.skill_id, select());
  assert.ok(!turn.events.some(e => e.side === "player" && e.type === "move"));
  assert.equal(fighter.pending, null);
});

test("Psycho Counter uses same-turn direct HP loss and clears history", () => {
  const psycho = skill("skill_057");
  const match = battle({ ...assets, skills: [psycho, strike], player: [character({ skillIds: [psycho.skill_id] })] });
  go.changeEnergy(active(match), 6);
  const first = action(match, psycho.skill_id, select());
  assert.equal(first.events.find(e => e.side === "player" && e.type === "move").power, 120);
  const second = action(match, psycho.skill_id);
  assert.equal(second.events.find(e => e.type === "move").power, 80);
});

test("Phantom hides against ignore_dodge, pierces guards and clears positive ranks only", () => {
  const phantom = skill("skill_062");
  const attack = { ...strike, hit_type: "ignore_dodge", priority: -1 };
  const match = battle({ ...assets, skills: [phantom, attack], player: [character({ skillIds: [phantom.skill_id] })],
    enemy: [character({ hp: 500, element_1: "dark" })] });
  go.changeEnergy(active(match), 6);
  assert.equal(action(match, phantom.skill_id, select()).events.find(e => e.type === "move").reason, "position-miss");
  const [a, b] = fighters(match);
  go.changeStage(b, "phy_atk", 2);
  go.changeStage(b, "sp_def", -1);
  b.halfGuard = 50;
  const field = { definition: { battle_effect_group: "guard", guard_type: "phy_damage", damage_cut: 25 }, starts: 2, expires: 4 };
  match.fields.enemy.set("test-field", field);
  const expected = go.previewDamage(match, "player", phantom);
  assert.equal(expected.damage, go.roundHalfDown(expected.afterEffectiveness * 0.75 * 0.875));
  assert.equal(go.calculateDamage(a, { ...b, base: { ...b.base, element_1: "earth" } }, phantom, chart, assets).damage, 0);
  assert.equal(action(match, phantom.skill_id).events.find(e => e.type === "move").damage, expected.damage);
  assert.equal(b.stages.phy_atk, 0);
  assert.equal(b.stages.sp_def, -1);
});

test("guard break halves individual and field damage cuts without requiring a charge effect", () => {
  const guardBreak = { ...strike, skill_id: "guard-break", hit_type: "guard_break", cost: 0 };
  const match = battle({ skills: [guardBreak], player: [character({ skillIds: [guardBreak.skill_id] })] });
  const target = active(match, "enemy");
  target.halfGuard = 50;
  match.fields.enemy.set("test-field", {
    definition: { battle_effect_group: "guard", guard_type: "phy_damage", damage_cut: 50 }, starts: 1, expires: 2,
  });
  const preview = go.previewDamage(match, "player", guardBreak);
  assert.equal(preview.damage, go.roundHalfDown(preview.afterEffectiveness * 0.75 * 0.75));
  const result = go.resolveTurn(match, { player: select(guardBreak.skill_id), enemy: wait });
  assert.equal(result.events.find((event) => event.type === "move").damage, preview.actualDamage);
});

test("MHB speed thresholds apply to both GO techniques in previews and real turns", () => {
  for (const id of ["skill_015", "skill_056"]) {
    const move = skill(id);
    assert.equal(go.unsupportedMoveReason(move, assets), "");
    for (const [speed, power] of [[99, 30], [100, 60], [150, 72], [200, 78], [300, 90], [450, 90]]) {
      const match = battle({ ...assets, skills: [move], player: [character({ speed, skillIds: [id] })],
        enemy: [character({ speed: 100, hp: 1000 })] });
      assert.equal(go.previewDamage(match, "player", move).power, power);
      assert.equal(action(match, id).events.find(e => e.type === "move").power, power);
    }
    const match = battle({ ...assets, skills: [move], player: [character({ speed: 80, skillIds: [id] })] });
    go.changeStage(active(match), "speed", 1);
    match.fields.player.set("tailwind", {
      definition: { battle_effect_group: "field_speed", damage_value: 1.5 }, starts: 1, expires: 2,
    });
    assert.equal(go.previewDamage(match, "player", move).power, 72);
    const gap = new Map(assets.powerRules);
    gap.set("speed_advantage", gap.get("speed_advantage").slice(1));
    assert.match(go.unsupportedMoveReason(move, { ...assets, powerRules: gap }), /speed_advantage/);
  }
});

test("official burn uses MHB residuals, refreshes once, coexists with poison and pauses on the bench", () => {
  const move = skill("skill_038");
  const match = battle({ ...assets, skills: [move], player: [character({ skillIds: [move.skill_id] })],
    enemy: [character({ hp: 403, sp_def: 1000 }), character()] });
  const target = active(match, "enemy");
  const pass = (enemy = wait) => go.resolveTurn(match, { player: wait, enemy });
  const burn = () => target.statuses.find(({ definition }) => definition.effect_id === "burn");
  const tick = (turn) => turn.events.filter(e => e.type === "residual" && e.name === "火やられ");
  assert.equal(go.unsupportedMoveReason(move, assets), "");
  target.statuses.push({ definition: officialEffects.get("poison"), turns: 2 });
  const first = action(match, move.skill_id);
  assert.equal(first.events.filter(e => e.type === "residual").length, 2);
  assert.equal(tick(first)[0].damage, 20);
  assert.equal(burn().turns, 4);
  const hp = target.hp;
  pass({ type: "switch", index: 1 });
  assert.equal(target.hp, hp);
  assert.equal(burn().turns, 4);
  pass({ type: "switch", index: 0 });
  assert.equal(burn().turns, 3);
  target.hp = target.maxHp;
  assert.equal(tick(action(match, move.skill_id)).length, 1);
  assert.equal(burn().turns, 4);
  for (let i = 0; i < 4; i++) assert.equal(tick(pass())[0].damage, 20);
  assert.equal(burn(), undefined);
  assert.equal(tick(pass()).length, 0);
});

const powerSetup = (element, effectId = "next_" + element + "_power_150") => statusMove({
  skill_id: "setup-" + effectId, name: "Setup", element, battle_effect1: effectId, battle_effect_chance1: 100,
});
const powerEvents = (turn, phase = "used") => turn.events.filter((event) => event.type === "next-power-" + phase);

test("Discharge costs no EN, raises the CSV SD stage and readies Thunder power", () => {
  const move = skill("skill_020");
  const attack = skill("skill_018");
  const match = battle({ ...assets, skills: [move, attack],
    player: [character({ skillIds: [move.skill_id, attack.skill_id], energy_charge: 0 })],
    enemy: [character({ hp: 600, element_1: "water" })] });
  const actor = active(match);
  go.changeEnergy(actor, -actor.energy);
  assert.deepEqual([move.element, move.cost, move.battle_effect_chance1], ["thunder", 0, 100]);
  assert.equal(go.checkAction(match, "player", select(move.skill_id)), "");
  const turn = action(match, move.skill_id);
  assert.deepEqual([actor.energy, actor.stages.sp_def, powerEvents(turn, "ready")[0].element], [0, officialEffects.get(skill("skill_020").effect1).damage_value, "thunder"]);
  go.changeEnergy(actor, attack.cost);
  const result = action(match, attack.skill_id);
  assert.equal(powerEvents(result)[0].power, 120);
  assert.equal(actor.nextElementPower.size, 0);
});

test("all nine elements boost physical and special power, including neutral", () => {
  for (const element of chart.keys()) {
    for (const attack_type of ["physical", "special"]) {
      const setup = powerSetup(element);
      const attack = { ...strike, attack_type, element, cost: 0 };
      const match = battle({ ...assets, skills: [setup, attack],
        player: [character({ element_1: element, skillIds: [setup.skill_id, attack.skill_id] })],
        enemy: [character({ hp: 600, element_1: "none" })] });
      const actor = active(match);
      const base = go.previewDamage(match, "player", attack);
      const granted = action(match, setup.skill_id);
      assert.equal(powerEvents(granted, "ready")[0].element, element);
      const boosted = go.previewDamage(match, "player", attack);
      assert.deepEqual([base.power, boosted.power, boosted.stab], [80, 120, 1.25]);
      assert.equal(actor.nextElementPower.size, 1);
      const turn = action(match, attack.skill_id);
      assert.equal(powerEvents(turn).length, 1);
      assert.equal(turn.events.find(({ type }) => type === "move").actualDamage, boosted.actualDamage);
      assert.equal(actor.nextElementPower.size, 0);
      assert.equal(go.previewDamage(match, "player", attack).power, 80);
    }
  }
});

test("next power persists through other attacks, same-element status, dodge, EN failure and time", () => {
  const setup = powerSetup("none");
  const status = { ...skill("skill_020"), element: "none", battle_effect1: "none" };
  const dodge = skill("skill_000");
  const attack = { ...strike, skill_id: "neutral", element: "none", cost: 4 };
  const match = battle({ ...assets, skills: [setup, status, dodge, attack, strike],
    player: [character({ energy_charge: 0, skillIds: [setup.skill_id, status.skill_id, attack.skill_id, "strike"] })],
    enemy: [character({ hp: 600 })] });
  const actor = active(match);
  action(match, setup.skill_id);
  assert.throws(() => action(match, attack.skill_id), /ENが不足/);
  for (const id of [status.skill_id, dodge.skill_id, strike.skill_id]) {
    assert.equal(powerEvents(action(match, id)).length, 0);
  }
  for (let i = 0; i < 4; i++) idle(match);
  assert.equal(actor.nextElementPower.size, 1);
  assert.equal(go.previewDamage(match, "player", attack).power, 120);
  assert.equal(actor.nextElementPower.size, 1);
});

test("next power is spent on evasion, immunity and passive immunity, but not when KO skips the action", () => {
  for (const [element, defense, passive, reason] of [
    ["fire", "none", "", "evaded"], ["earth", "wind", "", "blocked"], ["fire", "none", "024", "passive-immune"],
  ]) {
    const setup = powerSetup(element);
    const attack = { ...strike, element, cost: 0 };
    const dodge = skill("skill_000");
    const lethal = { ...strike, skill_id: "lethal", power: 1000, priority: 2, cost: 0 };
    const match = passiveBattle({ skills: [setup, attack, dodge, lethal], manualSwitches: true,
      player: [character({ skillIds: [setup.skill_id, attack.skill_id] }), character()],
      enemy: [withPassive(passive, { hp: 600, element_1: defense, evasion_percent: 100, skillIds: [lethal.skill_id] })] });
    const actor = active(match);
    action(match, setup.skill_id);
    const result = action(match, attack.skill_id, reason === "evaded" ? select(dodge.skill_id) : wait);
    assert.equal(powerEvents(result).length, 1);
    assert.equal(result.events.find((e) => e.type === "move" && e.side === "player").reason, reason);
    assert.equal(actor.nextElementPower.size, 0);
    action(match, setup.skill_id);
    const ko = action(match, attack.skill_id, select(lethal.skill_id));
    assert.equal(powerEvents(ko).length, 0);
    assert.equal(actor.fainted, true);
    assert.equal(actor.nextElementPower.size, 0);
  }
});

test("same-element refresh replaces the legacy effect; distinct boosts coexist and do not transfer", () => {
  const legacy = powerSetup("fire", "bf_next_fire_power_150");
  const fire = powerSetup("fire", "test-fire-double");
  const ice = powerSetup("ice");
  const relay = skill("skill_042");
  const battleEffects = new Map(officialDefense).set("test-fire-double", {
    ...officialDefense.get("next_fire_power_150"), battle_effect_id: "test-fire-double", modifier: 2,
  });
  for (const viaRelay of [false, true]) {
    const skills = [legacy, fire, ice, relay, strike];
    const match = battle({ ...assets, battleEffects, skills,
      player: [character({ skillIds: skills.map((move) => move.skill_id) }), character()] });
    const actor = active(match);
    action(match, legacy.skill_id);
    assert.equal(go.previewDamage(match, "player", strike).power, 120);
    assert.equal(powerEvents(action(match, fire.skill_id), "ready")[0].replaced, true);
    action(match, ice.skill_id);
    assert.equal(actor.nextElementPower.size, 2);
    assert.equal(go.previewDamage(match, "player", strike).power, 160);
    action(match, strike.skill_id);
    assert.equal(actor.nextElementPower.has("ice"), true);
    action(match, fire.skill_id);
    go.previewSwitch(match, "player", 1, viaRelay ? "relay" : "normal");
    assert.equal(actor.nextElementPower.size, 2);
    if (viaRelay) {
      go.changeEnergy(actor, 7);
      specialWait(match, relay.skill_id, 1);
    } else go.resolveTurn(match, { player: voluntary(1), enemy: wait });
    assert.equal(actor.nextElementPower.size, 0);
    assert.equal(active(match).nextElementPower.size, 0);
  }
});

test("power combines with variable rules and passives before the cap and is booked once on charge", () => {
  const setup = powerSetup("none");
  const attack = { ...skill("skill_054"), element: "none", power: 100, power_cap: 260,
    battle_effect2: "next_none_power_150", battle_effect_chance2: 100 };
  const match = passiveBattle({ skills: [setup, attack],
    player: [withPassive("006", { skillIds: [setup.skill_id, attack.skill_id] })], enemy: [character({ hp: 600 })] });
  const actor = active(match);
  action(match, setup.skill_id);
  go.changeEnergy(actor, 7);
  const preview = go.previewDamage(match, "player", attack);
  assert.equal(preview.power, 260); // 100 × 1.5 (EN) × 1.2 (passive) × 1.5 (effect), capped at 260
  assert.equal(go.previewRelease(match, "player", attack, preview).power, 260);
  assert.equal(actor.nextElementPower.size, 1);
  const start = action(match, attack.skill_id);
  assert.equal(powerEvents(start).length, 1);
  assert.equal(actor.pending.power, 260);
  assert.equal(powerEvents(start, "ready").length, 1);
  assert.equal(actor.nextElementPower.size, 1);
  const release = action(match, attack.skill_id);
  assert.equal(powerEvents(release).length, 0);
  assert.equal(release.events.find((event) => event.type === "move").power, 260);
  assert.equal(actor.nextElementPower.size, 1);
});

test("normalization re-reads CSV tuning for status probability, damage, duration and guard", () => {
  function definitions(file, id, normalize, changes = {}) {
    return new Map(csv(read("data/" + file + ".csv")).map((row) => [row[id],
      vn(normalize)({ ...row, ...(changes[row[id]] ?? {}) })]));
  }
  function simulate(changed) {
    const effects = definitions("effect", "effect_id", "normalizeEffect", changed ? { poison: { damage_value: "20", turn: "3" } } : {});
    const battleEffects = definitions("battle_effect", "battle_effect_id", "normalizeBattleEffect",
      changed ? { bf_half_guard: { damage_cut: "25", turn: "2" } } : {});
    const raw = csv(read("data/skill.csv")).find(row => row.skill_id === "skill_027");
    const move = normalizeSkill({ ...raw, effect_chance1: changed ? "50" : raw.effect_chance1 }, elements);
    const guard = skill("skill_031");
    const match = battle({ ...assets, effects, battleEffects, skills: [move, guard],
      player: [character({ skillIds: [guard.skill_id], hp: 400 })], enemy: official("character_007"), random: () => 0.25 });
    go.changeEnergy(active(match, "enemy"), 6);
    const first = action(match, guard.skill_id, select(move.skill_id));
    const second = go.previewDamage(match, "enemy", move);
    return [first.events.find(e => e.type === "residual").damage, active(match).statuses[0].turns,
      first.events.find(e => e.category === "attack").damage, second.damage];
  }
  assert.deepEqual(simulate(false), [40, 4, 56, 112]);
  assert.deepEqual(simulate(true), [80, 2, 84, 84]);
  const raw = csv(read("data/skill.csv")).find(row => row.skill_id === "skill_027");
  const move = normalizeSkill({ ...raw, effect_chance1: "50" }, elements);
  const failure = battle({ ...assets, skills: [move], player: official("character_007"), random: () => 0.5 });
  go.changeEnergy(active(failure), 2);
  assert.ok(!action(failure, move.skill_id).events.some(e => e.type === "status-applied"));
});

test("re-read CSV counter, absorb and EN power numbers control the same execution path", () => {
  function loadDefense(overrides) {
    return new Map(csv(read("data/battle_effect.csv")).map((row) => [row.battle_effect_id,
      vn("normalizeBattleEffect")({ ...row, ...(overrides[row.battle_effect_id] ?? {}) })]));
  }
  const battleEffects = loadDefense({ revenge: { damage_value: "200" }, bf_water_absorb_guard: { modifier: "20" } });
  const counter = skill("skill_058"), absorb = skill("skill_012"), charge = skill("skill_054");
  const testBattle = (move, hit = strike, also = {}) => battle({ ...assets, battleEffects, skills: [move, hit],
    player: [character({ skillIds: [move.skill_id] })], ...also });
  const counterBattle = testBattle(counter);
  go.changeEnergy(active(counterBattle), counter.cost - active(counterBattle).energy);
  const response = action(counterBattle, counter.skill_id, select());
  assert.equal(response.events.find(e => e.type === "revenge").damage, 22);
  const healing = testBattle(absorb, { ...strike, element: "water" });
  go.changeEnergy(active(healing), 1);
  active(healing).hp = 25;
  assert.equal(action(healing, absorb.skill_id, select()).events.find(e => e.type === "absorbed").recovered, 40);
  const powerRules = new Map(officialPower);
  const raw = csv(read("data/power_rule.csv")).filter(row => row.power_rule_group === "en_value");
  powerRules.set("en_value", raw.map(row => vn("normalizePowerRule")({
    ...row, power_multiplier: row.min_ratio === "7" ? "2" : row.power_multiplier,
  })));
  const charging = testBattle(charge, strike, { powerRules });
  go.changeEnergy(active(charging), 6);
  assert.equal(action(charging, charge.skill_id).events.find(e => e.type === "charge").power, 200);
});

test("official multi-turn replay combines Water Absorb, reflection, charge and battle resolution", () => {
  const match = battle({ ...assets, skills: officialSkills, player: official("character_003", "character_020"),
    enemy: official("character_007", "character_009") });
  const list = [];
  const turn = (player, enemy) => list.push(...go.resolveTurn(match, { player, enemy }).events);
  turn(wait, wait);
  turn(select("skill_012"), select("skill_026"));
  turn({ type: "switch", index: 1 }, { type: "switch", index: 1 });
  turn(wait, wait);
  turn(select("skill_054"), select("skill_030"));
  turn(select("skill_054"), select("skill_031"));
  for (let i = 0; i < 12 && !match.winner; i++) {
    const player = active(match);
    const move = player.base.skillIds.includes("skill_054") ? "skill_054" : "skill_009";
    turn(!go.checkAction(match, "player", select(move)) ? select(move) : wait, wait);
  }
  assert.ok(list.some(e => e.type === "absorbed"));
  assert.ok(list.some(e => e.type === "charge" && e.move === "猪突猛進"));
  assert.ok(list.some(e => e.type === "move" && e.move === "猪突猛進" && e.cost === 0));
  assert.ok(list.some(e => e.type === "defense-ready" && e.name === "反射"));
  assert.equal(match.winner, "player");
});

const specialTeam = () => official("character_015", "character_001", "character_016");
const voluntary = (index) => ({ type: "switch", index });
const setupSpecial = (options = {}) => battle({ ...assets, skills: [...officialSkills, strike],
  player: specialTeam(), enemy: [character({ hp: 400 })], ...options });
const specialWait = (match, id, switchIndex) => go.resolveTurn(match, {
  player: { ...select(id), switchIndex }, enemy: wait,
});
const full = (fighter) => go.changeEnergy(fighter, 7);

test("Decoy checks HP, uses exact thirds, and rejects duplicate creation without consuming EN", () => {
  const match = setupSpecial();
  const fighter = active(match);
  full(fighter);
  fighter.hp = 72;
  assert.throws(() => specialWait(match, "skill_041"), /HPが不足.*消費は72（最大HP基準）/);
  assert.equal(fighter.energy, 7);
  fighter.hp = 73;
  specialWait(match, "skill_041");
  assert.deepEqual([fighter.hp, fighter.decoy.hp, fighter.decoy.maxHp], [23, 72, 72]);
  assert.throws(() => specialWait(match, "skill_041"), /すでに存在/);
  go.resolveTurn(match, { player: voluntary(1), enemy: wait });
  assert.equal(fighter.decoy, null);
});

test("Decoy takes capped damage without overflow, blocks a debuff, and poison still damages its owner", () => {
  const hit = { ...strike, power: 1000, effect1: "bf_pa_down1", effect_chance1: 100 };
  const match = setupSpecial({ skills: [...officialSkills, hit] });
  const fighter = active(match);
  full(fighter);
  specialWait(match, "skill_041");
  const hp = fighter.hp;
  fighter.statuses.push({ definition: officialEffects.get("poison"), turns: 7 });
  const before = JSON.stringify(fighter);
  const predicted = go.previewDamage(match, "enemy", hit);
  assert.equal(predicted.damage, 0);
  assert.equal(predicted.decoyDamage, 72);
  assert.equal(JSON.stringify(fighter), before);
  const turn = go.resolveTurn(match, { player: wait, enemy: select() });
  assert.equal(turn.events.find(e => e.type === "move").decoyDamage, 72);
  assert.equal(turn.events.find(e => e.type === "move").actualDamage, 0);
  assert.ok(turn.events.some(e => e.type === "decoy-broken"));
  assert.equal(fighter.hp, hp);
  assert.equal(turn.events.find((event) => event.type === "residual").damage, 22);
  assert.equal(turn.events.find((event) => event.source === "natural").recovered, 22);
  assert.equal(fighter.tookDirectDamage, false);
  assert.equal(fighter.stages.phy_atk, 0);
});

test("Decoy damage shares hit, affinity, individual and field mitigation", () => {
  const match = setupSpecial();
  const f = active(match);
  full(f);
  specialWait(match, "skill_041");
  const probe = { ...strike, power: 30 };
  const baseline = go.previewDamage(match, "enemy", probe).decoyDamage;
  f.halfGuard = 50;
  const field = { definition: { battle_effect_group: "guard", guard_type: "phy_damage", damage_cut: 20 }, starts: 2, expires: 4 };
  match.fields.player.set("test-field", field);
  const mitigated = go.previewDamage(match, "enemy", probe).decoyDamage;
  assert.ok(mitigated > 0 && mitigated < baseline);
  f.dodgeActive = true;
  assert.equal(go.previewDamage(match, "enemy", probe).decoyDamage, 0);
  assert.equal(go.previewDamage(match, "enemy", { ...probe, hit_type: "ignore_dodge" }).decoyDamage, mitigated);
  f.base.element_1 = "earth";
  assert.equal(go.previewDamage(match, "enemy", { ...probe, element: "dark", hit_type: "ignore_dodge" }).decoyDamage, 0);
});

test("Decoy is hit before absorption, reflection and counter; damage excludes body-hit history", () => {
  const water = { ...strike, element: "water", attack_type: "special" };
  for (const id of ["bf_water_absorb_guard", "reflection", "revenge"]) {
    const match = setupSpecial();
    const f = active(match);
    f.defenses.set(id, { id, definition: officialDefense.get(id), starts: 1, expires: 2 });
    f.decoy = { hp: 10, maxHp: 10 };
    const preview = go.previewDamage(match, "enemy", water);
    assert.equal(preview.decoyDamage, 10);
    assert.equal(preview.response, null);
    assert.equal(preview.heal, 0);
  }
  const low = { ...strike, priority: -2, element: "light", power: 5 };
  const psycho = skill("skill_057");
  const match = setupSpecial({ player: official("character_014"), skills: [psycho, { ...low, priority: 0 }] });
  active(match).decoy = { hp: 10, maxHp: 10 };
  full(active(match));
  const turn = go.resolveTurn(match, { player: select(psycho.skill_id), enemy: select() });
  assert.equal(turn.events.find(e => e.type === "move" && e.side === "player").power, 80);
});

test("drain and recoil use actual Decoy HP loss while Phantom cannot clear stages through it", () => {
  for (const [user, id, event, expected] of [
    ["character_005", "skill_019", "heal", 5], ["character_016", "skill_046", "recoil", 2],
  ]) {
    const match = setupSpecial({ player: official(user) });
    full(active(match));
    active(match).hp = 25;
    active(match, "enemy").decoy = { hp: 10, maxHp: 10 };
    const result = specialWait(match, id);
    const effect = result.events.find(e => e.type === event);
    assert.equal(effect.recovered ?? effect.damage, expected);
    assert.equal(active(match, "enemy").hp, 400);
  }
  const match = setupSpecial({ player: official("character_023") });
  full(active(match));
  const foe = active(match, "enemy");
  foe.decoy = { hp: 1, maxHp: 1 };
  go.changeStage(foe, "phy_def", 2);
  specialWait(match, "skill_062");
  specialWait(match, "skill_062");
  assert.equal(foe.decoy, null);
  assert.equal(foe.stages.phy_def, 2);
});

test("Tail Purge validates and transfers atomically, then retains the per-fighter use limit after returning", () => {
  const match = setupSpecial();
  const tail = match.teams.player[1];
  go.resolveTurn(match, { player: voluntary(1), enemy: wait });
  full(tail);
  tail.hp = 83;
  assert.match(go.checkAction(match, "player", select("skill_006")), /HPが不足.*消費は83（最大HP基準）/);
  tail.hp = 84;
  tail.decoy = { hp: 1, maxHp: 1 };
  assert.match(go.checkAction(match, "player", select("skill_006")), /すでに存在/);
  tail.decoy = null;
  assert.match(go.checkAction(match, "player", { ...select("skill_006"), switchIndex: 1 }), /交代先/);
  assert.match(go.checkAction(match, "player", { ...select("skill_006"), switchIndex: 99 }), /交代先/);
  const replacement = match.teams.player[2];
  const output = specialWait(match, "skill_006", 2);
  assert.equal(output.events.find(e => e.type === "switch").reason, "tail-purge");
  assert.deepEqual([tail.hp, tail.energy, tail.decoy, replacement.decoy.hp, replacement.hp], [1, 5, null, 41, 139]);
  go.resolveTurn(match, { player: voluntary(1), enemy: wait });
  tail.hp = 125;
  assert.match(go.checkAction(match, "player", select("skill_006")), /使用済み/);
  assert.equal(replacement.decoy, null);
});

test("Tail Purge and Power Relay fail before EN or HP consumption when there is no bench", () => {
  for (const [user, id] of [["character_001", "skill_006"], ["character_015", "skill_042"]]) {
    const match = setupSpecial({ player: official(user) });
    const fighter = active(match);
    full(fighter);
    const before = JSON.stringify(fighter);
    assert.throws(() => specialWait(match, id), /控えがいません/);
    assert.equal(JSON.stringify(fighter), before);
  }
});

test("Power Relay passes positive and negative stages and existing decoy, preserving personal states and field", () => {
  const phases = [];
  const match = setupSpecial({ onSwitch: (e) => phases.push([e.phase, e.reason, e.from.base.name, e.to.base.name]) });
  const [outgoing, incoming] = match.teams.player;
  outgoing.decoy = { hp: 10, maxHp: 30 };
  const ownPoison = { definition: officialEffects.get("poison"), turns: 5 };
  const incomingPoison = { definition: officialEffects.get("poison"), turns: 3 };
  outgoing.statuses.push(ownPoison);
  incoming.statuses.push(incomingPoison);
  go.changeStage(outgoing, "phy_atk", 2);
  go.changeStage(outgoing, "speed", -3);
  go.changeEnergy(incoming, 3);
  incoming.hp = 80;
  match.fields.player.set("test", { id: "test", definition: officialDefense.get("sp_protect"), starts: 1, expires: 4 });
  outgoing.timedEffects.set("test", { starts: 1, expires: 3, definition: officialEffects.get("evasion_up") });
  specialWait(match, "skill_042", 1);
  assert.deepEqual([incoming.stages.phy_atk, incoming.stages.speed, incoming.decoy.hp], [2, -3, 10]);
  assert.deepEqual([incoming.hp, incoming.energy, incoming.statuses[0], ownPoison.turns], [92, 5, incomingPoison, 5]);
  assert.equal(outgoing.stages.phy_atk, 0);
  assert.equal(outgoing.timedEffects.size, 0);
  assert.equal(match.fields.player.size, 1);
  assert.deepEqual(phases.map(([phase, reason]) => [phase, reason]), [
    ["before-switch", "relay"], ["leave", "relay"], ["enter", "relay"], ["after-switch", "relay"],
  ]);
});

test("MHB-style special switches bypass bind, normal switching stays locked", () => {
  for (const [user, id] of [["character_001", "skill_006"], ["character_015", "skill_042"], ["character_016", "skill_045"]]) {
    const match = setupSpecial({ player: [...official(user), character()] });
    const fighter = active(match);
    full(fighter);
    fighter.bind = { source: active(match, "enemy"), turns: 3, definition: officialEffects.get("bind") };
    assert.match(go.checkAction(match, "player", voluntary(1)), /締め付け/);
    const after = specialWait(match, id, 1);
    assert.ok(after.events.some(e => e.type === "switch"));
    assert.equal(fighter.bind, null);
  }
});

test("post-attack switch needs a hit and a surviving user; a decoy hit still qualifies", () => {
  for (const mode of ["evaded", "immune", "no-bench", "decoy", "ko", "counter", "recoil"]) {
    const original = skill("skill_045");
    const move = mode === "recoil" ? { ...original, effect1: "recoil_25", effect_target1: "self", effect_chance1: 100 } : original;
    const field = new Map(chart);
    if (mode === "immune") field.set("wind", new Map(chart.get("wind")).set("fire", 0));
    const match = setupSpecial({ skills: [move], effectiveness: field,
      player: mode === "no-bench" ? official("character_016") : [...official("character_016"), character()],
      enemy: [character({ hp: mode === "ko" ? 1 : 400 }), character()] });
    const [source, foe] = fighters(match);
    if (mode === "evaded") foe.dodgeActive = true;
    if (mode === "decoy") foe.decoy = { hp: 10, maxHp: 10 };
    if (mode === "counter") foe.defenses.set("revenge", { id: "revenge", definition: officialDefense.get("revenge"), starts: 1, expires: 2 });
    if (["counter", "recoil"].includes(mode)) source.hp = 1;
    const result = specialWait(match, move.skill_id);
    assert.equal(result.events.some(e => e.reason === "post-attack" && e.type === "switch"), ["decoy", "ko"].includes(mode), mode);
    assert.equal(source.fainted, ["counter", "recoil"].includes(mode));
  }
});

test("manual post-attack selection pauses ordered action and resumes once against the incoming fighter", () => {
  const match = setupSpecial({ manualSwitches: true,
    player: [...official("character_016", "character_015"), character({ name: "Third" })] });
  full(active(match));
  const energy = active(match, "enemy").energy;
  const first = go.resolveTurn(match, { player: select("skill_045"), enemy: select() });
  assert.equal(first.pendingSwitch.reason, "post-attack");
  assert.equal(first.events.filter(e => e.type === "move").length, 1);
  assert.equal(active(match, "enemy").energy, energy);
  assert.equal(match.turn, 1);
  assert.throws(() => go.continueSwitch(match, "enemy", 1), /交代先/);
  assert.throws(() => go.continueSwitch(match, "player", 0), /交代先/);
  assert.throws(() => go.resolveTurn(match, { player: wait, enemy: wait }), /選択待ち/);
  const result = go.continueSwitch(match, "player", 2);
  assert.equal(result.pendingSwitch, null);
  assert.equal(result.events.find(e => e.type === "move").target, "Third");
  assert.equal(result.events.filter(e => e.type === "energy").length, 2);
  assert.equal(match.turn, 2);
  assert.throws(() => go.continueSwitch(match, "player", 1), /交代先/);
});

test("manual Tail Purge awaits selection without HP or EN cost, and forced replacement resumes after upkeep", () => {
  const match = setupSpecial({ manualSwitches: true, player: [...official("character_001"), character({ name: "Reserve" })] });
  const source = active(match);
  full(source);
  const pending = specialWait(match, "skill_006");
  assert.equal(pending.pendingSwitch.reason, "tail-purge");
  assert.deepEqual([source.hp, source.energy, source.decoy], [125, 7, null]);
  const continued = go.continueSwitch(match, "player", 1);
  assert.equal(continued.events.filter(e => e.type === "decoy-created").length, 1);
  assert.equal(source.hp, 42);
  const reserve = active(match);
  reserve.hp = 1;
  reserve.statuses.push({ definition: officialEffects.get("poison"), turns: 1 });
  const replacement = go.resolveTurn(match, { player: wait, enemy: wait });
  assert.equal(replacement.pendingSwitch.reason, "replacement");
  assert.equal(replacement.events.filter(e => e.type === "energy").length, 1);
  const done = go.continueSwitch(match, "player", 0);
  assert.equal(done.events.filter(e => e.type === "energy").length, 0);
  assert.equal(source.energy, 5);
  assert.equal(active(match), source);
});

test("official GO replay creates, passes and sheds decoys and targets the post-attack replacement", () => {
  const match = setupSpecial({ manualSwitches: true, enemy: official("character_009") });
  const ice = select("skill_029");
  go.resolveTurn(match, { player: wait, enemy: wait });
  const decoy = specialWait(match, "skill_041");
  assert.ok(decoy.events.some(e => e.type === "decoy-created"));
  const relay = specialWait(match, "skill_042");
  assert.equal(relay.pendingSwitch.reason, "relay");
  go.continueSwitch(match, "player", 1);
  assert.ok(active(match).decoy);
  go.resolveTurn(match, { player: voluntary(0), enemy: wait });
  assert.equal(match.teams.player[1].decoy, null);
  go.resolveTurn(match, { player: voluntary(1), enemy: wait });
  const tail = specialWait(match, "skill_006");
  assert.equal(tail.pendingSwitch.reason, "tail-purge");
  go.continueSwitch(match, "player", 2);
  assert.equal(active(match).decoy.maxHp, 41);
  const post = go.resolveTurn(match, { player: select("skill_045"), enemy: ice });
  assert.equal(post.pendingSwitch.reason, "post-attack");
  const finished = go.continueSwitch(match, "player", 0);
  assert.equal(finished.events.find(e => e.type === "move" && e.side === "enemy").target, "ユーズドマウス");
  assert.equal(active(match).decoy, null);
});

const passiveTypes = vm.runInContext("geneOrderPassives.readTypes", context)(csv(read("data/passive_type.csv")));
assert.deepEqual(Array.from(passiveTypes.issues), []);
const normalizeGoPassive = (row, elements, statuses) =>
  vm.runInContext("geneOrderPassives.normalize", context)(row, elements, statuses, passiveTypes);
const officialStatusIds = vm.runInContext("geneOrderStatusIds", context)([...officialEffects.values()]);
const officialPassives = new Map(csv(read("data/passive.csv")).filter((row) => row.name)
  .map((row) => [row.passive_id, normalizeGoPassive(row, elements, officialStatusIds)]));
const withPassive = (number, overrides = {}) => character({ passive_id: "passive_" + number, ...overrides });
const passiveBattle = (options = {}) => battle({ ...assets, passives: officialPassives, ...options });
const passivesIn = (result, phase) => result.events.filter((event) => event.type === "passive" && event.phase === phase);
const idle = (match) => go.resolveTurn(match, { player: wait, enemy: wait });

test("normalizes three GO slots, compound IDs, explicit neutral and MHB's EN alias", () => {
  const row = { passive_id: "synthetic", name: "Three slots",
    passive_type1: "start_energy", target_id1: "en", value1: "3",
    passive_type2: "on_use_element_stat_stage", target_id2: "flash_phy_atk", value2: "1",
    passive_type3: "element_power_multiplier", target_id3: "none", value3: "1.3" };
  const normalized = normalizeGoPassive(row, elements);
  assert.equal(normalized.status, "implemented");
  assert.equal(normalized.effects.length, 3);
  assert.equal(normalized.effects[0].type, "starting_en");
  assert.equal(normalized.effects[0].element, undefined);
  assert.equal(normalized.effects[1].element, "light");
  assert.equal(normalized.effects[1].stat, "phy_atk");
  assert.equal(normalized.effects[2].element, "none");
  assert.equal(officialPassives.get("passive_007").effects[0].element, "none");
  assert.equal(normalizeGoPassive({ ...row, target_id3: "unknown" }, elements).status, "partial");
  assert.equal(normalizeGoPassive({ ...row, passive_type3: "none" }, elements).status, "partial");
  const rows = csv(read("data/passive.csv")).filter(row=>row.name);
  const pending = rows.filter(row=>[1,2,3].every(slot=>!row['passive_type'+slot]||row['passive_type'+slot]==='none')).length;
  assert.equal(officialPassives.size, rows.length);
  assert.deepEqual([...officialPassives.values()].filter(p=>p.status==='partial').map(p=>p.passive_id), []);
  assert.equal([...officialPassives.values()].filter(p=>p.status==='implemented').length, rows.length-pending);
  assert.equal([...officialPassives.values()].filter(p=>p.status==='pending').length, pending);
});

test("starting EN is capped and applies once to every fighter including the bench", () => {
  const team = [withPassive("003"), withPassive("008"), withPassive("013")];
  const match = passiveBattle({ player: team });
  assert.deepEqual(Array.from(match.teams.player, (f) => f.energy), [4, 5, 2]);
  assert.deepEqual(Array.from(match.startEvents, (e) => e.energy), [4, 5, 2]);
  go.resolveTurn(match, { player: voluntary(1), enemy: wait });
  assert.equal(match.teams.player[0].energy, 4);
  assert.equal(active(match).stages.sp_atk, -1);
  go.changeEnergy(match.teams.player[0], -3);
  go.resolveTurn(match, { player: voluntary(0), enemy: wait });
  assert.equal(active(match).energy, 2);
  assert.equal(active(match).stages.sp_atk, 1);
  assert.equal(active(match).passiveState.uses.get(1), 1);
  const capped = normalizeGoPassive({ name: "EN", passive_type1: "starting_en", target_id1: "none", value1: "99" }, elements);
  assert.equal(active(passiveBattle({ player: team, passives: new Map([["passive_003", capped]]) })).energy, 7);
});

test("Fluid Body halves neutral physical and special damage and preserves hit effects", () => {
  for (const attack_type of ["physical", "special"]) {
    const move = { ...strike, attack_type, element: "none", cost: 0,
      effect1: "bf_pd_down1", effect_target1: "enemy", effect_chance1: 100 };
    const match = passiveBattle({ skills: [move], enemy: [withPassive("007", { hp: 600, element_1: "water" })] });
    const [attacker, defender] = fighters(match);
    const unprotected = { ...defender, passiveEffects: [] };
    const expected = go.calculateDamage(attacker, unprotected, move, chart, { finalMultiplier: 0.5 });
    const snapshot = JSON.stringify(defender);
    const preview = go.previewDamage(match, "player", move);
    const candidate = ai.evaluate(ai.observe(match, "player")).find((entry) => entry.move?.skill_id === move.skill_id);
    assert.equal(preview.reason, "hit");
    assert.equal(preview.damage, expected.damage);
    assert.equal(candidate.damage, preview.actualDamage);
    assert.equal(JSON.stringify(defender), snapshot);
    assert.equal(defender.passiveState.uses.size, 0);
    const hp = defender.hp;
    const round = action(match);
    assert.equal(hp - defender.hp, preview.actualDamage);
    assert.equal(defender.stages.phy_def, -1);
    assert.equal(passivesIn(round, "element-immunity").length, 0);
    assert.equal(passivesIn(round, "incoming-damage").length, 1);
    defender.halfGuard = 50;
    assert.equal(go.previewDamage(match, "player", move).damage,
      go.calculateDamage(attacker, { ...defender, passiveEffects: [] }, move, chart, { finalMultiplier: 0.25 }).damage);
    const water = { ...move, element: "water" };
    assert.equal(go.calculateDamage(attacker, defender, water, chart).damage,
      go.calculateDamage(attacker, { ...defender, passiveEffects: [] }, water, chart).damage);
  }
});

test("Fluid Body allows neutral status moves and keeps evasion and minimum damage", () => {
  const status = { ...skill("skill_001"), cost: 0 };
  const move = { ...strike, element: "none", cost: 0 };
  const match = passiveBattle({ skills: [status, move],
    player: [character({ skillIds: [status.skill_id, move.skill_id] })], enemy: [withPassive("007")] });
  const target = active(match, "enemy");
  const round = action(match, status.skill_id);
  assert.equal(target.stages.phy_atk, -1);
  assert.equal(passivesIn(round, "incoming-damage").length, 0);
  target.dodgeActive = true;
  assert.equal(go.previewDamage(match, "player", move).reason, "evaded");
  assert.equal(passivesIn(action(match), "incoming-damage").length, 0);
  assert.equal(go.calculateDamage(active(match), target, { ...move, power: 1, hit_type: "ignore_dodge" }, chart,
    { finalMultiplier: 0.001 }).damage, 1);
});

test("elemental immunity blocks water and fire before dodge, absorption, reflection or decoy", () => {
  for (const [id, element] of [["002", "water"], ["024", "fire"]]) {
    const move = { ...strike, element, attack_type: "special", effect1: "bf_pd_down1", effect_target1: "enemy", effect_chance1: 100 };
    const match = passiveBattle({ skills: [move], enemy: [withPassive(id, { element_1: "earth", element_2: "dark" })] });
    const target = active(match, "enemy");
    target.dodgeActive = true;
    target.halfGuard = 50;
    target.decoy = { hp: 20, maxHp: 20 };
    for (const defenseId of ["bf_water_absorb_guard", "reflection", "revenge"]) {
      target.defenses.set(defenseId, { id: defenseId, starts: 1, expires: 2, definition: officialDefense.get(defenseId) });
    }
    const preview = go.previewDamage(match, "player", move);
    assert.deepEqual([preview.reason, preview.damage, preview.decoyDamage], ["passive-immune", 0, 0]);
    assert.equal(target.passiveState.uses.size, 0);
    const round = action(match);
    assert.equal(passivesIn(round, "element-immunity").length, 1);
    assert.deepEqual([target.hp, target.decoy.hp, target.stages.phy_def], [target.maxHp, 20, 0]);
    assert.equal(round.events.some((e) => ["absorbed", "evaded", "reflected", "revenge", "decoy-hit"].includes(e.type)), false);
  }
});

test("elemental use-stage passives exclude status moves and apply to executed attacks", () => {
  for (const [id, element, stat, delta, mode] of [
    ["004", "wind", "speed", 1, "evaded"], ["009", "ice", "phy_def", 1, "hit"],
    ["011", "light", "phy_atk", 1, "status"], ["012", "fire", "phy_atk", 1, "hit"],
    ["013", "fire", "phy_atk", 1, "hit"], ["006", "none", "phy_atk", -1, "hit"],
  ]) {
    const move = { ...(mode === "status" ? { ...skill("skill_060"), skill_id: "strike" } : strike), element, cost: 0 };
    const enemyPassive = mode === "immune" ? (element === "water" ? "002" : "007") : "";
    const match = passiveBattle({ skills: [move], player: [withPassive(id)],
      enemy: [withPassive(enemyPassive, { element_1: "light" })] });
    active(match, "enemy").dodgeActive = mode === "evaded";
    const result = action(match);
    assert.equal(active(match).stages[stat], mode === "status" ? 0 : delta, id);
    assert.equal(passivesIn(result, "after-use").length, mode === "status" ? 0 : 1, id);
  }
  const status = { ...skill("skill_001"), element: "water" };
  const match = passiveBattle({ skills: [status], player: [withPassive("009", { skillIds: [status.skill_id] })],
    enemy: [withPassive("002")] });
  const result = action(match, status.skill_id);
  assert.equal(active(match, "enemy").stages.phy_atk, -1);
  assert.equal(passivesIn(result, "element-immunity").length, 0);
});

test("neutral power modifies move power before damage and self PA falls after the hit", () => {
  const neutral = { ...strike, element: "none", power: 80 };
  const options = { skills: [neutral], player: [withPassive("006", { element_1: "none" })] };
  const match = passiveBattle(options);
  const attacker = active(match);
  const preview = go.previewDamage(match, "player", neutral);
  const baseline = go.previewDamage(battle({ ...options, skills: [{ ...neutral, power: 96 }] }), "player", { ...neutral, power: 96 });
  assert.equal(preview.power, 96);
  assert.equal(preview.damage, baseline.damage);
  assert.equal(attacker.passiveState.uses.size, 0);
  const result = action(match);
  assert.equal(result.events.find((e) => e.type === "move").actualDamage, preview.damage);
  assert.equal(passivesIn(result, "power").length, 1);
  assert.equal(attacker.stages.phy_atk, -1);
});

test("stage immunity blocks hostile PD drops only, including a future external passive caller", () => {
  const spiral = skill("skill_013");
  const self = { ...spiral, skill_id: "self-pd", element: "fire", effect_target1: "self", cost: 0 };
  const clear = { ...skill("skill_001"), skill_id: "clear", effect1: "clear_buff", cost: 0 };
  const match = passiveBattle({ skills: [spiral, self, clear], player: [withPassive("010", { skillIds: [self.skill_id] }), character()],
    enemy: [character({ skillIds: [spiral.skill_id, clear.skill_id] })] });
  const [holder, foe] = fighters(match);
  full(foe);
  assert.equal(passivesIn(go.resolveTurn(match, { player: wait, enemy: select(spiral.skill_id) }), "before-stage").length, 1);
  assert.equal(holder.stages.phy_def, 0);
  assert.equal(go.changeStage(holder, "phy_def", -2, { source: foe }), 0);
  assert.equal(go.changeStage(holder, "phy_def", -1, { source: holder }), -1);
  action(match, self.skill_id);
  assert.equal(holder.stages.phy_def, -2);
  go.changeStage(holder, "phy_def", 4);
  go.resolveTurn(match, { player: wait, enemy: select(clear.skill_id) });
  assert.equal(holder.stages.phy_def, 0);
  go.changeStage(holder, "phy_def", 1);
  go.resolveTurn(match, { player: voluntary(1), enemy: wait });
  assert.equal(holder.stages.phy_def, 0);
});

test("Revive is a pure prediction and consumes one per individual on full-HP direct lethal damage", () => {
  const lethal = { ...strike, power: 900, cost: 0 };
  const revive = withPassive("001", { hp: 40 });
  const options = { player: [revive, revive], skills: [lethal], manualSwitches: true };
  const match = passiveBattle(options);
  const [first, second] = match.teams.player;
  first.hp--;
  assert.equal(go.previewDamage(match, "enemy", lethal).survival, null);
  first.hp++;
  function snapshot() {
    return JSON.stringify(match, (_, value) => value instanceof Map || Object.prototype.toString.call(value) === "[object Map]" ? [...value] : value);
  }
  const before = snapshot();
  for (let n = 0; n < 3; n++) {
    const prediction = go.previewDamage(match, "enemy", lethal);
    assert.ok(prediction.survival);
    assert.equal(prediction.damage, 39);
  }
  assert.equal(snapshot(), before);
  const hit = () => go.resolveTurn(match, { player: wait, enemy: select() });
  const triggering = hit();
  assert.equal(triggering.events.find((e) => e.type === "move").actualDamage, 39);
  assert.match(passivesIn(triggering, "before-hp-damage")[0].text, /HPが1残った！/);
  assert.equal(first.hp, 1);
  assert.equal(first.passiveState.uses.get(1), 1);
  assert.equal(second.passiveState.uses.size, 0);
  go.resolveTurn(match, { player: voluntary(1), enemy: wait });
  go.resolveTurn(match, { player: voluntary(0), enemy: wait });
  first.hp = first.maxHp;
  const defeated = hit();
  assert.equal(passivesIn(defeated, "before-hp-damage").length, 0);
  assert.equal(defeated.pendingSwitch.reason, "replacement");
  go.continueSwitch(match, "player", 1);
  assert.equal(passivesIn(hit(), "before-hp-damage").length, 1);
  assert.equal(active(passiveBattle(options)).passiveState.uses.size, 0);
});

test("decoy takes direct damage without spending Revive, which only counts body HP loss for drain and recoil", () => {
  const recoil = { ...officialEffects.get("bf_pd_down1"), effect_id: "fixture_recoil", effect_group: "recoil", damage_type: "actual_damage_percent", damage_value: 100 };
  const drain = { target_stat: "hp", effect_id: "fixture_drain", effect_group: "heal", damage_type: "actual_damage_percent", damage_value: 100 };
  const match = passiveBattle({ player: [withPassive("001", { hp: 20 })],
    enemy: [character({ hp: 100 })], skills: [{ ...strike, power: 900, cost: 0 }],
    effects: new Map([...officialEffects, [recoil.effect_id, recoil], [drain.effect_id, drain]]) });
  const [holder, foe] = fighters(match);
  holder.decoy = { hp: 10, maxHp: 10 };
  const hit = () => go.resolveTurn(match, { player: wait, enemy: select() });
  assert.equal(passivesIn(hit(), "before-hp-damage").length, 0);
  assert.equal(holder.hp, 20);
  const lethal = match.skills.get("strike");
  Object.assign(lethal, { effect1: "fixture_drain", effect_target1: "self", effect_chance1: 100,
    effect2: "fixture_recoil", effect_target2: "self", effect_chance2: 100 });
  foe.hp = 40;
  const result = hit();
  assert.equal(result.events.find((e) => e.type === "move").actualDamage, 19);
  assert.equal(result.events.find((e) => e.type === "heal").recovered, 19);
  assert.equal(result.events.find((e) => e.type === "recoil").damage, 19);
  assert.equal(foe.hp, 40);
});

test("poison and binding precede living active fighters' two end stages and EN, then replacement resumes once", () => {
  const match = passiveBattle({ player: [withPassive("014"), withPassive("005")],
    enemy: [withPassive("014"), withPassive("005")], manualSwitches: true });
  const [holder, foe] = fighters(match);
  holder.statuses.push({ definition: officialEffects.get("poison"), turns: 1 });
  holder.bind = { source: foe, turns: 1, definition: officialEffects.get("bind") };
  foe.hp = 1;
  foe.statuses.push({ definition: officialEffects.get("poison"), turns: 1 });
  const result = idle(match);
  const eventKinds = Array.from(result.events, (e) => e.type);
  assert.equal(eventKinds.filter((type) => type === "residual").length, 3);
  assert.ok(eventKinds.lastIndexOf("residual") < eventKinds.indexOf("passive"));
  assert.ok(eventKinds.lastIndexOf("passive") < eventKinds.indexOf("energy"));
  assert.deepEqual([holder.stages.phy_def, holder.stages.sp_atk, holder.stages.sp_def], [0, 1, -1]);
  assert.equal(foe.passiveState.uses.size, 0);
  assert.equal(match.teams.player[1].passiveState.uses.size, 0);
  assert.equal(result.pendingSwitch.reason, "replacement");
  assert.equal(passivesIn(go.continueSwitch(match, "enemy", 1), "turn-end").length, 0);
  assert.equal(active(match, "enemy").stages.phy_atk, 0);
});

test("Revive cannot prevent residual KO even at full HP", () => {
  const match = passiveBattle({ player: [withPassive("001", { hp: 1 })] });
  const holder = active(match);
  holder.statuses.push({ definition: officialEffects.get("poison"), turns: 1 });
  assert.equal(passivesIn(idle(match), "before-hp-damage").length, 0);
  assert.equal(holder.fainted, true);
});

test("charge spends after-use and power triggers at reservation only and skips a KO'd actor", () => {
  const charge = { ...skill("skill_054"), element: "none" };
  const lethal = { ...strike, priority: 2, power: 900, cost: 0 };
  const match = passiveBattle({ skills: [charge, lethal], player: [withPassive("006", { skillIds: [charge.skill_id] }), character()],
    enemy: [character({ hp: 1000 })] });
  const holder = active(match);
  full(holder);
  const base = go.previewDamage(battle({ ...assets, skills: [charge], player: [holder.base] }), "player", charge);
  assert.equal(base.reason, "charging");
  const first = action(match, charge.skill_id);
  assert.equal(passivesIn(first, "after-use").length, 1);
  assert.equal(passivesIn(first, "power").length, 1);
  assert.equal(holder.stages.phy_atk, -1);
  const reserved = holder.pending.power;
  assert.equal(go.previewDamage(match, "player", charge).power, reserved);
  const second = action(match, charge.skill_id);
  assert.equal(passivesIn(second, "after-use").length + passivesIn(second, "power").length, 0);
  assert.equal(holder.stages.phy_atk, -1);
  holder.hp = 1;
  full(holder);
  const stopped = action(match, charge.skill_id, select());
  assert.ok(stopped.events.some((e) => e.type === "skipped"));
  assert.equal(passivesIn(stopped, "after-use").length + passivesIn(stopped, "power").length, 0);
});

test("special status switches do not trigger use stages while attacking switches trigger once", () => {
  for (const [moveId, reason] of [["skill_006", "tail-purge"], ["skill_042", "relay"], ["skill_045", "post-attack"]]) {
    const move = { ...skill(moveId), element: "wind" };
    const match = passiveBattle({ manualSwitches: true, skills: [move],
      player: [withPassive("004", { skillIds: [moveId] }), withPassive("005")],
      enemy: [character({ hp: 500 })] });
    const outgoing = active(match);
    full(outgoing);
    const first = action(match, moveId);
    assert.equal(first.pendingSwitch.reason, reason);
    assert.equal(passivesIn(first, "after-use").length, reason === "post-attack" ? 1 : 0);
    const second = go.continueSwitch(match, "player", 1);
    assert.equal(passivesIn(first, "after-use").length + passivesIn(second, "after-use").length, move.category === "attack" ? 1 : 0);
    assert.equal(passivesIn(second, "turn-end").length, 1);
    assert.equal(outgoing.passiveState.uses.get(1) ?? 0, move.category === "attack" ? 1 : 0);
    assert.equal(active(match).stages.speed, 0);
  }
});

test("official GO teams replay starting EN, elemental immunity, a normal switch and turn-end stages", () => {
  const match = passiveBattle({ skills: officialSkills, player: official("character_003", "character_002"),
    enemy: official("character_007", "character_005") });
  assert.equal(active(match).energy, 4);
  const results = [];
  results.push(idle(match));
  results.push(idle(match));
  results.push(go.resolveTurn(match, { player: voluntary(1), enemy: select("skill_027") }));
  results.push(go.resolveTurn(match, { player: wait, enemy: voluntary(1) }));
  results.push(idle(match));
  assert.equal(active(match).base.name, "メイジェリー");
  assert.equal(active(match).hp, active(match).maxHp);
  assert.equal(passivesIn(results[2], "element-immunity").length, 1);
  assert.equal(active(match).statuses.length, 0);
  assert.equal(active(match, "enemy").stages.phy_atk, 2);
  assert.equal(match.turn, 6);
});


test("Revive excludes reflection, counter, recoil and HP paid for a decoy", () => {
  for (const defenseId of ["reflection", "revenge", null]) {
    const recoil = { effect_id: "lethal_recoil", effect_group: "recoil",
      damage_type: "actual_damage_percent", damage_value: 100 };
    const move = { ...strike, element: "water", attack_type: "special", power: 400, cost: 0,
      ...(defenseId ? {} : { effect1: recoil.effect_id, effect_target1: "self", effect_chance1: 100 }) };
    const match = passiveBattle({ skills: [move], player: [withPassive("001", { hp: 1 })],
      enemy: [character({ hp: 1000 })], effects: new Map([[recoil.effect_id, recoil]]) });
    const foe = active(match, "enemy");
    if (defenseId) foe.defenses.set(defenseId, { id: defenseId, starts: 1, expires: 2, definition: officialDefense.get(defenseId) });
    const result = action(match);
    assert.equal(active(match).fainted, true, defenseId);
    assert.equal(passivesIn(result, "before-hp-damage").length, 0);
  }
  const decoy = setupSpecial({ passives: officialPassives, player: [...official("character_001"), character()] });
  const holder = active(decoy);
  full(holder);
  const result = specialWait(decoy, "skill_006", 1);
  assert.equal(holder.hp, 42);
  assert.equal(passivesIn(result, "before-hp-damage").length, 0);
});

test("Revive tests lethality after half guard and the field multiplier", () => {
  const match = passiveBattle({ player: [withPassive("001", { hp: 50, element_1: "thunder" })],
    enemy: [character({ element_1: "fire" })] });
  const holder = active(match);
  assert.ok(go.previewDamage(match, "enemy", strike).survival);
  holder.halfGuard = 50;
  assert.equal(go.previewDamage(match, "enemy", strike).survival, null);
  const field = officialDefense.get("sp_protect");
  assert.ok(field);
  match.fields.player.set(field.battle_effect_id, { definition: field, starts: 1, expires: 3 });
  const guarded = go.previewDamage(match, "enemy", { ...strike, power: 125, attack_type: "special" });
  const unguarded = go.calculateDamage(active(match, "enemy"), holder, { ...strike, power: 125, attack_type: "special" }, chart);
  assert.ok(unguarded.survival);
  assert.equal(guarded.survival, null);
  assert.ok(guarded.damage < unguarded.damage);
});

test("perception reacts twice to a surviving light body hit, never to other attack paths", () => {
  const light = { ...strike, element: "light", attack_type: "special", cost: 0 };
  for (const mode of ["hit", "other", "status", "decoy", "evade", "reflection", "immune", "lethal"]) {
    const move = mode === "status" ? { ...skill("skill_001"), skill_id: "strike", element: "light" } :
      { ...light, element: mode === "other" ? "fire" : "light", power: mode === "lethal" ? 900 : 40 };
    const base = officialPassives.get("passive_015");
    const passive = { ...base, effects: mode === "immune" ? [...base.effects,
      { ...officialPassives.get("passive_024").effects[0], element: "light", slot: 3 }] : base.effects };
    const match = passiveBattle({ enemy: [withPassive("015")], skills: [move],
      passives: new Map([["passive_015", passive]]) });
    const target = active(match, "enemy");
    if (mode === "decoy") target.decoy = { hp: 20, maxHp: 20 };
    if (mode === "evade") target.dodgeActive = true;
    if (mode === "reflection") target.defenses.set("reflection",
      { id: "reflection", starts: 1, expires: 2, definition: officialDefense.get("reflection") });
    const turn = action(match);
    assert.equal(passivesIn(turn, "body-hit").length, mode === "hit" ? 2 : 0, mode);
    assert.equal(target.stages.speed, mode === "hit" ? 1 : 0, mode);
    assert.equal(target.stages.phy_atk, mode === "hit" ? 1 : mode === "status" ? -1 : 0, mode);
  }
});

test("entry debuffs both initial fighters and activates on normal switch but not on the bench", () => {
  const same = withPassive("016");
  const match = passiveBattle({ player: [same, same], enemy: [same] });
  assert.deepEqual(Array.from(match.startEvents, (e) => e.side), ["player", "enemy"]);
  assert.deepEqual(fighters(match).map((fighter) => fighter.stages.speed), [-1, -1]);
  const incoming = match.teams.player[1];
  assert.equal(incoming.passiveState.uses.size, 0);
  const turn = go.resolveTurn(match, { player: voluntary(1), enemy: wait });
  assert.equal(passivesIn(turn, "entry").length, 1);
  assert.equal(active(match, "enemy").stages.speed, -2);
  assert.equal(incoming.stages.speed, 0);
});

test("entry debuffs fire once on each special switch and see the incoming Relay state", () => {
  for (const id of ["skill_006", "skill_042", "skill_045"]) {
    const phases = [];
    const move = skill(id);
    const match = passiveBattle({ skills: [move], manualSwitches: true,
      player: [character({ skillIds: [id] }), withPassive("016")],
      enemy: [character({ hp: 1000 })], onSwitch: ({ phase }) => phases.push(phase) });
    const outgoing = active(match);
    go.changeStage(outgoing, "speed", 2);
    full(outgoing);
    const pending = action(match, id);
    assert.ok(pending.pendingSwitch);
    assert.equal(passivesIn(pending, "entry").length, 0);
    assert.equal(passivesIn(go.continueSwitch(match, "player", 1), "entry").length, 1);
    assert.equal(active(match).stages.speed, id === "skill_042" ? 2 : 0);
    assert.equal(active(match, "enemy").stages.speed, -1);
    assert.deepEqual(phases, ["before-switch", "leave", "enter", "after-switch"]);
  }
});

test("both manual replacements are selected before entry passives resolve against the two new actives", () => {
  const holder = withPassive("016");
  const match = passiveBattle({ player: [character(), holder], enemy: [character(), holder], manualSwitches: true });
  const [outgoingPlayer, outgoingEnemy] = fighters(match);
  for (const fighter of [outgoingPlayer, outgoingEnemy]) {
    fighter.hp = 1;
    fighter.statuses.push({ definition: officialEffects.get("poison"), turns: 1 });
  }
  assert.equal(idle(match).pendingSwitch.side, "player");
  const midway = go.continueSwitch(match, "player", 1);
  assert.equal(midway.pendingSwitch.side, "enemy");
  assert.equal(midway.events.length, 0);
  assert.deepEqual(fighters(match), [outgoingPlayer, outgoingEnemy]);
  const events = go.continueSwitch(match, "enemy", 1).events;
  assert.deepEqual(Array.from(events, (e) => e.type), ["replacement", "replacement", "passive", "passive"]);
  assert.deepEqual(fighters(match).map((fighter) => fighter.stages.speed), [-1, -1]);
  assert.deepEqual(fighters(match).map((fighter) => fighter.passiveState.uses.get(1)), [1, 1]);
});

test("conditional attack stats use exact half HP, stage multipliers, and current HP after recovery", () => {
  const shell = skill("skill_033");
  const match = passiveBattle({ skills: [strike, shell], player: [withPassive("017", { hp: 201, phy_atk: 101 })] });
  const [holder] = fighters(match);
  go.changeStage(holder, "phy_atk", 1);
  holder.hp = 101;
  assert.equal(go.statValue(holder, "phy_atk"), 151);
  holder.hp--;
  assert.equal(go.statValue(holder, "phy_atk"), 181);
  assert.equal(go.statValue(holder, "sp_atk"), 192);
  assert.equal(go.previewDamage(match, "player", shell).attack, holder.base.phy_def);
  const predicted = go.previewDamage(match, "player", strike);
  const turn = action(match);
  assert.equal(turn.events.find((e) => e.type === "move").damage, predicted.damage);
  assert.equal(passivesIn(turn, "stat-multiplier").length, 1);
  holder.hp++;
  assert.equal(go.statValue(holder, "phy_atk"), 151);
  assert.equal(go.statValue(holder, "sp_atk"), 160);
  holder.hp = 100;
  holder.maxHp = 200;
  assert.equal(go.statValue(holder, "phy_atk"), 181);
});

test("hunter speed uses exact one third, rank and Tailwind, and fixes order at turn start", () => {
  const match = passiveBattle({ player: [withPassive("018", { speed: 101 })],
    enemy: [character({ hp: 200, speed: 160 })] });
  const [holder, foe] = fighters(match);
  foe.hp = 67;
  assert.equal(go.effectiveSpeed(match, "player"), 101);
  foe.hp--;
  assert.equal(go.effectiveSpeed(match, "player"), 151);
  go.changeStage(holder, "speed", 1);
  const wind = officialDefense.get("追い風");
  match.fields.player.set(wind.battle_effect_id, { definition: wind, starts: 1, expires: 3 });
  assert.equal(go.effectiveSpeed(match, "player"), 340);
  go.changeStage(holder, "speed", -1);
  match.fields.player.clear();
  foe.base.speed = 130;
  const snap = go.effectiveSpeed(match, "player");
  const turn = go.resolveTurn(match, { player: select(), enemy: select() });
  assert.equal(turn.events.find((e) => e.type === "move").side, "player");
  assert.equal(passivesIn(turn, "stat-multiplier")[0].stat, "speed");
  assert.equal(snap, 151);
  const boundary = passiveBattle({ player: [withPassive("018")],
    enemy: [character({ hp: 210, speed: 120 })] });
  active(boundary, "enemy").hp = 71;
  const early = go.resolveTurn(boundary, { player: select(), enemy: select() });
  assert.equal(early.events.find((e) => e.type === "move").side, "enemy");
  assert.equal(passivesIn(early, "stat-multiplier").length, 0);
  active(boundary, "enemy").hp = 70;
  assert.equal(go.effectiveSpeed(boundary, "player"), 150);
});

test("metabolism uses only the live status collection and multiplies each stat once", () => {
  const match = passiveBattle({ enemy: [withPassive("019")] });
  const [, foe] = fighters(match);
  const poison = officialEffects.get("poison");
  foe.bind = { turns: 1, definition: officialEffects.get("bind") };
  foe.halfGuard = 50;
  go.changeStage(foe, "phy_def", -1);
  assert.equal(go.statValue(foe, "phy_def"), 66);
  foe.statuses.push({ definition: poison, turns: 2 }, { definition: poison, turns: 2 });
  assert.equal(go.statValue(foe, "phy_def"), 100);
  assert.equal(go.statValue(foe, "sp_def"), 165);
  const preview = go.previewDamage(match, "player", strike);
  assert.equal(preview.defense, 100);
  assert.equal(foe.passiveState.uses.size, 0);
  const round = action(match);
  assert.equal(passivesIn(round, "stat-multiplier").length, 1);
  foe.statuses = [];
  assert.equal(go.statValue(foe, "phy_def"), 66);
  assert.equal(go.statValue(foe, "sp_def"), 110);
});

test("priority cost uses max HP and is included in preview without spending HP, EN or RNG", () => {
  const moves = [-1, 0, 1, 2].map((priority) => ({ ...strike, priority }));
  for (const move of moves) {
    const match = passiveBattle({ player: [withPassive("020", { hp: 157 })],
      skills: [move], random: () => { throw Error("unexpected RNG"); } });
    const holder = active(match);
    const preview = go.previewDamage(match, "player", move);
    assert.equal(holder.hp, 157);
    assert.equal(holder.energy, 1);
    assert.equal(holder.passiveState.uses.size, 0);
    const turn = action(match);
    assert.equal(holder.hp, move.priority >= 1 ? 142 : 157);
    assert.equal(passivesIn(turn, "move-cost").length, move.priority >= 1 ? 1 : 0);
    assert.equal(turn.events.find((e) => e.type === "move").damage, preview.damage);
  }
});

test("priority cost can KO before a move, cancels the hit and allows normal replacement", () => {
  const move = { ...strike, priority: 1 };
  const match = passiveBattle({ player: [withPassive("020"), withPassive("016")], manualSwitches: true, skills: [move] });
  const [holder, foe] = fighters(match);
  holder.hp = 20;
  assert.equal(go.previewDamage(match, "player", move).reason, "hp-cost-faint");
  const turn = go.resolveTurn(match, { player: select(), enemy: select() });
  assert.equal(turn.pendingSwitch.reason, "replacement");
  assert.equal(passivesIn(turn, "move-cost")[0].damage, 20);
  assert.equal(turn.events.filter((e) => e.type === "move").length, 0);
  assert.equal(holder.energy, 0);
  assert.equal(foe.hp, foe.maxHp);
  assert.equal(passivesIn(go.continueSwitch(match, "player", 1), "entry").length, 1);

  const focus = skill("skill_060");
  const self = passiveBattle({ skills: [move, focus], player: [withPassive("020"), character()],
    enemy: [character({ skillIds: [focus.skill_id] })] });
  active(self).hp = 20;
  const after = action(self, "strike", select(focus.skill_id));
  assert.equal(after.events.filter((event) => event.type === "faint").length, 1);
  assert.equal(active(self, "enemy").stages.sp_atk, 2);
});

test("priority cost is paid once when charging, during dodge, and after a special switch choice", () => {
  const charge = skill("skill_054"), dodge = skill("skill_000"), relay = { ...skill("skill_042"), priority: 1 };
  const match = passiveBattle({ skills: [charge, dodge, relay], manualSwitches: true,
    player: [withPassive("020", { skillIds: [charge.skill_id, relay.skill_id] }), character()],
    enemy: [character({ hp: 500 })] });
  const holder = active(match);
  full(holder);
  assert.equal(passivesIn(action(match, charge.skill_id), "move-cost").length, 1);
  assert.equal(passivesIn(action(match, charge.skill_id), "move-cost").length, 0);
  assert.equal(holder.hp, 180);
  assert.equal(passivesIn(action(match, dodge.skill_id), "move-cost").length, 1);
  assert.equal(holder.hp, 160);
  const first = action(match, relay.skill_id);
  assert.equal(first.pendingSwitch.reason, "relay");
  assert.equal(holder.hp, 160);
  assert.equal(passivesIn(go.continueSwitch(match, "player", 1), "move-cost").length, 1);
  assert.equal(holder.hp, 140);
  const returned = go.resolveTurn(match, { player: voluntary(0), enemy: wait });
  assert.equal(passivesIn(returned, "move-cost").length, 0);
});

test("hostile status immunity blocks only individually targeted status effects", () => {
  const mixed = { ...skill("skill_001"), effect2: "bf_pa_up1", effect_target2: "self", effect_chance2: 100 };
  const field = skill("skill_039");
  const strikeDown = { ...skill("skill_013"), element: "fire", cost: 0 };
  const match = passiveBattle({ skills: [mixed, field, strikeDown],
    player: [character({ skillIds: [mixed.skill_id, field.skill_id, strikeDown.skill_id] })],
    enemy: [withPassive("020", { skillIds: [mixed.skill_id], element_1: "light" })] });
  const [actor, holder] = fighters(match);
  full(actor);
  const blocked = action(match, mixed.skill_id);
  assert.equal(passivesIn(blocked, "before-status-effect").length, 1);
  assert.equal(holder.stages.phy_atk, 0);
  assert.equal(actor.stages.phy_atk, 1);
  const wind = officialDefense.get("追い風");
  match.fields.enemy.set(wind.battle_effect_id, { definition: wind, starts: 1, expires: 5 });
  const clear = action(match, field.skill_id);
  assert.equal(passivesIn(clear, "before-status-effect").length, 0);
  assert.equal(match.fields.enemy.size, 0);
  assert.equal(match.fields.player.size, 1);
  action(match, strikeDown.skill_id);
  assert.equal(holder.stages.phy_def, -1);
  go.resolveTurn(match, { player: wait, enemy: select(mixed.skill_id) });
  assert.equal(holder.stages.phy_atk, 1);
});

test("dodge action and actual evade are separate, including failed dodge and ignore-dodge attacks", () => {
  const dodge = skill("skill_000"), sharpen = skill("skill_043");
  for (const [id, evasion, hitType, dodgeMove, events, stage, stat] of [
    ["021", 0, "normal", sharpen, 1, officialPassives.get("passive_021").effects[0].value, "phy_def"], ["021", 100, "normal", dodge, 1, officialPassives.get("passive_021").effects[0].value, "phy_def"],
    ["023", 0, "normal", dodge, 0, 0, "sp_atk"], ["023", 100, "normal", dodge, 1, 1, "sp_atk"],
    ["023", 100, "ignore_dodge", dodge, 0, 0, "sp_atk"],
  ]) {
    const match = passiveBattle({ skills: [dodgeMove, { ...strike, hit_type: hitType }],
      player: [withPassive(id, { evasion_percent: evasion, skillIds: [dodgeMove.skill_id] })] });
    const turn = action(match, dodgeMove.skill_id, select());
    assert.equal(passivesIn(turn, id === "021" ? "dodge-action" : "evaded").length, events);
    assert.equal(active(match).stages[stat], stage);
  }
  const match = passiveBattle({ skills: [dodge], player: [withPassive("023", { evasion_percent: 100 })] });
  action(match, dodge.skill_id);
  assert.equal(active(match).stages.sp_atk, 0);
});

test("toxic mucus uses normal poison refresh, requires surviving physical body loss and excludes decoy", () => {
  for (const mode of ["hit", "refresh", "special", "decoy", "evade", "lethal"]) {
    const match = passiveBattle({ skills: [{ ...strike, attack_type: mode === "special" ? "special" : "physical" }],
      enemy: [withPassive("022", { hp: mode === "lethal" ? 1 : 200 })] });
    const [actor, holder] = fighters(match);
    if (mode === "refresh") actor.statuses.push({ definition: officialEffects.get("poison"), turns: 2 });
    if (mode === "decoy") holder.decoy = { hp: 10, maxHp: 10 };
    if (mode === "evade") holder.dodgeActive = true;
    const turn = action(match);
    const triggered = ["hit", "refresh"].includes(mode);
    assert.equal(passivesIn(turn, "body-hit-status").length, Number(triggered), mode);
    assert.equal(actor.statuses.length, Number(triggered), mode);
    if (triggered) {
      const poison = officialEffects.get("poison");
      assert.equal(actor.statuses[0].definition, poison);
      assert.equal(actor.statuses[0].turns, poison.turn - 1);
    }
  }
});

test("official teams replay prioritised cost, reactive poison, normal entry and metabolism across turns", () => {
  const match = passiveBattle({ skills: officialSkills,
    player: official("character_020", "character_016", "character_007"),
    enemy: official("character_022", "character_019") });
  const [actor, holder] = fighters(match);
  const turnOne = action(match, "skill_000");
  assert.equal(passivesIn(turnOne, "move-cost")[0].damage, 15);
  const entered = go.resolveTurn(match, { player: voluntary(1), enemy: wait });
  assert.equal(passivesIn(entered, "entry").length, 1);
  const wind = action(match, "skill_013");
  assert.equal(passivesIn(wind, "body-hit-status").length, 1);
  assert.equal(active(match).statuses.length, 1);
  assert.ok(holder.hp < holder.maxHp);
  go.resolveTurn(match, { player: voluntary(2), enemy: voluntary(1) });
  const foe = active(match, "enemy");
  const user = active(match);
  full(user);
  action(match, "skill_027");
  assert.ok(foe.statuses.length > 0);
  const expected = go.previewDamage(match, "player", skill("skill_027"));
  assert.equal(expected.defense, Math.floor(foe.base.sp_def * 1.5));
  const last = action(match, "skill_027");
  assert.equal(passivesIn(last, "stat-multiplier").length, 1);
  assert.equal(last.events.find((e) => e.type === "move").damage, expected.damage);
  assert.equal(match.turn, 7);
});

function seededBattleRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

test("1,024 seeded battles on the formal CSV finish with valid state and resumable switches", (t) => {
  const firstSeed = 42000;
  const count = 1024;
  const turnLimit = 200;
  const roster = [...officialCharacters.values()].filter((base) => base.skillIds.some((id) =>
    skill(id)?.category === "attack" && !go.unsupportedMoveReason(skill(id), assets)));
  const summary = { firstSeed, lastSeed: firstSeed + count - 1, count, turnLimit, roster: roster.length,
    finished: 0, errors: 0, capped: 0, longest: 0, turns: 0, selections: 0, draws: 0, cappedSeeds: [], exceptions: [] };
  const sides = ["player", "enemy"];
  for (let seed = firstSeed; seed < firstSeed + count; seed++) {
    const random = seededBattleRandom(seed);
    const pick = (items) => items[Math.floor(random() * items.length)];
    const team = () => {
      const options = [...roster];
      return Array.from({ length: [1, 2, 3, 4][seed % 4] }, () =>
        options.splice(Math.floor(random() * options.length), 1)[0]);
    };

    let match;
    function choose(side) {
      const fighter = active(match, side);
      const candidates = [...new Set([...fighter.base.skillIds, "skill_000"])].map(select)
        .concat(Array.from(go.switchTargets(match, side), voluntary), wait)
        .filter((action) => !go.checkAction(match, side, action));
      assert.ok(candidates.length);
      const attacks = candidates.filter((action) => action.type === "move" && skill(action.moveId).category === "attack");
      return pick(attacks.length && random() < 0.7 ? attacks : candidates);
    }
    let completed = 0;
    try {
      match = passiveBattle({ skills: officialSkills, player: team(), enemy: team(), manualSwitches: true, random });
      while (!match.winner && completed < turnLimit) {
        const actions = Object.fromEntries(sides.map((side) => [side, choose(side)]));
        const fainted = new Set(sides.flatMap((side) => match.teams[side].filter((f) => f.fainted)
          .map((fighter) => side + "/" + fighter.base.name)));
        const energySides = new Set();
        const phaseSlots = new Set();
        let terminalEvent = false;
        const note = (events) => {
          for (const event of events) {
            const key = event.side + "/" + event.actor;
            if (terminalEvent) assert.ok(["effect-expired", "defense-expired", "field-expired"].includes(event.type),
              "action or upkeep after victory: " + event.type);
            if (event.type === "win" || event.type === "draw") terminalEvent = true;
            if (event.type === "energy") {
              assert.ok(!energySides.has(event.side), "duplicate EN upkeep");
              energySides.add(event.side);
            }
            if (event.type === "passive" && ["turn-end", "before-hp-damage", "after-use", "dodge-action", "move-cost"].includes(event.phase)) {
              const slot = key + "/" + event.phase + "/" + event.slot;
              assert.ok(!phaseSlots.has(slot), "duplicate passive " + slot);
              phaseSlots.add(slot);
            }
            if (event.type === "faint") {
              assert.ok(!fainted.has(key), "duplicate faint " + key);
              fainted.add(key);
            }
            if (["move", "charge", "passive"].includes(event.type)) assert.ok(!fainted.has(key), "post-KO event " + key);
            for (const value of Object.values(event)) {
              if (typeof value === "number") assert.ok(Number.isFinite(value), "non-finite event");
            }
          }
        };
        const turn = match.turn;
        let result = go.resolveTurn(match, actions);
        note(result.events);
        let selections = 0;
        while (result.pendingSwitch) {
          const { side, candidates } = result.pendingSwitch;
          assert.ok(++selections <= 4, "switch continuation failed to complete");
          assert.ok(candidates.length);
          assert.deepEqual(Array.from(candidates), Array.from(go.switchTargets(match, side)));
          result = go.continueSwitch(match, side, pick(candidates));
          note(result.events);
          summary.selections++;
        }
        completed++;
        assert.equal(match.turn, match.winner ? turn : turn + 1);
        assert.equal(match.turnContinuation, null);
        for (const side of sides) {
          if (!match.winner) assert.equal(active(match, side).fainted, false);
          for (const fighter of match.teams[side]) {
            assert.ok(Number.isInteger(fighter.hp) && fighter.hp >= 0 && fighter.hp <= fighter.maxHp);
            assert.equal(fighter.hp === 0, fighter.fainted);
            assert.ok(Number.isInteger(fighter.energy) && fighter.energy >= 0 && fighter.energy <= go.MAX_ENERGY);
            assert.ok(Object.values(fighter.stages).every((n) => Number.isInteger(n) && n >= -6 && n <= 6));
            assert.ok(fighter.statuses.every(({ turns }) => Number.isInteger(turns) && turns > 0));
            assert.equal(new Set(fighter.statuses.map((status) => status.definition.effect_id)).size, fighter.statuses.length);
            if (fighter.decoy) assert.ok(fighter.decoy.hp > 0 && fighter.decoy.hp <= fighter.decoy.maxHp);
            if (fighter.pending) assert.ok(Number.isFinite(fighter.pending.power) && fighter.pending.power > 0);
          }
        }
      }
      if (match.winner) {
        const alive = sides.filter((side) => match.teams[side].some((fighter) => !fighter.fainted));
        assert.equal(match.winner, alive[0] ?? "draw");
        assert.ok(alive.length <= 1);
        summary.finished++;
        if (match.winner === "draw") summary.draws++;
      } else {
        summary.capped++;
        summary.cappedSeeds.push(seed);
      }
      summary.longest = Math.max(summary.longest, completed);
      summary.turns += completed;
    } catch (error) {
      summary.errors++;
      if (summary.exceptions.length < 8) summary.exceptions.push({ seed, turn: match?.turn, message: error.message });
    }
  }
  t.diagnostic(JSON.stringify(summary));
  assert.equal(summary.errors, 0, JSON.stringify(summary.exceptions));
  assert.equal(summary.finished + summary.capped, count);
});

test("Revive survives for toxic mucus and retaliation; a decoy consumes neither", () => {
  const survival = officialPassives.get("passive_001").effects[0];
  const toxin = { ...officialPassives.get("passive_022").effects[0], slot: 2 };
  const passives = new Map([["passive_001", { effects: [survival, toxin] }]]);
  const move = { ...strike, power: 150, cost: 0 };
  for (const decoy of [false, true]) {
    const match = passiveBattle({ skills: [move], enemy: [withPassive("001", { hp: 50 })], passives });
    const target = active(match, "enemy");
    target.defenses.set("revenge", { id: "revenge", definition: officialDefense.get("revenge"), starts: 1, expires: 2 });
    if (decoy) target.decoy = { hp: 10, maxHp: 10 };
    const preview = go.previewDamage(match, "player", move);
    const result = action(match);
    assert.equal(preview.targetHp, target.hp);
    assert.equal(preview.actualDamage, decoy ? 0 : 49);
    assert.equal(preview.decoyDamage, decoy ? 10 : 0);
    assert.equal(preview.responseDamage, result.events.find((event) => event.type === "revenge")?.damage ?? 0);
    assert.equal(passivesIn(result, "before-hp-damage").length, Number(!decoy));
    assert.equal(passivesIn(result, "body-hit-status").length, Number(!decoy));
    if (!decoy) assert.ok(result.events.findIndex((event) => event.type === "status-applied") <
      result.events.findIndex((event) => event.type === "revenge"));
  }
});

test("Full Commitment composes with exact 1 HP power and the existing move cap", () => {
  const move = skill("skill_005");
  const match = passiveBattle({ skills: [move], player: [withPassive("006", { skillIds: [move.skill_id] })] });
  const actor = active(match);
  full(actor);
  actor.hp = 2;
  assert.equal(go.previewDamage(match, "player", move).power, 84);
  actor.hp = 1;
  assert.equal(go.previewDamage(match, "player", move).power, 160);
  const turn = action(match, move.skill_id);
  assert.equal(turn.events.find((event) => event.type === "move").power, 160);
  assert.equal(actor.stages.phy_atk, -1);
});

test("drain and HP cost re-evaluate Adrenaline against live HP and match the forecast", () => {
  const cost = { ...officialPassives.get("passive_020").effects[0], slot: 3 };
  const adrenaline = officialPassives.get("passive_017");
  const passives = new Map([["passive_017", { ...adrenaline, effects: [...adrenaline.effects, cost] }]]);
  const drain = { ...strike, priority: 1, power: 80,
    effect1: "bf_drain_50", effect_target1: "self", effect_chance1: 100 };
  const match = passiveBattle({ skills: [drain], player: [withPassive("017")], passives });
  const actor = active(match);
  actor.hp = 110;
  const preview = go.previewDamage(match, "player", drain);
  assert.equal(preview.hpCost, 20);
  assert.equal(preview.attack, Math.floor(actor.base.phy_atk * 1.2));
  assert.ok(preview.actorHp > actor.maxHp / 2);
  assert.equal(actor.hp, 110);
  const result = action(match);
  assert.equal(preview.hpEffects[0].delta, result.events.find((event) => event.type === "heal").recovered);
  assert.equal(actor.hp, preview.actorHp);
  assert.equal(go.statValue(actor, "phy_atk"), actor.base.phy_atk);
});

test("Toxic mucus and Pursuit both use the status that triggers Metabolism", () => {
  const pursuit = skill("skill_061");
  const toxin = { ...officialPassives.get("passive_022").effects[0], slot: 3 };
  const metabolism = officialPassives.get("passive_019");
  const match = passiveBattle({ skills: [strike, pursuit],
    player: [withPassive("019", { skillIds: ["strike", pursuit.skill_id] })],
    enemy: [withPassive("019", { element_1: "light" })],
    passives: new Map([["passive_019", { ...metabolism, effects: [...metabolism.effects, toxin] }]]) });
  assert.equal(go.previewDamage(match, "player", pursuit).power, 70);
  go.resolveTurn(match, { player: select(), enemy: select() });
  assert.ok(fighters(match).every((fighter) => fighter.statuses.length === 1));
  const preview = go.previewDamage(match, "player", pursuit);
  assert.equal(preview.power, 100);
  assert.equal(preview.defense, 165);
  const turn = action(match, pursuit.skill_id);
  assert.equal(turn.events.find((event) => event.type === "move").damage, preview.damage);
});

test("Tail Purge and Revive track independent per-fighter limits across a return", () => {
  const tail = skill("skill_006"), lethal = { ...strike, power: 1000, cost: 0 };
  const match = passiveBattle({ skills: [tail, lethal], player: [...official("character_001"), character()] });
  const actor = active(match);
  full(actor);
  specialWait(match, tail.skill_id, 1);
  assert.equal(actor.moveUses.get("bf_shed_tail"), 1);
  assert.equal(actor.passiveState.uses.size, 0);
  go.resolveTurn(match, { player: voluntary(0), enemy: wait });
  actor.hp = actor.maxHp;
  const hit = go.resolveTurn(match, { player: wait, enemy: select() });
  assert.equal(passivesIn(hit, "before-hp-damage").length, 1);
  assert.equal(actor.moveUses.get("bf_shed_tail"), 1);
  assert.equal(actor.passiveState.uses.get(1), 1);
  assert.match(go.checkAction(match, "player", select(tail.skill_id)), /使用済み/);
});

test("AI HP forecast is read-only and matches mitigation, absorb, reflect, decoy recoil and charge", () => {
  const recoil = { ...skill("skill_046"), element: "water", attack_type: "special", effect2: "none", effect_chance2: 0 };
  for (const mode of ["hit", "absorb", "reflect", "decoy", "charge"]) {
    const move = mode === "charge" ? skill("skill_054") : recoil;
    let rolls = 0;
    const match = passiveBattle({ skills: [move], player: [withPassive("020", { skillIds: [move.skill_id] })],
      enemy: [withPassive("001", { element_1: "light" })], random: () => { rolls++; return 0; } });
    const [actor, target] = fighters(match);
    target.hp -= 10;
    full(actor);
    if (["absorb", "reflect"].includes(mode)) {
      const id = mode === "absorb" ? "bf_water_absorb_guard" : "reflection";
      target.defenses.set(id, { id, definition: officialDefense.get(id), starts: 1, expires: 2 });
    }
    if (mode === "decoy") target.decoy = { hp: 13, maxHp: 13 };
    const snapshot = () => JSON.stringify(match, (_, value) =>
      Object.prototype.toString.call(value) === "[object Map]" ? [...value.entries()] : value);
    const before = snapshot();
    const guess = go.previewDamage(match, "player", move);
    assert.deepEqual(go.previewDamage(match, "player", move), guess);
    assert.equal(snapshot(), before);
    assert.equal(rolls, 0);
    const turn = action(match, move.skill_id);
    assert.deepEqual([actor.hp, target.hp], [guess.actorHp, guess.targetHp], mode);
    assert.equal(turn.events.find((event) => event.type === "recoil")?.damage ?? 0,
      Math.abs(guess.hpEffects.find((entry) => entry.kind === "recoil")?.delta ?? 0), mode);
    assert.equal(turn.events.find((event) => event.type === "absorbed")?.recovered ?? 0, guess.actualHeal);
    assert.equal(turn.events.find((event) => event.type === "reflected")?.damage ?? 0, guess.responseDamage);
    if (mode === "charge") {
      const release = go.previewDamage(match, "player", move);
      assert.equal(release.hpCost, 0);
      assert.equal(release.power, actor.pending.power);
      const final = action(match, move.skill_id);
      assert.equal(final.events.find((event) => event.type === "move").actualDamage, release.actualDamage);
    }
  }
});

test("decisive recoil and HP-cost defeats stop the queued opponent action", () => {
  const move = { ...skill("skill_046"), element: "fire", priority: 1, cost: 0 };
  for (const selfCost of [false, true]) {
    const player = withPassive(selfCost ? "020" : "", { skillIds: [move.skill_id] });
    const match = passiveBattle({ skills: [move, strike], player: [player], enemy: [character({ element_1: "light" })] });
    active(match).hp = 1;
    const turn = action(match, move.skill_id, select());
    assert.equal(turn.winner, "enemy");
    assert.equal(turn.events.filter((event) => event.type === "move" && event.side === "enemy").length, 0);
    assert.equal(turn.events.at(-1).type, "win");
    assert.equal(active(match, "enemy").energy, 1);
  }
});

test("forecast lists optional recoil without rolling it or subtracting it from guaranteed HP", () => {
  const move = { ...skill("skill_046"), element: "fire", effect_chance1: 50 };
  for (const roll of [0.49, 0.5]) {
    let rolls = 0;
    const match = passiveBattle({ skills: [move], player: [character({ skillIds: [move.skill_id] })],
      random: () => { rolls++; return roll; } });
    const actor = active(match);
    full(actor);
    const guess = go.previewDamage(match, "player", move);
    assert.equal(rolls, 0);
    assert.equal(guess.actorHp, actor.hp);
    assert.equal(guess.hpEffects[0].chance, 50);
    const turn = action(match, move.skill_id);
    assert.equal(turn.events.find((event) => event.type === "recoil")?.damage ?? 0,
      roll < 0.5 ? Math.abs(guess.hpEffects[0].delta) : 0);
    assert.equal(rolls, 1);
  }
});

const ai = vn("geneOrderAI");
const visibleHistory = () => ({ player: new Map(), enemy: new Map() });
const aiMove = (id, overrides = {}) => ({ ...strike, skill_id: id, name: id, ...overrides });

test("GO AI and resolved turns use shared Thunder and Ice damage", () => {
  for (const [element, target, second, expected] of [
    ["thunder", "water", "wind", 4], ["ice", "thunder", "fire", 1],
  ]) {
    const move = aiMove(element, { element });
    const match = battle({ skills: [move],
      player: [character({ element_1: element, skillIds: [element] })],
      enemy: [character({ element_1: target, element_2: second, hp: 400 })] });
    const [attacker, defender] = fighters(match);
    go.changeEnergy(attacker, 4);
    const snapshot = JSON.stringify(match);
    const candidate = ai.evaluate(ai.observe(match, "player")).find((entry) => entry.move?.skill_id === element);
    const preview = go.previewDamage(match, "player", move);
    assert.equal(go.calculateDamage(attacker, defender, move, chart).effectiveness, expected);
    assert.equal(candidate.damage, preview.actualDamage);
    assert.equal(JSON.stringify(match), snapshot);
    const hp = defender.hp;
    go.resolveTurn(match, { player: select(element), enemy: wait });
    assert.equal(hp - defender.hp, preview.actualDamage);
  }
});

test("AI projects matching boosted attacks without consuming power or rewarding redundant setup", () => {
  const setup = skill("skill_020");
  const attack = aiMove("thunder", { element: "thunder", cost: 0 });
  const match = battle({ ...assets, skills: [setup, attack],
    player: [character({ skillIds: [setup.skill_id, attack.skill_id] })],
    enemy: [character({ hp: 600, element_1: "water" })] });
  const actor = active(match);
  go.changeStage(actor, "sp_def", 6);
  const evaluate = () => ai.evaluate(ai.observe(match, "player"));
  const setupScore = (entries) => entries.find((entry) => entry.move?.skill_id === setup.skill_id).score;
  const fresh = evaluate();
  assert.ok(setupScore(fresh) > 0);
  action(match, setup.skill_id);
  const snapshot = [...actor.nextElementPower];
  const primed = evaluate();
  assert.equal(setupScore(primed), 0);
  assert.notEqual(ai.choose(ai.observe(match, "player"), { random: () => 0 }).action.moveId, setup.skill_id);
  const candidate = primed.find((entry) => entry.move?.skill_id === attack.skill_id);
  assert.equal(candidate.forecast.power, 120);
  assert.deepEqual([...actor.nextElementPower], snapshot);
  assert.equal(action(match, attack.skill_id).events.find((entry) => entry.type === "move").actualDamage, candidate.damage);
});

test("GO AI accepts all six MHB profiles, safely defaults, and honors only usable preferences", () => {
  const moves = [aiMove("main"), aiMove("setup"), aiMove("expensive", { cost: 7 }),
    { ...skill("skill_020"), skill_id: "unfinished", battle_effect1: "missing_effect" }];
  for (const type of ["", "balanced", "aggressive", "patient", "defensive", "disruptor", "tactical", "missing", "constructor"]) {
    const match = passiveBattle({ skills: moves, player: [character({ ai_type: type, ai_main_skill: "main",
      ai_setup_skill: "setup", skillIds: moves.map((move) => move.skill_id) })] });
    const result = ai.choose(ai.observe(match, "player"), { random: () => 0 });
    assert.equal(result.type, ai.knownType(type) && type ? type : "balanced");
    assert.deepEqual(Array.from(result.candidates.filter((c) => c.move), (c) => c.move.skill_id), ["main", "setup"]);
    assert.ok(result.candidates.find((c) => c.move?.skill_id === "main").preferenceMultiplier > 1);
    assert.ok(result.candidates.find((c) => c.move?.skill_id === "setup").preferenceMultiplier > 1);
    match.teams.player[0].base.ai_main_skill = "expensive";
    assert.ok(!ai.evaluate(ai.observe(match, "player")).some((c) => c.move?.skill_id === "main" && c.preferenceMultiplier));
  }
});

test("AI uses the same HP projection for KO, immunity, Revive, decoy, reflection and recoil", () => {
  const light = aiMove("light", { attack_type: "special", element: "light", power: 500, cost: 0 });
  const water = aiMove("water", { attack_type: "special", element: "water", power: 500, cost: 0 });
  const recoil = { ...light, skill_id: "recoil", effect1: "recoil_25", effect_target1: "self", effect_chance1: 100 };
  for (const mode of ["ko", "revive", "immune", "decoy", "reflection", "revenge", "recoil", "hp-cost"]) {
    const moves = mode === "hp-cost" ? [{ ...light, priority: 1 }, water] : [light, water, recoil];
    const match = passiveBattle({ skills: moves, player: [withPassive(mode === "hp-cost" ? "020" : "",
      { skillIds: moves.map((move) => move.skill_id) })], enemy: [withPassive(mode === "revive" ? "001" : mode === "immune" ? "002" : "",
      { hp: mode === "revenge" ? 200 : 50, element_1: "light" })] });
    const [actor, target] = fighters(match);
    if (mode === "decoy") target.decoy = { hp: 10, maxHp: 10 };
    if (mode === "reflection" || mode === "revenge") {
      target.defenses.set(mode, { id: mode, definition: officialDefense.get(mode), starts: 1, expires: 2 });
      if (mode === "revenge") actor.hp = 40;
    }
    if (mode === "recoil" || mode === "hp-cost") actor.hp = 1;
    const result = ai.choose(ai.observe(match, "player"), { random: () => 0 });
    const byId = (id) => result.candidates.find((candidate) => candidate.move?.skill_id === id);
    if (mode === "ko") assert.ok(result.selected.koConfidence > 0);
    if (mode === "revive") assert.deepEqual([byId("light").forecast.targetHp, byId("light").koConfidence], [1, 0]);
    if (mode === "immune") assert.ok(byId("water").score < byId("light").score);
    if (mode === "decoy") assert.deepEqual([byId("light").damage, byId("light").decoyDamage, byId("light").koConfidence], [0, 10, 0]);
    if (mode === "reflection") assert.ok(byId("light").forecast.response > 0);
    if (mode === "revenge") assert.ok(byId("light").forecast.response > 0 || byId("water").forecast.response > 0);
    if (mode === "recoil" || mode === "hp-cost") assert.ok(byId(mode === "recoil" ? "recoil" : "light").fatal);
    if (mode === "hp-cost") assert.notEqual(result.action.moveId, "light");
    assert.equal(go.checkAction(match, "player", result.action), "");
  }
});

test("support scoring distinguishes effective healing, capped ranks, enemy immunity and evasion actions", () => {
  const heal = skill("skill_024"), focus = skill("skill_060"), song = skill("skill_001"), dodge = skill("skill_000");
  const match = passiveBattle({ skills: [heal, focus, song, dodge], player: [withPassive("021", { skillIds: [heal.skill_id, focus.skill_id, song.skill_id] })],
    enemy: [withPassive("020")] });
  const [actor] = fighters(match);
  full(actor);
  const score = (id) => ai.evaluate(ai.observe(match, "player")).find((candidate) => candidate.move?.skill_id === id).score;
  const fullHealth = score(heal.skill_id);
  actor.hp = 85;
  assert.ok(score(heal.skill_id) > fullHealth);
  const canFocus = score(focus.skill_id);
  go.changeStage(actor, "sp_atk", 6);
  assert.ok(canFocus > score(focus.skill_id));
  assert.ok(score(song.skill_id) <= 0, "an ineffective move must not earn positive utility, including zero EN cost");
  assert.ok(score(dodge.skill_id) > score(song.skill_id));
});

test("AI uses the reservation without paying twice and chooses valid special or forced switch targets", () => {
  const charge = skill("skill_054"), relay = skill("skill_042"), tail = skill("skill_006");
  const match = passiveBattle({ skills: [charge, relay, tail], manualSwitches: true,
    player: [character({ skillIds: [charge.skill_id, relay.skill_id, tail.skill_id] }), withPassive("016"), withPassive("001")],
    enemy: [character({ hp: 1000 })] });
  full(active(match));
  const initial = ai.evaluate(ai.observe(match, "player")).find((entry) => entry.move?.skill_id === charge.skill_id);
  assert.equal(initial.koConfidence, 0);
  action(match, charge.skill_id);
  const forced = ai.choose(ai.observe(match, "player")).action;
  assert.equal(forced.moveId, charge.skill_id);
  action(match, charge.skill_id);
  active(match).bind = { turns: 2, definition: officialEffects.get("bind"), source: active(match, "enemy") };
  assert.ok(!ai.evaluate(ai.observe(match, "player")).some((entry) => entry.action.type === "switch"));
  const pause = action(match, relay.skill_id);
  const incoming = ai.choose(ai.observe(match, "player")).action;
  assert.ok(pause.pendingSwitch.candidates.includes(incoming.index));
  go.continueSwitch(match, "player", incoming.index);
  const fighter = active(match);
  fighter.hp = 1;
  fighter.statuses.push({ turns: 1, definition: officialEffects.get("poison") });
  assert.equal(idle(match).pendingSwitch.reason, "replacement");
  const replacement = ai.choose(ai.observe(match, "player")).action;
  assert.ok(match.pendingSwitch.candidates.includes(replacement.index));
  go.continueSwitch(match, "player", replacement.index);
});

test("public observation excludes hidden opponents and queued actions, and evaluation uses no battle RNG", () => {
  let rolls = 0;
  const main = aiMove("main");
  const secret = aiMove("secret", { power: 900 });
  const match = passiveBattle({ skills: [main, secret, skill("skill_000")],
    player: [character({ skillIds: ["main"] }), character({ name: "Own bench" })],
    enemy: [character({ skillIds: ["secret"] }), character({ name: "Hidden bench" })],
    random: () => { rolls++; throw Error("battle RNG consumed"); } });
  const stringify = (item) => JSON.stringify(item, (_, value) => Object.prototype.toString.call(value) === "[object Map]"
    ? [...value] : value);
  const board = ai.observe(match, "player");
  assert.equal(board.teams.player.length, 2);
  assert.equal(board.teams.enemy.length, 1);
  assert.equal(board.skills.has("secret"), false);
  assert.equal(board.random, undefined);
  assert.equal(board.turnContinuation, undefined);
  const fixed = ai.observe(match, "player", { revealFixedMoves: true });
  assert.equal(fixed.skills.has("secret"), true);
  const history = visibleHistory();
  ai.record(history, [{ type: "move", side: "enemy", actor: active(match, "enemy").base.name, moveId: "secret" }]);
  assert.equal(ai.observe(match, "player", { history }).skills.has("secret"), true);
  const snapshot = stringify(match);
  const before = stringify(ai.choose(board, { random: seededBattleRandom(1) }));
  assert.equal(stringify(match), snapshot);
  active(match, "enemy").base.skillIds = ["hidden-alternative"];
  match.teams.enemy[1].hp = 1;
  match.turnContinuation = { hidden: { player: { moveId: "secret" } } };
  match.selected = { enemy: { type: "switch", index: 1 } };
  assert.equal(stringify(ai.choose(ai.observe(match, "player"), { random: seededBattleRandom(1) })), before);
  assert.equal(rolls, 0);
});

const CAP_SEEDS_042 = [42190, 42196, 42238, 42240, 42249, 42250, 42262, 42284, 42582];
const AI_TYPES = ["balanced", "aggressive", "patient", "defensive", "disruptor", "tactical"];

test("GO AI seeded tournaments and v0.42 long-match replay", (t) => {
  const roster = [...officialCharacters.values()].filter((base) => base.skillIds.some((id) =>
    skill(id)?.category === "attack" && !go.unsupportedMoveReason(skill(id), assets)));
  const sides = ["player", "enemy"];
  const groups = [
    { name: "AI vs AI", seeds: Array.from({ length: 1024 }, (_, i) => 50000 + i) },
    { name: "AI vs Random", seeds: Array.from({ length: 256 }, (_, i) => 51024 + i), randomEnemy: true },
    { name: "v0.42 replay", seeds: CAP_SEEDS_042 },
    { name: "Profiles", scenarios: AI_TYPES.flatMap((profile) => Array.from({ length: 32 }, (_, index) => ({ seed: 52000 + index, profile }))) },
  ];
  const empty = () => ({ attack: 0, status: 0, dodge: 0, wait: 0, switch: 0 });
  for (const group of groups) {
    const scenarios = group.scenarios ?? group.seeds.map((seed) => ({ seed, profile: "balanced" }));
    const summary = { name: group.name, games: scenarios.length, finished: 0, errors: 0, illegal: 0, capped: 0, turns: 0,
      longest: 0, playerWins: 0, enemyWins: 0, draws: 0, continuations: 0, switchStreakGames: 0, healingStreakGames: 0,
      actions: { player: empty(), enemy: empty() }, profiles: {}, failures: [], cappedSeeds: [], noDamageGames: 0 };
    for (const { seed, profile } of scenarios) {
      const random = seededBattleRandom(seed);
      const pick = (list) => list[Math.floor(random() * list.length)];
      const team = (side) => {
        const options = [...roster];
        return Array.from({ length: [1, 2, 3, 4][seed % 4] }, () => {
          const base = options.splice(Math.floor(random() * options.length), 1)[0];
          return group.scenarios && side === "player" ? { ...base, ai_type: profile } : base;
        });
      };
      const randomAi = { player: seededBattleRandom(seed ^ 0xaabbc1), enemy: seededBattleRandom(seed ^ 0xaabbc2) };
      const match = passiveBattle({ skills: officialSkills, player: team("player"), enemy: team("enemy"), random, manualSwitches: true });
      const history = visibleHistory();
      const previous = {};
      const switches = { player: 0, enemy: 0 };
      const heals = { player: 0, enemy: 0 };
      let switchLoop = false, healingLoop = false, noDamageRun = 0, noDamage = false, turnCount = 0;
      try {
        while (!match.winner && turnCount < 200) {
          const choose = (side) => {
            if (side === "enemy" && group.randomEnemy) {
              const actor = active(match, side);
              const options = [...new Set([...actor.base.skillIds, "skill_000"])].map(select)
                .concat(Array.from(go.switchTargets(match, side), voluntary), wait).filter((action) => !go.checkAction(match, side, action));
              const attacks = options.filter((action) => action.type === "move" && skill(action.moveId).category === "attack");
              return pick(attacks.length && random() < 0.7 ? attacks : options);
            }
            const result = ai.choose(ai.observe(match, side, { history, previousSwitch: previous[side] }), { random: randomAi[side] });
            assert.ok(result.candidates.every((entry) => Number.isFinite(entry.score)));
            return result.action;
          };
          const actions = Object.fromEntries(sides.map((side) => [side, choose(side)]));
          for (const side of sides) {
            const action = actions[side];
            if (go.checkAction(match, side, action)) {
              summary.illegal++;
              assert.fail("illegal " + side + " " + JSON.stringify(action));
            }
            const kind = action.type !== "move" ? action.type : action.moveId === "skill_000" ? "dodge" : skill(action.moveId).category;
            summary.actions[side][kind]++;
            if (group.scenarios && side === "player") {
              summary.profiles[profile] ??= empty();
              summary.profiles[profile][kind]++;
            }
            switches[side] = kind === "switch" ? switches[side] + 1 : 0;
            if (switches[side] >= 4) switchLoop = true;
          }
          let result = go.resolveTurn(match, actions);
          const events = [...result.events];
          ai.record(history, result.events);
          let attempts = 0;
          while (result.pendingSwitch) {
            const { side, candidates } = result.pendingSwitch;
            const index = group.randomEnemy && side === "enemy" ? pick(candidates) :
              ai.choose(ai.observe(match, side, { history, previousSwitch: previous[side] }), { random: randomAi[side] }).action.index;
            assert.ok(candidates.includes(index) && ++attempts <= 4);
            result = go.continueSwitch(match, side, index);
            events.push(...result.events);
            ai.record(history, result.events);
            summary.continuations++;
          }
          for (const side of sides) {
            if (events.some((e) => e.side === side && ["switch", "replacement"].includes(e.type))) previous[side] = { turn: result.turn };
            heals[side] = events.some((e) => e.side === side && e.type === "heal" && e.recovered > 0) ? heals[side] + 1 : 0;
            if (heals[side] >= 4) healingLoop = true;
            for (const fighter of match.teams[side]) {
              assert.ok(Number.isFinite(fighter.hp) && fighter.hp >= 0 && fighter.hp <= fighter.maxHp);
              assert.ok(Number.isFinite(fighter.energy) && fighter.energy >= 0 && fighter.energy <= go.MAX_ENERGY);
            }
          }
          noDamageRun = events.some((e) => e.type === "residual" || e.type === "decoy-hit" || e.actualDamage > 0) ? 0 : noDamageRun + 1;
          if (noDamageRun >= 12) noDamage = true;
          turnCount++;
        }
        summary.longest = Math.max(summary.longest, turnCount);
        summary.turns += turnCount;
        if (switchLoop) summary.switchStreakGames++;
        if (healingLoop) summary.healingStreakGames++;
        if (noDamage) summary.noDamageGames++;
        if (match.winner) {
          summary.finished++;
          if (match.winner === "draw") summary.draws++;
          else summary[match.winner + "Wins"]++;
        } else {
          summary.capped++;
          summary.cappedSeeds.push(group.scenarios ? [profile, seed] : seed);
        }
      } catch (error) {
        summary.errors++;
        if (summary.failures.length < 6) summary.failures.push({ seed, turn: match.turn, message: error.message, at: error.stack.split("\n")[1] });
      }
    }
    t.diagnostic(JSON.stringify(summary));
    assert.equal(summary.errors, 0, JSON.stringify(summary.failures));
    assert.equal(summary.illegal, 0);
    assert.equal(summary.finished + summary.capped, summary.games);
  }
});
