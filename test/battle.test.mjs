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
