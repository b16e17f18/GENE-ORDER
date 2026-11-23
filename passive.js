// Passive data helpers. Loaded as a classic script before battle-core.js and app.js.

const PASSIVE_EFFECT_TYPE_NONE = "none";
const PASSIVE_TARGET_DEBUFF = "debuff";
const PASSIVE_TARGET_EN_DOWN = "en_down";
const PASSIVE_TARGET_ENERGY_DOWN = "energy_down";
const PASSIVE_TARGET_CLEAR_BUFF = "clear_buff";
const PASSIVE_TARGET_ALL = "all";
const PASSIVE_TARGET_EN = "en";
const PASSIVE_TARGET_HP = "hp";
const PASSIVE_TARGET_PHYSICAL_DAMAGE = "physical_damage";
const PASSIVE_TARGET_SPECIAL_DAMAGE = "special_damage";
const PASSIVE_TYPE_EFFECT_CHANCE_UP = "effect_chance_up";
const PASSIVE_TYPE_ELEMENT_DAMAGE_UP = "element_damage_up";
const PASSIVE_TYPE_LOW_HP_DAMAGE_UP = "low_hp_damage_up";
const PASSIVE_TYPE_DAMAGE_CUT = "damage_cut";
const PASSIVE_TYPE_TURN_END_STAT_UP = "turn_end_stat_up";
const PASSIVE_TYPE_TURN_END_STAT_DOWN = "turn_end_stat_down";
const PASSIVE_TYPE_DAMAGE_DRAIN = "damage_drain";
const PASSIVE_TYPE_SURVIVE_ONCE = "survive_once";
const PASSIVE_TYPE_TWO_TURN_SKIP_ONCE = "two_turn_skip_once";
const PASSIVE_TYPE_SWITCH_HEAL = "switch_heal";
const PASSIVE_TYPE_STATUS_MOVE_PRIORITY_UP = "status_move_priority_up";
const PASSIVE_TYPE_HEAL_BLOCK = "heal_block";
const PASSIVE_TYPE_PASSIVE_PIERCE = "passive_pierce";
const PASSIVE_TYPE_FIELD_EFFECT_IMMUNITY = "field_effect_immunity";
const PASSIVE_STATUS_IMMUNITY_ALL_EFFECT_IDS = new Set([
  "poison",
  "paralysis",
  "sleep",
  "burn",
  "blood",
]);

function normalizePassive(row) {
  const passive = {
    passive_id: safeText(row.passive_id),
    name: safeText(row.name),
    passive_type1: safeText(row.passive_type1, PASSIVE_EFFECT_TYPE_NONE),
    target_id1: safeText(row.target_id1, PASSIVE_EFFECT_TYPE_NONE),
    value1: number(row.value1),
    passive_type2: safeText(row.passive_type2, PASSIVE_EFFECT_TYPE_NONE),
    target_id2: safeText(row.target_id2, PASSIVE_EFFECT_TYPE_NONE),
    value2: number(row.value2),
    passive_type3: safeText(row.passive_type3, PASSIVE_EFFECT_TYPE_NONE),
    target_id3: safeText(row.target_id3, PASSIVE_EFFECT_TYPE_NONE),
    value3: number(row.value3),
    text: csvText(row.text),
    trigger_text1: csvText(row.trigger_text1),
    trigger_text2: csvText(row.trigger_text2),
    trigger_text3: csvText(row.trigger_text3),
  };
  passive.effect1 = normalizePassiveEffect(passive, 1);
  passive.effect2 = normalizePassiveEffect(passive, 2);
  passive.effect3 = normalizePassiveEffect(passive, 3);
  passive.effects = [passive.effect1, passive.effect2, passive.effect3].filter(
    (effect) => effect.type && effect.type !== PASSIVE_EFFECT_TYPE_NONE,
  );
  return passive;
}

function normalizePassiveEffect(passive, slot) {
  const type = safeText(passive[`passive_type${slot}`], PASSIVE_EFFECT_TYPE_NONE);
  return {
    passive_id: passive.passive_id,
    passive_name: passive.name,
    name: passive.name,
    slot,
    type,
    passive_type: type,
    target_id: safeText(passive[`target_id${slot}`], PASSIVE_EFFECT_TYPE_NONE),
    value: number(passive[`value${slot}`]),
    trigger_text: csvText(passive[`trigger_text${slot}`]),
  };
}

function passiveEffectsOf(fighter) {
  if (Array.isArray(fighter?.passiveEffects)) return fighter.passiveEffects;
  if (Array.isArray(fighter?.passive?.effects)) return fighter.passive.effects;
  return [];
}

