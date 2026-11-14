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
  const TYPE_ALIASES = new Map([["start_energy", "starting_en"]]);
  const integer = (value) => Number.isInteger(value);
  const positive = (value) => value > 0;
  const limit = (value) => integer(value) && positive(value);
  const stat = (id) => STAT_ALIASES.get(id) ?? ([...STAT_ALIASES.values()].includes(id) ? id : null);
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
  const literalTarget = (target) => (id) => id === target ? {} : null;
  const stage = (phase, target = statTarget) => ({ phase, target, value: integer });
  const enabled = (value) => value >= 0;
  const definitions = new Map([
    ["starting_en", { phase: "battle-start", target: (id) => ["en", "none"].includes(id) ? {} : null,
      value: (value) => integer(value) && value >= 0 }],
    ["element_immunity", { phase: "element-immunity", target: elementalTarget, value: (value) => value >= 0 }],
    ["element_power_multiplier", { phase: "power", target: elementalTarget, value: positive }],
    ["on_use_element_stat_stage", stage("after-use", elementalStage)],
    ["turn_end_stat_stage", stage("turn-end")],
    ["on_hit_element_stat_stage", stage("body-hit", elementalStage)],
    ["on_entry_enemy_stat_stage", stage("entry")],
    ["on_dodge_action_stat_stage", stage("dodge-action")],
    ["on_evade_stat_stage", stage("evaded")],
    ["conditional_stat_multiplier", { phase: "stat-multiplier", target: statTarget, value: positive, condition: statCondition }],
    ["priority_move_hp_cost", { phase: "move-cost", target: literalTarget("hp"),
      value: (value) => value <= 0 && value >= -1, condition: (raw) => {
        const priority = Number(raw);
        return raw && integer(priority) ? { priority } : null;
      } }],
    ["hostile_status_move_immunity", { phase: "before-status-effect", target: literalTarget("none"), value: enabled }],
    ["on_hit_inflict_status", { phase: "body-hit-status", target: (id, elements, statuses) =>
      statuses.has(id) ? { statusId: id } : null, value: (value) => value >= 0 && value <= 1,
      condition: (raw) => ["physical", "special"].includes(raw) ? { attackType: raw } : null }],
    ["debuff_immunity", { phase: "before-stage", target: (id) => {
      const ability = id.endsWith("_down") && stat(id.slice(0, -5));
      return ability ? { stat: ability } : null;
    }, value: (value) => value >= 0 }],
    ["survive_once", { phase: "before-hp-damage", target: (id) => id === "hp_full_once" ? {} : null, value: limit }],
  ]);

  function elementalTarget(id, elements) {
    const canonical = element(id, elements);
    return canonical ? { element: canonical } : null;
  }

  function statCondition(raw) {
    if (raw === "status") return { kind: "status" };
    const match = /^(self|opponent)_hp_lte:(\d+)\/([1-9]\d*)$/.exec(raw);
    if (!match) return null;
    const numerator = Number(match[2]);
    const denominator = Number(match[3]);
    return Number.isSafeInteger(denominator) && numerator <= denominator
      ? { kind: match[1], numerator, denominator } : null;
  }

  function normalize(row, elements, statuses = new Set()) {
    const passive = normalizePassive(row);
    const issues = [];
    const effects = [];
    for (const original of passive.effects) {
      const { slot, target_id } = original;
      const type = TYPE_ALIASES.get(original.type) ?? original.type;
      const definition = definitions.get(type);
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
      const condition = definition.condition?.(safeText(row[field]));
      if (definition.condition && !condition) {
        issues.push({ field, value: row[field] });
        continue;
      }
      effects.push({ ...original, type, passive_type: type, phase: definition.phase, value, ...target, condition });
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
    return first(fighter, "before-stage", (effect) => effect.stat === stat && effect.value > 0);
  }

  function hasStatus(fighter) {
    return Boolean(fighter?.statuses?.length);
  }

  function statModifiers(fighter, stat, opponent) {
    if (fighter.fainted) return [];
    return matching(fighter, "stat-multiplier", (effect) => {
      if (effect.stat !== stat) return false;
      const { kind, numerator, denominator } = effect.condition;
      if (kind === "status") return hasStatus(fighter);
      const target = kind === "self" ? fighter : opponent;
      return target && target.hp > 0 && target.hp * denominator <= target.maxHp * numerator;
    });
  }

  function moveCosts(fighter, move) {
    return matching(fighter, "move-cost", (effect) => effect.value < 0 && move.priority >= effect.condition.priority)
      .map((effect) => ({ effect, damage: Math.floor(fighter.maxHp * -effect.value) }));
  }

  function statusMoveBlock(fighter, source, move) {
    if (move.category !== "status" || !externalPassiveSource(source, fighter)) return null;
    return first(fighter, "before-status-effect", (effect) => effect.value > 0);
  }

  function activate(fighter, side, effect, events, details = {}) {
    fighter.passiveState.uses.set(effect.slot, used(fighter, effect) + 1);
    const title = fighter.base.name + "の「" + effect.passive_name + "」";
    const message = passiveActivationLogEvents(fighter, effect)[0]?.text;
    events.push({ type: "passive", phase: effect.phase, actor: fighter.base.name, side, passive: effect.passive_id,
      slot: effect.slot, text: title + (message ? "：" + message : "が発動"), ...details });
  }

  return { normalize, matching, first, used, survive, blocksStage, hasStatus, statModifiers, moveCosts, statusMoveBlock, activate };
})();
