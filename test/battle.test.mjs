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