function findPassiveEffect(fighter, predicate) {
  return passiveEffectsOf(fighter).find(predicate) ?? null;
}

function hasPassiveEffect(fighter, predicate) {
  return Boolean(findPassiveEffect(fighter, predicate));
}

function passiveEffectType(passiveEffect) {
  return safeText(passiveEffect?.type ?? passiveEffect?.passive_type, PASSIVE_EFFECT_TYPE_NONE);
}

function passiveEffectTargetId(passiveEffect) {
  return safeText(passiveEffect?.target_id, PASSIVE_EFFECT_TYPE_NONE);
}

function passiveEffectValue(passiveEffect) {
  return number(passiveEffect?.value);
}

function passiveTargetMatches(passiveEffect, targetId) {
  return passiveEffectTargetId(passiveEffect) === targetId;
}

function passiveTargetMatchesAny(passiveEffect, targetIds) {
  return targetIds.includes(passiveEffectTargetId(passiveEffect));
}

function externalPassiveSource(actor, target) {
  return Boolean(actor && target && actor !== target);
}

function passiveActivationLogEvents(target, passiveEffect) {
  const triggerText = csvText(passiveEffect?.trigger_text);
  return triggerText && triggerText !== PASSIVE_EFFECT_TYPE_NONE
    ? [{ type: "log", text: triggerText }]
    : [];
}

function startEnergyFromPassiveEffects(passiveEffects, fallbackEnergy) {
  const passiveEffect = (passiveEffects ?? []).find((effect) => (
    passiveEffectType(effect) === "start_energy" &&
    passiveEffectTargetId(effect) === PASSIVE_TARGET_EN
  ));
  return passiveEffect ? passiveEffectValue(passiveEffect) : fallbackEnergy;
}

function initialEnergyFromPassive(fighter, fallbackEnergy) {
  return startEnergyFromPassiveEffects(passiveEffectsOf(fighter), fallbackEnergy);
}

function effectChanceMultiplierFromPassive(actor) {
  const passiveEffect = findPassiveEffect(actor, (effect) => (
    passiveEffectType(effect) === PASSIVE_TYPE_EFFECT_CHANCE_UP &&
    passiveTargetMatches(effect, PASSIVE_TARGET_ALL)
  ));
  return passiveEffect ? passiveEffectValue(passiveEffect) / 100 : 1;
}

function effectChanceWithPassive(actor, baseChance) {
  return Math.min(100, number(baseChance) * effectChanceMultiplierFromPassive(actor));
}

function moveElementTargetsForPassive(move) {
  if (typeof moveElements === "function") return moveElements(move);

  const elements = [move?.element, move?.element2]
    .map((element) => safeText(element, PASSIVE_EFFECT_TYPE_NONE))
    .filter((element) => element && element !== PASSIVE_EFFECT_TYPE_NONE);
  return [...new Set(elements)];
}

function passiveElementDamageTargetMatches(passiveEffect, move) {
  const targetId = passiveEffectTargetId(passiveEffect);
  if (targetId === PASSIVE_TARGET_ALL) return true;

  const moveElementTargets = moveElementTargetsForPassive(move);
  if (targetId === PASSIVE_EFFECT_TYPE_NONE) return moveElementTargets.length === 0;
  return moveElementTargets.includes(targetId);
}

function elementDamageMultiplierFromPassive(actor, move) {
  const passiveEffect = findPassiveEffect(actor, (effect) => (
    passiveEffectType(effect) === PASSIVE_TYPE_ELEMENT_DAMAGE_UP &&
    passiveElementDamageTargetMatches(effect, move)
  ));
  return passiveEffect ? 1 + passiveEffectValue(passiveEffect) / 100 : 1;
}

function lowHpDamageMultiplierFromPassive(actor, move) {
  if (!actor || number(actor.maxHp) <= 0 || number(actor.hp) * 100 > number(actor.maxHp) * 33) {
    return 1;
  }

  const passiveEffect = findPassiveEffect(actor, (effect) => (
    passiveEffectType(effect) === PASSIVE_TYPE_LOW_HP_DAMAGE_UP &&
    passiveElementDamageTargetMatches(effect, move)
  ));
  return passiveEffect ? 1 + passiveEffectValue(passiveEffect) / 100 : 1;
}

function passivePierceEffect(actor) {
  return findPassiveEffect(actor, (effect) => (
    passiveEffectType(effect) === PASSIVE_TYPE_PASSIVE_PIERCE &&
    passiveTargetMatches(effect, PASSIVE_TARGET_ALL)
  ));
}

function ignoresOpponentPassives(actor, move, passiveOwner) {
  return Boolean(
    actor &&
    move &&
    passiveOwner &&
    actor !== passiveOwner &&
    !move.isBattleEffectDamage &&
    safeText(move.category) === "attack" &&
    passivePierceEffect(actor)
  );
}

