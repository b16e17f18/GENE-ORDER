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
  for (const move of [{ ...strike, battle_effect1: "protect" }, { ...strike, hit_type: "guard_break" },
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
  const match = battle({ ...assets, skills: [drain], enemy: [character({ hp: 30, element_1: "light" })] });
  active(match).hp = 100;
  const result = action(match, "strike");
  assert.equal(result.events[0].damage, 66);
  assert.equal(result.events[0].actualDamage, 30);
  assert.equal(active(match).hp, 115);
  const immune = battle({ ...assets, skills: [{ ...drain, element: "earth" }],
    enemy: [character({ element_1: "wind" })] });
  active(immune).hp = 100;
  assert.equal(action(immune, "strike").events.some((e) => e.type === "heal"), false);
  assert.equal(active(immune).hp, 100);
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
  assert.equal(go.calculateDamage(a, b, ignore, chart).damage, 16);
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
    turn(player.energy >= 2 ? select("skill_004") : wait, wait);
  }
  for (const type of ["move", "dodge-attempt", "evaded", "switch", "half-guard", "heal", "stage", "energy", "faint", "win"]) {
    assert.ok(allEvents.some((e) => e.type === type), type);
  }
  assert.ok(allEvents.some((e) => e.type === "heal" && e.recovered > 0));
  assert.equal(match.winner, "player");
});

test("official poison is guaranteed, rounds like MHB, refreshes and ticks seven times", () => {
  const poison = skill("skill_027");
  const match = battle({ ...assets, skills: [poison], player: official("character_007"),
    enemy: [character({ hp: 125, element_1: "water" })], random: () => { throw Error("100% must not roll"); } });
  const victim = active(match, "enemy");
  go.changeEnergy(active(match), 6);
  const first = action(match, poison.skill_id);
  assert.equal(first.events.find(e => e.type === "residual").damage, 13);
  assert.equal(victim.statuses[0].turns, 6);
  const pass = () => go.resolveTurn(match, { player: wait, enemy: wait });
  pass();
  victim.hp = victim.maxHp;
  go.changeEnergy(active(match), 6);
  action(match, poison.skill_id);
  assert.equal(victim.statuses.length, 1);
  assert.equal(victim.statuses[0].turns, 6);
  victim.hp = victim.maxHp;
  for (let i = 0; i < 6; i++) assert.equal(pass().events.find(e => e.type === "residual").damage, 13);
  assert.equal(victim.statuses.length, 0);
  assert.ok(!pass().events.some(e => e.type === "residual"));
});

