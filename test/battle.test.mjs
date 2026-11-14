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
  skills = [strike], random = () => 0 } = {}) {
  return go.createBattle({ player, enemy, skills: new Map(skills.map((move) => [move.skill_id, move])), effectiveness: chart, random });
}
const active = (match, side = "player") => go.activeFighter(match, side);
const fighters = (match) => [active(match), active(match, "enemy")];

test("physical and special damage use their own stats with an optional attack stat input", () => {
  const [a, b] = fighters(battle());
  const physical = go.calculateDamage(a, b, strike, chart);
  assert.deepEqual([physical.attack, physical.defense, physical.baseDamage, physical.damage], [120, 100, 44, 66]);
  const special = go.calculateDamage(a, b, { ...strike, attack_type: "special" }, chart);
  assert.deepEqual([special.attack, special.defense, special.baseDamage], [160, 110, 53]);
  assert.equal(go.calculateDamage(a, b, strike, chart, { attackStat: "phy_def" }).attack, 100);
});

test("preview does not mutate state, use RNG, or roll critical hits", () => {
  const match = battle({ random: () => { throw Error("turn RNG used"); } });
  const [a, b] = fighters(match);
  a.passiveState = { survive_once_used: false };
  const snapshot = JSON.stringify(match);
  vm.runInContext('const originalRandom = Math.random; Math.random = () => { throw Error("damage RNG used"); };', context);
  try {
    const result = go.calculateDamage(a, b, strike, chart);
    for (let i = 0; i < 10; i++) assert.deepEqual(go.calculateDamage(a, b, strike, chart), result);
    assert.equal(result.damage, 66);
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
  for (const [type, expected] of [["light", 66], ["earth", 132], ["water", 33]]) {
    b.base.element_1 = type;
    assert.equal(go.calculateDamage(a, b, strike, chart).damage, expected);
  }
  b.base.element_1 = "light";
  go.changeStage(a, "phy_atk", 1);
  const boosted = go.calculateDamage(a, b, strike, chart);
  assert.deepEqual([boosted.attack, boosted.baseDamage, boosted.damage], [180, 65, 97]);
  assert.equal(go.calculateDamage(a, b, strike, chart, { finalMultiplier: 0.5 }).damage, 48);
  assert.equal(go.calculateDamage(a, b, strike, chart, { finalMultiplier: 0 }).damage, 0);
  assert.equal(go.calculateDamage(a, b, strike, chart, { blocked: true }).damage, 0);
  assert.equal(go.calculateDamage(a, b, strike, chart, { finalMultiplier: 0.001 }).damage, 1);
  a.base.element_1 = "water";
  assert.equal(go.calculateDamage(a, b, strike, chart).damage, 65);
  a.base.element_2 = "fire";
  assert.equal(go.calculateDamage(a, b, strike, chart).damage, 97);
});

test("every one of the 49 official matchups is read directly from the chart", () => {
  const [a, b] = fighters(battle());
  assert.equal(chart.size, 7);
  let count = 0;
  for (const [element, row] of chart) {
    for (const [target, expected] of row) {
      b.base.element_1 = target;
      assert.equal(go.calculateDamage(a, b, { ...strike, element }, chart).effectiveness, expected);
      count += 1;
    }
  }
  assert.equal(count, 49);
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
  assert.equal(go.calculateDamage(a, b, strike, chart).stab, 1.5);
});

test("neutral, blank, status and unsupported compound attacks remain distinct", () => {
  const [a, b] = fighters(battle());
  a.base.element_1 = "none";
  const neutral = { ...strike, element: "none" };
  assert.equal(go.calculateDamage(a, b, neutral, chart).stab, 1.5);
  a.base.element_1 = null;
  assert.equal(go.calculateDamage(a, b, neutral, chart).stab, 1);
  b.base.element_1 = "dark";
  assert.equal(go.calculateDamage(a, b, neutral, chart).damage, 0);
  assert.throws(() => go.calculateDamage(a, b, { ...neutral, element: null }, chart), /未定義/);
  assert.throws(() => go.calculateDamage(a, b, { ...neutral, element2: "fire" }, chart), /複合属性/);
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
  for (const move of [{ ...strike, battle_effect1: "protect" }, { ...strike, hit_type: "ignore_dodge" },
    { ...strike, power_rule: "hp_exact_1" }, { ...strike, category: "status" }]) {
    assert.match(go.unsupportedMoveReason(move), /未対応/);
  }
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

test("official CSV integration: ミズアメネバムシ beats メトロシーザ in nine turns", () => {
  const characters = new Map(csv(read("data/character.csv")).filter((row) => row.name)
    .map((row) => [row.character_id, normalizeCharacter(row, elements, species)]));
  const skills = csv(read("data/skill.csv")).filter((row) => row.category).map((row) => normalizeSkill(row, elements));
  const match = battle({ player: [characters.get("character_007")], enemy: [characters.get("character_021")], skills });
  for (let turn = 1; turn <= 9; turn++) {
    const [a, b] = fighters(match);
    const expected = go.calculateDamage(a, b, match.skills.get("skill_026"), chart);
    const { events, winner } = go.resolveTurn(match, { player: select("skill_026"), enemy: select("skill_026") });
    assert.equal(events[0].damage, 19);
    assert.equal(events[0].side, "enemy");
    assert.equal(events[1].damage, 18);
    assert.equal(events[1].damage, expected.damage);
    assert.equal(winner, turn === 9 ? "player" : null);
  }
  assert.equal(active(match).hp, 4);
  assert.equal(active(match, "enemy").hp, 0);
});