function fieldEffectImmunityPassiveEffect(fighter) {
  return findPassiveEffect(fighter, (effect) => (
    passiveEffectType(effect) === PASSIVE_TYPE_FIELD_EFFECT_IMMUNITY &&
    passiveTargetMatches(effect, PASSIVE_TARGET_ALL)
  ));
}

function hasFieldEffectImmunity(fighter) {
  return Boolean(fieldEffectImmunityPassiveEffect(fighter));
}

function ignoresOpponentFieldEffect(source, target, fieldEffect, context = {}) {
  if (!target || !fieldEffect || !hasFieldEffectImmunity(target)) return false;

  const sourceSide = safeText(context.sourceSide ?? fieldEffect.sourceSide ?? fieldEffect.source?.side);
  const targetSide = safeText(context.targetSide ?? fieldEffect.targetSide);
  if (sourceSide && targetSide) return sourceSide !== targetSide;

  return Boolean(source && source !== target);
}

function damageMultiplierFromPassive(target, move, context = {}) {
  if (!move || move.isBattleEffectDamage) return 1;
  if (ignoresOpponentPassives(context.actor, move, target)) return 1;
  const damageTarget = move.attack_type === "special"
    ? PASSIVE_TARGET_SPECIAL_DAMAGE
    : PASSIVE_TARGET_PHYSICAL_DAMAGE;
  const passiveEffect = findPassiveEffect(target, (effect) => (
    passiveEffectType(effect) === PASSIVE_TYPE_DAMAGE_CUT &&
    passiveTargetMatches(effect, damageTarget)
  ));
  return passiveEffect ? 1 - passiveEffectValue(passiveEffect) / 100 : 1;
}

function damageDrainPercentFromPassive(actor, move) {
  if (!move || move.isBattleEffectDamage || move.attack_type === "special") return 0;
  const passiveEffect = findPassiveEffect(actor, (effect) => (
    passiveEffectType(effect) === PASSIVE_TYPE_DAMAGE_DRAIN &&
    passiveTargetMatches(effect, PASSIVE_TARGET_PHYSICAL_DAMAGE)
  ));
  return passiveEffect ? passiveEffectValue(passiveEffect) : 0;
}

function switchHealPercentFromPassive(fighter) {
  const passiveEffect = switchHealPassiveEffect(fighter);
  return passiveEffect ? passiveEffectValue(passiveEffect) : 0;
}

function switchHealPassiveEffect(fighter) {
  return findPassiveEffect(fighter, (effect) => (
    passiveEffectType(effect) === PASSIVE_TYPE_SWITCH_HEAL &&
    passiveTargetMatches(effect, PASSIVE_TARGET_HP)
  ));
}

function statusMovePriorityBonusFromPassive(actor, move) {
  if (!move || safeText(move.category) === "attack") return 0;
  const passiveEffect = findPassiveEffect(actor, (effect) => (
    passiveEffectType(effect) === PASSIVE_TYPE_STATUS_MOVE_PRIORITY_UP &&
    passiveTargetMatches(effect, PASSIVE_TARGET_ALL)
  ));
  return passiveEffect ? passiveEffectValue(passiveEffect) : 0;
}

function movePriorityWithPassive(actor, move, basePriority) {
  return number(basePriority) + statusMovePriorityBonusFromPassive(actor, move);
}

function isImmediateHpHealingEffect(effect) {
  return Boolean(
    effect &&
      safeText(effect.effect_group) === "heal" &&
      safeText(effect.target_stat) === PASSIVE_TARGET_HP
  );
}

function isImmediateHpHealingStatusMove(move, effectLookup) {
  if (!move || safeText(move.category) === "attack") return false;

  return [move.effect1, move.effect2, move.effect3].some((effectId) => {
    const normalizedEffectId = safeText(effectId, PASSIVE_EFFECT_TYPE_NONE);
    if (!normalizedEffectId || normalizedEffectId === PASSIVE_EFFECT_TYPE_NONE) return false;
    return isImmediateHpHealingEffect(effectLookup?.get(normalizedEffectId));
  });
}

function findHealBlockForMove({ actor, opponent, move, effectLookup }) {
  if (!actor || !opponent || actor === opponent || opponent.fainted) return null;
  if (!isImmediateHpHealingStatusMove(move, effectLookup)) return null;

  return findPassiveEffect(opponent, (passiveEffect) => (
    passiveEffectType(passiveEffect) === PASSIVE_TYPE_HEAL_BLOCK &&
    passiveTargetMatches(passiveEffect, PASSIVE_TARGET_HP)
  ));
}