test("poison is retained and paused on the bench, and is blocked by evasion or immunity", () => {
  const original = skill("skill_053");
  const poisoner = character({ skillIds: [original.skill_id] });
  const match = battle({ ...assets, skills: [original, skill("skill_000")], player: [poisoner],
    enemy: [character({ element_1: "dark", evasion_percent: 100 }), character({ evasion_percent: 100 })] });
  go.changeEnergy(active(match), 6);
  const run = (enemy) => action(match, original.skill_id, enemy);
  run(wait);
  assert.equal(active(match, "enemy").statuses.length, 0);
  run({ type: "switch", index: 1 });
  const poisoned = active(match, "enemy");
  assert.equal(poisoned.statuses[0].turns, 6);
  const hp = poisoned.hp;
  go.resolveTurn(match, { player: wait, enemy: { type: "switch", index: 0 } });
  assert.equal(poisoned.hp, hp);
  assert.equal(poisoned.statuses[0].turns, 6);
  poisoned.statuses = [];
  go.resolveTurn(match, { player: wait, enemy: { type: "switch", index: 1 } });
  go.changeEnergy(active(match), 6);
  assert.ok(run(select("skill_000")).events.some(e => e.type === "evaded"));
  assert.equal(poisoned.statuses.length, 0);
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
  target.bind = { source, turns: 2, definition: officialEffects.get("しめつける") };
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
  assert.equal(active(match).statuses[0].turns, 6);
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

test("Spark Needle overrides only the water component without changing STAB", () => {
  const needle = skill("skill_018");
  const match = battle({ ...assets, player: official("character_005"),
    enemy: [character({ element_1: "water", element_2: "fire" })], skills: [needle] });
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
  const result = action(match, counter.skill_id, select());
  assert.equal(active(match).hp, 189);
  assert.equal(active(match, "enemy").hp, 183);
  assert.equal(result.events.find(e => e.type === "revenge").damage, 17);
});

test("recoil uses actual damage, never poisons and can produce a draw", () => {
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

test("zero damage from immunity or evasion never produces recoil", () => {
  const recoil = skill("skill_046");
  for (const dodge of [false, true]) {
    const match = battle({ ...assets, skills: [recoil, skill("skill_000")], player: [character({ skillIds: [recoil.skill_id] })],
      enemy: [character({ element_1: dodge ? "light" : "dark", evasion_percent: 100 })] });
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

test("unconfirmed speed power, fire boost, and burn remain unavailable", () => {
  for (const id of ["skill_015", "skill_020", "skill_038", "skill_056"]) {
    assert.match(go.unsupportedMoveReason(skill(id), assets), /未対応/);
  }
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
  assert.deepEqual(simulate(false), [40, 6, 70, 140]);
  assert.deepEqual(simulate(true), [80, 2, 105, 105]);
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
  const response = action(testBattle(counter), counter.skill_id, select());
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
  assert.throws(() => specialWait(match, "skill_041"), /HPが不足/);
  assert.equal(fighter.energy, 7);
  fighter.hp = 73;
  specialWait(match, "skill_041");
  assert.deepEqual([fighter.hp, fighter.decoy.hp, fighter.decoy.maxHp], [1, 72, 72]);
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
  assert.equal(fighter.hp, hp - 22);
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
  assert.equal(go.previewDamage(match, "enemy", { ...probe, element: "none", hit_type: "ignore_dodge" }).decoyDamage, 0);
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
  assert.match(go.checkAction(match, "player", select("skill_006")), /HPが不足/);
  tail.hp = 125;
  tail.decoy = { hp: 1, maxHp: 1 };
  assert.match(go.checkAction(match, "player", select("skill_006")), /すでに存在/);
  tail.decoy = null;
  assert.match(go.checkAction(match, "player", { ...select("skill_006"), switchIndex: 1 }), /交代先/);
  assert.match(go.checkAction(match, "player", { ...select("skill_006"), switchIndex: 99 }), /交代先/);
  const replacement = match.teams.player[2];
  const output = specialWait(match, "skill_006", 2);
  assert.equal(output.events.find(e => e.type === "switch").reason, "tail-purge");
  assert.deepEqual([tail.hp, tail.energy, tail.decoy, replacement.decoy.hp, replacement.hp], [42, 5, null, 41, 139]);
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
  outgoing.timedEffects.set("test", { starts: 1, expires: 3, definition: officialEffects.get("回避率UP") });
  specialWait(match, "skill_042", 1);
  assert.deepEqual([incoming.stages.phy_atk, incoming.stages.speed, incoming.decoy.hp], [2, -3, 10]);
  assert.deepEqual([incoming.hp, incoming.energy, incoming.statuses[0], ownPoison.turns], [67, 5, incomingPoison, 5]);
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
    fighter.bind = { source: active(match, "enemy"), turns: 3, definition: officialEffects.get("しめつける") };
    assert.match(go.checkAction(match, "player", voluntary(1)), /締め付け/);
    const after = specialWait(match, id, 1);
    assert.ok(after.events.some(e => e.type === "switch"));
    assert.equal(fighter.bind, null);
  }
});

test("post-attack switch needs a hit and a surviving user; a decoy hit still qualifies", () => {
  for (const mode of ["evaded", "immune", "no-bench", "decoy", "ko", "counter", "recoil"]) {
    const original = skill("skill_045");
    const move = mode === "recoil" ? { ...original, effect1: "反動ダメージ1/4", effect_target1: "self", effect_chance1: 100 } : original;
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

const normalizeGoPassive = vm.runInContext("geneOrderPassives.normalize", context);
const officialPassives = new Map(csv(read("data/passive.csv")).filter((row) => row.name)
  .map((row) => [row.passive_id, normalizeGoPassive(row, elements)]));
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
  assert.equal(officialPassives.size, 24);
  assert.equal([...officialPassives.values()].filter((p) => p.status === "implemented").length, 15);
  assert.equal([...officialPassives.values()].filter((p) => p.status === "pending").length, 9);
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

test("elemental immunity blocks water, neutral and fire before dodge, absorption, reflection or decoy", () => {
  for (const [id, element] of [["002", "water"], ["007", "none"], ["024", "fire"]]) {
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

test("all elemental use-stage passives apply to status, hit, evade or immunity on use", () => {
  for (const [id, element, stat, delta, mode] of [
    ["004", "wind", "speed", 1, "evaded"], ["009", "water", "phy_def", 1, "immune"],
    ["011", "light", "phy_atk", 1, "status"], ["012", "fire", "sp_def", 1, "hit"],
    ["013", "fire", "phy_atk", -1, "hit"], ["006", "none", "phy_atk", -1, "immune"],
  ]) {
    const move = { ...(mode === "status" ? { ...skill("skill_060"), skill_id: "strike" } : strike), element, cost: 0 };
    const enemyPassive = mode === "immune" ? (element === "water" ? "002" : "007") : "";
    const match = passiveBattle({ skills: [move], player: [withPassive(id)],
      enemy: [withPassive(enemyPassive, { element_1: "light" })] });
    active(match, "enemy").dodgeActive = mode === "evaded";
    const result = action(match);
    assert.equal(active(match).stages[stat], delta, id);
    assert.equal(passivesIn(result, "after-use").length, 1, id);
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
  holder.bind = { source: foe, turns: 1, definition: officialEffects.get("しめつける") };
  foe.hp = 1;
  foe.statuses.push({ definition: officialEffects.get("poison"), turns: 1 });
  const result = idle(match);
  const eventKinds = Array.from(result.events, (e) => e.type);
  assert.equal(eventKinds.filter((type) => type === "residual").length, 3);
  assert.ok(eventKinds.lastIndexOf("residual") < eventKinds.indexOf("passive"));
  assert.ok(eventKinds.lastIndexOf("passive") < eventKinds.indexOf("energy"));
  assert.deepEqual([holder.stages.phy_def, holder.stages.sp_def], [1, -1]);
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

test("special switch suspension does not repeat use passives and Relay transfers their resulting stage", () => {
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
    assert.equal(passivesIn(first, "after-use").length + passivesIn(second, "after-use").length, 1);
    assert.equal(passivesIn(second, "turn-end").length, 1);
    assert.equal(outgoing.passiveState.uses.get(1), 1);
    assert.equal(active(match).stages.speed, reason === "relay" ? 1 : 0);
  }
});

test("official GO teams replay starting EN, elemental immunity, a normal switch and turn-end stages", () => {
  const match = passiveBattle({ skills: officialSkills, player: official("character_003", "character_002"),
    enemy: official("character_009", "character_005") });
  assert.equal(active(match).energy, 4);
  const results = [];
  results.push(idle(match));
  results.push(go.resolveTurn(match, { player: voluntary(1), enemy: select("skill_029") }));
  results.push(go.resolveTurn(match, { player: wait, enemy: voluntary(1) }));
  results.push(idle(match));
  assert.equal(active(match).base.name, "メイジェリー");
  assert.equal(active(match).hp, active(match).maxHp);
  assert.equal(passivesIn(results[1], "element-immunity").length, 1);
  assert.equal(match.teams.enemy[0].passiveState.uses.get(1), 1);
  assert.equal(active(match, "enemy").stages.phy_atk, 2);
  assert.equal(match.turn, 5);
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
  const match = passiveBattle({ player: [withPassive("001", { hp: 50, element_1: "light" })],
    enemy: [character({ element_1: "fire" })] });
  const holder = active(match);
  assert.ok(go.previewDamage(match, "enemy", strike).survival);
  holder.halfGuard = 50;
  assert.equal(go.previewDamage(match, "enemy", strike).survival, null);
  const field = officialDefense.get("sp_protect");
  assert.ok(field);
  match.fields.player.set(field.battle_effect_id, { definition: field, starts: 1, expires: 3 });
  const guarded = go.previewDamage(match, "enemy", { ...strike, power: 115, attack_type: "special" });
  const unguarded = go.calculateDamage(active(match, "enemy"), holder, { ...strike, power: 115, attack_type: "special" }, chart);
  assert.ok(unguarded.survival);
  assert.equal(guarded.survival, null);
  assert.ok(guarded.damage < unguarded.damage);
});