function turnEndStatUpFromPassive(fighter) {
  const passiveEffect = findPassiveEffect(fighter, (effect) => (
    passiveEffectType(effect) === PASSIVE_TYPE_TURN_END_STAT_UP
  ));
  return passiveEffect
    ? {
        passiveEffect,
        stat: passiveEffectTargetId(passiveEffect),
        value: passiveEffectValue(passiveEffect),
      }
    : null;
}

function turnEndStatDownFromPassive(fighter) {
  const passiveEffect = findPassiveEffect(fighter, (effect) => (
    passiveEffectType(effect) === PASSIVE_TYPE_TURN_END_STAT_DOWN
  ));
  return passiveEffect
    ? {
        passiveEffect,
        stat: passiveEffectTargetId(passiveEffect),
        value: passiveEffectValue(passiveEffect),
      }
    : null;
}

function surviveOncePassiveEffect(fighter, move, context = {}) {
  if (!fighter || !move || move.isBattleEffectDamage) return null;
  if (ignoresOpponentPassives(context.actor, move, fighter)) return null;
  return findPassiveEffect(fighter, (effect) => (
    passiveEffectType(effect) === PASSIVE_TYPE_SURVIVE_ONCE &&
    passiveTargetMatches(effect, PASSIVE_EFFECT_TYPE_NONE)
  ));
}

function twoTurnSkipOncePassiveEffect(fighter, move) {
  if (!fighter || !move) return null;
  return findPassiveEffect(fighter, (effect) => (
    passiveEffectType(effect) === PASSIVE_TYPE_TWO_TURN_SKIP_ONCE &&
    passiveTargetMatches(effect, PASSIVE_TARGET_ALL)
  ));
}

function findBlockingEffectPassive({ actor, target, effect, move }) {
  if (!effect || !target) return null;
  if (ignoresOpponentPassives(actor, move, target)) return null;

  const effectId = safeText(effect.effect_id);
  const effectGroup = safeText(effect.effect_group);
  const isExternal = externalPassiveSource(actor, target);
  return findPassiveEffect(target, (passiveEffect) => {
    const type = passiveEffectType(passiveEffect);

    if (type === "status_immunity") {
      return passiveTargetMatches(passiveEffect, effectId) ||
        (
          passiveTargetMatches(passiveEffect, PASSIVE_TARGET_ALL) &&
          PASSIVE_STATUS_IMMUNITY_ALL_EFFECT_IDS.has(effectId)
        );
    }

    if (type === "debuff_immunity") {
      return isExternal &&
        effectGroup === "debuff" &&
        passiveTargetMatchesAny(passiveEffect, [PASSIVE_TARGET_DEBUFF, effectId]);
    }

    if (type === "en_down_immunity") {
      return isExternal &&
        effectGroup === "energy_down" &&
        passiveTargetMatchesAny(passiveEffect, [
          PASSIVE_TARGET_EN_DOWN,
          PASSIVE_TARGET_ENERGY_DOWN,
          PASSIVE_TARGET_ALL,
          effectId,
        ]);
    }

    if (type === "clear_buff_immunity") {
      return isExternal &&
        effectGroup === "clear_buff" &&
        passiveTargetMatchesAny(passiveEffect, [
          PASSIVE_TARGET_CLEAR_BUFF,
          PASSIVE_TARGET_ALL,
          effectId,
        ]);
    }

    return false;
  });
}

function findBlockingBattleEffectPassive({ actor, target, battleEffect, move }) {
  if (!battleEffect || !target || !externalPassiveSource(actor, target)) return null;
  if (ignoresOpponentPassives(actor, move, target)) return null;

  const battleEffectId = safeText(battleEffect.battle_effect_id);
  return findPassiveEffect(target, (passiveEffect) => (
    passiveEffectType(passiveEffect) === "battle_effect_immunity" &&
    passiveTargetMatches(passiveEffect, battleEffectId)
  ));
}


/* GO uses the same master slots as MHB, with its own effect and target semantics. */
const geneOrderPassives = (() => {
  const ELEMENT_ALIASES = new Map([["neutral", "none"], ["flash", "light"]]);
  const STAT_ALIASES = new Map([
    ["pa", "phy_atk"], ["pd", "phy_def"], ["sa", "sp_atk"], ["sd", "sp_def"], ["sp", "speed"],
  ]);
  const integer = (value) => Number.isInteger(value);
  const stat = (id) => STAT_ALIASES.get(String(id).toLowerCase()) ?? ([...STAT_ALIASES.values()].includes(id) ? id : null);
  const element = (id, elements) => {
    const canonical = ELEMENT_ALIASES.get(id) ?? id;
    return elements.has(canonical) ? canonical : null;
  };
  const elementalStage = (id, elements) => {
    const separator = id.indexOf("_");
    if (separator < 0) return null;
    const type = element(id.slice(0, separator), elements);
    const ability = stat(id.slice(separator + 1));
    return type && ability ? { element: type, stat: ability } : null;
  };

  const statTarget = (id) => {
    const ability = stat(id);
    return ability ? { stat: ability } : null;
  };
  const statusTarget = (id, elements, statuses) => id === "all" || statuses.has(id) ? { statusId: id } : null;
  const energyTarget = id => ["en", "none"].includes(id) ? {} : null;
  const attackTarget = id => ["physical", "special", "all"].includes(id) ? { attackType: id } : null;
  const literalTarget = (target) => (id) => id === target ? {} : null;
  const priorityTargets = new Map([
    ["all", move => ["attack", "status"].includes(move.category)],
    ["status", move => move.category === "status"],
    ["attack", move => move.category === "attack"],
    ["physical", move => move.category === "attack" && move.attack_type === "physical"],
    ["special", move => move.category === "attack" && move.attack_type === "special"],
  ]);
  const definitions = new Map([
    ["starting_en", { phase: "battle-start", target: (id) => ["en", "none"].includes(id) ? {} : null, targetKind: "energy" }],
    ["element_immunity", { phase: "element-immunity", target: elementalTarget, targetKind: "element" }],
    ["element_damage_multiplier", { phase: "incoming-damage", target: elementalTarget, targetKind: "element" }],
    ["element_power_multiplier", { phase: "power", target: elementalTarget, targetKind: "element" }],
    ["on_use_element_stat_stage", { phase: "after-use", target: elementalStage, targetKind: "element_stat" }],
    ["turn_end_stat_stage", { phase: "turn-end", target: statTarget, targetKind: "stat" }],
    ["on_hit_element_stat_stage", { phase: "body-hit", target: elementalStage, targetKind: "element_stat" }],
    ["on_entry_enemy_stat_stage", { phase: "entry", target: statTarget, targetKind: "stat" }],
    ["on_dodge_action_stat_stage", { phase: "dodge-action", target: statTarget, targetKind: "stat" }],
    ["on_evade_stat_stage", { phase: "evaded", target: statTarget, targetKind: "stat" }],
    ["conditional_damage_multiplier", { phase: "incoming-damage", target: attackTarget, targetKind: "attack_type",
      conditionKind: "stat_condition", condition: statCondition }],
    ["adaptive_stat_multiplier", { phase: "stat-multiplier", target: literalTarget("auto"), targetKind: "adaptive_stat" }],
    ["conditional_stat_multiplier", { phase: "stat-multiplier", target: statTarget, targetKind: "stat",
      conditionKind: "stat_condition", condition: statCondition }],
    ["conditional_priority_modifier", { phase: "move-priority", target: id => priorityTargets.has(id) ? { moveKind: id } : null,
      targetKind: "move_category", conditionKind: "priority_condition", condition: priorityCondition }],
    ["priority_move_hp_cost", { phase: "move-cost", target: literalTarget("hp"), targetKind: "hp",
      conditionKind: "priority", condition: (raw) => {
        const priority = Number(raw);
        return raw && integer(priority) ? { priority } : null;
      } }],
    ["hostile_status_move_immunity", { phase: "before-status-effect", target: literalTarget("none"), targetKind: "none" }],
    ["on_hit_inflict_status", { phase: "body-hit-status", target: (id, elements, statuses) =>
      statuses.has(id) ? { statusId: id } : null, targetKind: "status", conditionKind: "attack_type",
      condition: (raw) => ["physical", "special"].includes(raw) ? { attackType: raw } : null }],
    ["debuff_immunity", { phase: "before-stage", target: (id) => {
      const ability = id === "all" ? "all" : stat(id.endsWith("_down") ? id.slice(0, -5) : id);
      return ability ? { stat: ability } : null;
    }, targetKind: "debuff_stat" }],
    ["on_entry_stat_stage", { phase: "entry", target: statTarget, targetKind: "stat" }],
    ["on_entry_enemy_en_drain", { phase: "entry", target: energyTarget, targetKind: "energy" }],
    ["status_damage_immunity", { phase: "before-status-damage", target: statusTarget, targetKind: "status" }],
    ["on_status_stat_stage", { phase: "on-status-applied", target: statTarget, targetKind: "stat", conditionKind: "status_condition",
      condition: (raw, elements, statuses) => raw === "all" || statuses.has(raw) ? { statusId: raw } : null }],
    ["contact_damage_reflect", { phase: "after-body-hit", target: attackTarget, targetKind: "attack_type" }],
    ["on_ko_en_restore", { phase: "on-ko", target: energyTarget, targetKind: "energy" }],
    ["on_damage_en_restore", { phase: "body-hit-energy", target: energyTarget, targetKind: "energy" }],
    ["on_ko_stat_stage", { phase: "on-ko", target: statTarget, targetKind: "stat" }],
    ["on_switch_out_heal", { phase: "normal-switch-heal", target: literalTarget("hp"), targetKind: "hp" }],
    ["on_hit_enemy_stat_stage", { phase: "hit-enemy-stage", target: statTarget, targetKind: "stat" }],
    ["on_enemy_ko_en_restore", { phase: "replacement-entry", target: energyTarget, targetKind: "energy" }],
    ["damage_lifesteal", { phase: "after-damage", target: attackTarget, targetKind: "attack_type" }],
    ["critical_immunity", { phase: "before-critical", target: literalTarget("none"), targetKind: "none" }],
    ["effect_chance_multiplier", { phase: "effect-chance", target: literalTarget("none"), targetKind: "none" }],
    ["on_switch_out_stat_stage", { phase: "switch-out", target: statTarget, targetKind: "stat" }],
    ["status_immunity", { phase: "before-status-applied", target: statusTarget, targetKind: "status" }],
    ["heal_block", { phase: "before-move", target: literalTarget("hp"), targetKind: "hp" }],
    ["survive_once", { phase: "before-hp-damage", target: literalTarget("hp_full_once"), targetKind: "hp_full_once" }],
  ]);

  function readTypes(rows = []) {
    const types = new Map();
    const aliases = new Map();
    const issues = [];
    const issue = (row, field) => issues.push({ id: row.passive_type_id ?? "", field, value: row[field] ?? "" });
    const declared = new Set(rows.map((row) => row.passive_type_id));
    for (const row of rows) {
      const before = issues.length;
      const id = row.passive_type_id;
      if (!id || id === "none" || types.has(id)) issue(row, "passive_type_id");
      if (!row.name?.trim()) issue(row, "name");
      if (!row.description?.trim()) issue(row, "description");
      const handler = definitions.get(row.handler);
      if (!handler) issue(row, "handler");
      else {
        if (row.phase !== handler.phase) issue(row, "phase");
        if (row.target_kind !== handler.targetKind) issue(row, "target_kind");
        if (row.condition_kind !== (handler.conditionKind ?? "none")) issue(row, "condition_kind");
      }
      if (!["integer", "number"].includes(row.value_type)) issue(row, "value_type");
      const bound = (field) => String(row[field] ?? "").trim() === "" ? null : Number(row[field]);
      const min = bound("value_min");
      const max = bound("value_max");
      for (const [field, value] of [["value_min", min], ["value_max", max]]) {
        if (value !== null && !Number.isFinite(value)) issue(row, field);
      }
      if (min !== null && max !== null && (min > max || (min === max &&
        (row.min_inclusive !== "TRUE" || row.max_inclusive !== "TRUE")))) issue(row, "value_max");
      for (const field of ["min_inclusive", "max_inclusive"]) {
        if (!["TRUE", "FALSE"].includes(row[field])) issue(row, field);
      }
      if (issues.length !== before) continue;
      types.set(id, { ...row, target: handler.target, condition: handler.condition,
        value: (value) => (row.value_type !== "integer" || integer(value)) &&
          (min === null || (row.min_inclusive === "TRUE" ? value >= min : value > min)) &&
          (max === null || (row.max_inclusive === "TRUE" ? value <= max : value < max)) });
      for (const alias of String(row.aliases ?? "").split("|").filter(Boolean)) {
        if (alias === "none" || declared.has(alias) || aliases.has(alias)) issue(row, "aliases");
        else aliases.set(alias, id);
      }
    }
    for (const id of definitions.keys()) {
      if (!types.has(id)) issues.push({ id, field: "passive_type_id", value: "種別定義がありません" });
    }
    return { types, aliases, issues };
  }
  function elementalTarget(id, elements) {
    const canonical = element(id, elements);
    return canonical ? { element: canonical } : null;
  }

  function statCondition(raw) {
    if (raw === "status") return { kind: "status" };
    const match = /^(self|opponent)_hp_(lte|eq):(\d+)\/([1-9]\d*)$/.exec(raw);
    if (!match) return null;
    const numerator = Number(match[3]);
    const denominator = Number(match[4]);
    return Number.isSafeInteger(numerator) && Number.isSafeInteger(denominator) && numerator <= denominator
      ? { kind: match[1], operator: match[2], numerator, denominator } : null;
  }

  function priorityCondition(raw) {
    if (!raw) return { all: [] };
    const parts = raw.split("&").map(part => part.trim());
    if (parts.some(part => !part) || new Set(parts).size !== parts.length) return null;
    const all = parts.map(part => {
      if (["first_move_after_entry", "once_per_battle"].includes(part)) return { kind: part };
      if (part.startsWith("self_hp_reached_lte:")) {
        const parsed = statCondition(part.replace("self_hp_reached_lte:", "self_hp_lte:"));
        return parsed ? { ...parsed, kind: "self_hp_reached" } : null;
      }
      return statCondition(part);
    });
    return all.every(Boolean) ? { all } : null;
  }

  function copyState(fighter) {
    const state = fighter.passiveState ?? {};
    return { ...state, uses: new Map(state.uses ?? []), lowestHp: state.lowestHp && { ...state.lowestHp } };
  }

  function recordLowestHp(fighter) {
    const state = fighter.passiveState;
    if (!state || !Number.isFinite(fighter.hp) || !(fighter.maxHp > 0)) return;
    if (!state.lowestHp || fighter.hp * state.lowestHp.maxHp < state.lowestHp.hp * fighter.maxHp) {
      state.lowestHp = { hp: fighter.hp, maxHp: fighter.maxHp };
    }
  }

  function priorityDetails(fighter, move, opponent) {
    const effects = fighter.fainted ? [] : matching(fighter, "move-priority", effect =>
      priorityTargets.get(effect.moveKind)?.(move) && effect.condition.all.every(condition => {
        if (condition.kind === "first_move_after_entry") return !(fighter.passiveState?.entryMoves ?? 0);
        if (condition.kind === "once_per_battle") return used(fighter, effect) === 0;
        if (condition.kind === "self_hp_reached") {
          const low = fighter.passiveState?.lowestHp;
          return fighter.hp * condition.denominator <= fighter.maxHp * condition.numerator ||
            Boolean(low && low.hp * condition.denominator <= low.maxHp * condition.numerator);
        }
        return conditionMatches(fighter, condition, opponent);
      }));
    const modifier = effects.reduce((sum, effect) => sum + effect.value, 0);
    return { base: move.priority, modifier, value: move.priority + modifier, effects };
  }

  function recordMoveUse(fighter, details, side, events) {
    for (const effect of details.effects) activate(fighter, side, effect, events,
      { priority: details.value, priorityDelta: effect.value });
    fighter.passiveState.entryMoves = (fighter.passiveState.entryMoves ?? 0) + 1;
  }

  function normalize(row, elements, statuses = new Set(), catalog = readTypes()) {
    const passive = normalizePassive(row);
    const issues = [];
    const effects = [];
    for (const original of passive.effects) {
      const { slot, target_id } = original;
      const type = catalog.aliases.get(original.type) ?? original.type;
      const definition = catalog.types.get(type);
      if (!definition) {
        issues.push({ field: "passive_type" + slot, value: original.type });
        continue;
      }
      const target = definition.target(target_id, elements, statuses);
      if (!target) {
        issues.push({ field: "target_id" + slot, value: target_id });
        continue;
      }
      const raw = row["value" + slot];
      const value = Number(raw);
      if (!String(raw ?? "").trim() || !Number.isFinite(value) || !definition.value(value)) {
        issues.push({ field: "value" + slot, value: raw });
        continue;
      }
      const field = "condition" + slot;
      const condition = definition.condition?.(safeText(row[field]), elements, statuses);
      if (definition.condition && !condition) {
        issues.push({ field, value: row[field] });
        continue;
      }
      effects.push({ ...original, type, passive_type: type, phase: definition.phase, handler: definition.handler, value, ...target, condition });
    }
    const unconfigured = [passive.effect1, passive.effect2, passive.effect3].filter((effect) =>
      effect.type === PASSIVE_EFFECT_TYPE_NONE && (effect.target_id !== PASSIVE_EFFECT_TYPE_NONE || effect.value !== 0));
    const status = !passive.name && !passive.text ? "unset" :
      effects.length ? (issues.length || unconfigured.length ? "partial" : "implemented") : "pending";
    return { ...passive, effects, issues, unconfigured, status };
  }

  function matching(fighter, phase, predicate = () => true) {
    return passiveEffectsOf(fighter).filter((effect) => effect.phase === phase && predicate(effect));
  }

  function first(fighter, phase, predicate = () => true) {
    return findPassiveEffect(fighter, (effect) => effect.phase === phase && predicate(effect));
  }

  function used(fighter, effect) {
    return fighter.passiveState?.uses.get(effect.slot) ?? 0;
  }

  function survive(fighter, damage) {
    if (fighter.hp !== fighter.maxHp || damage < fighter.hp || fighter.fainted) return null;
    return first(fighter, "before-hp-damage", (effect) => used(fighter, effect) < effect.value);
  }

  function blocksStage(fighter, stat, delta, source) {
    if (delta >= 0 || !externalPassiveSource(source, fighter)) return null;
    return first(fighter, "before-stage", (effect) => (effect.stat === stat || effect.stat === "all") && effect.value > 0);
  }

  function hasStatus(fighter) {
    return Boolean(fighter?.statuses?.length);
  }

  function conditionMatches(fighter, condition, opponent) {
    const { kind, numerator, denominator, operator = "lte" } = condition;
    if (kind === "status") return hasStatus(fighter);
    const target = kind === "self" ? fighter : opponent;
    if (!target || target.hp <= 0) return false;
    const current = target.hp * denominator, threshold = target.maxHp * numerator;
    return operator === "eq" ? current === threshold : current <= threshold;
  }

  // Compare immutable base stats only; never invoke effectiveStat here.
  function adaptiveStat(fighter, opponent) {
    if (!opponent || opponent.fainted) return null;
    let selected = null, largestGap = 0;
    for (const stat of ["phy_atk", "phy_def", "sp_atk", "sp_def", "speed"]) {
      const gap = opponent.base[stat] - fighter.base[stat];
      if (gap > largestGap) { selected = stat; largestGap = gap; }
    }
    return selected;
  }

  function statModifiers(fighter, stat, opponent) {
    if (fighter.fainted) return [];
    return matching(fighter, "stat-multiplier", effect => effect.handler === "adaptive_stat_multiplier"
      ? adaptiveStat(fighter, opponent) === stat
      : effect.stat === stat && conditionMatches(fighter, effect.condition, opponent));
  }

  function damageModifiers(fighter, move, opponent) {
    return matching(fighter, "incoming-damage", effect => effect.handler === "conditional_damage_multiplier"
      ? move.category === "attack" && (effect.attackType === "all" || effect.attackType === move.attack_type) &&
        conditionMatches(fighter, effect.condition, opponent)
      : geneOrderBattle.moveHasElement(move, effect.element));
  }

  function useStageEffects(fighter, move) {
    if (move?.category !== "attack") return [];
    return matching(fighter, "after-use", effect => geneOrderBattle.moveHasElement(move, effect.element));
  }

  function moveCosts(fighter, move) {
    return matching(fighter, "move-cost", (effect) => effect.value < 0 && move.priority >= effect.condition.priority)
      .map((effect) => ({ effect, damage: Math.floor(fighter.maxHp * -effect.value) }));
  }

  function statusMoveBlock(fighter, source, move) {
    if (move.category !== "status" || !externalPassiveSource(source, fighter)) return null;
    return first(fighter, "before-status-effect", (effect) => effect.value > 0);
  }

  function statusBlock(fighter, statusId, phase = "before-status-applied") {
    return first(fighter, phase, effect => effect.statusId === "all" || effect.statusId === statusId);
  }

  function attackEffects(fighter, phase, move) {
    return move?.category === "attack" ? matching(fighter, phase, effect =>
      effect.attackType === "all" || effect.attackType === move.attack_type) : [];
  }

  function effectChance(fighter, chance) {
    return Math.min(100, Math.max(0, matching(fighter, "effect-chance").reduce((n, effect) => n * effect.value, chance)));
  }

  function healBlock(actor, opponent, move, effects) {
    if (!actor || !opponent || actor === opponent || opponent.fainted || !isImmediateHpHealingStatusMove(move, effects)) return null;
    return first(opponent, "before-move");
  }

  // GO has no critical-hit damage or critical RNG. Expose the gate for future callers only.
  function criticalBlock(fighter) { return first(fighter, "before-critical"); }

  function activate(fighter, side, effect, events, details = {}) {
    fighter.passiveState.uses.set(effect.slot, used(fighter, effect) + 1);
    const title = fighter.base.name + "の「" + effect.passive_name + "」";
    const message = passiveActivationLogEvents(fighter, effect)[0]?.text;
    events.push({ type: "passive", phase: effect.phase, actor: fighter.base.name, side, passive: effect.passive_id,
      slot: effect.slot, text: title + (message ? "：" + message : "が発動"), ...details });
  }

  return { readTypes, normalize, matching, first, used, survive, blocksStage, hasStatus, conditionMatches, priorityCondition, priorityDetails, recordMoveUse, copyState, recordLowestHp, adaptiveStat, statModifiers, damageModifiers, useStageEffects, moveCosts, statusMoveBlock, statusBlock, attackEffects, effectChance, healBlock, criticalBlock, activate };
})();
