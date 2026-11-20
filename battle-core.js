// GENE ORDER v0.50. The inherited MHB entry points below remain separate.
const geneOrderBattle = (() => {
  const START_ENERGY = 1;
  const MAX_ENERGY = 7;
  const SWITCH_PRIORITY = 6;
  const MIN_STAGE = -6;
  const MAX_STAGE = 6;
  const STATS = ["phy_atk", "phy_def", "sp_atk", "sp_def", "speed"];
  const DAMAGE_STATS = { physical: ["phy_atk", "phy_def"], special: ["sp_atk", "sp_def"] };
  const SIDES = ["player", "enemy"];
  const opposingSide = (side) => side === "player" ? "enemy" : "player";

  function roundHalfDown(value) {
    const integer = Math.floor(value);
    return integer + Number(value - integer > 0.5);
  }

  function resetStages(fighter) {
    fighter.stages = Object.fromEntries(STATS.map((stat) => [stat, 0]));
  }

  function stageDelta(fighter, stat, delta) {
    if (!STATS.includes(stat) || !Number.isInteger(delta)) throw new Error("無効な能力ランク変更です。");
    const before = fighter.stages[stat];
    return Math.max(MIN_STAGE, Math.min(MAX_STAGE, before + delta)) - before;
  }

  function changeStage(fighter, stat, delta, { source, side, events } = {}) {
    const applied = stageDelta(fighter, stat, delta);
    const blocked = geneOrderPassives.blocksStage(fighter, stat, delta, source);
    if (blocked) {
      if (events) geneOrderPassives.activate(fighter, side, blocked, events, { stat, blockedDelta: delta });
      return 0;
    }
    fighter.stages[stat] += applied;
    return applied;
  }

  const statusNumber = (value, fallback) => value == null || String(value).trim() === "" ? fallback : Number(value);
  const activeStatuses = (fighter) => (fighter.statuses ?? []).filter(status => status.turns == null || status.turns > 0);

  function statusStatMultiplier(fighter, stat) {
    return activeStatuses(fighter).reduce((product, { definition }) => definition.stat_modifier_target === stat
      ? product * statusNumber(definition.stat_modifier_multiplier, 1) : product, 1);
  }

  function actionFailureChance(fighter) {
    return activeStatuses(fighter).reduce((failure, { definition }) =>
      failure + (1 - failure / 100) * statusNumber(definition.action_failure_chance, 0), 0);
  }

  function effectiveStat(fighter, stat, { opponent, fieldMultiplier = 1 } = {}) {
    if (!STATS.includes(stat)) throw new Error("無効な能力です。");
    const stage = fighter.stages[stat];
    const base = fighter.base[stat];
    const ranked = stage >= 0 ? base * (2 + stage) / 2 : base * 2 / (2 - stage);
    const passives = geneOrderPassives.statModifiers(fighter, stat, opponent);
    const statusMultiplier = statusStatMultiplier(fighter, stat);
    const multiplier = passives.reduce((product, effect) => product * effect.value, 1) * statusMultiplier;
    // Keep existing rounding when no status or passive modifier is active.
    const adjusted = passives.length || statusMultiplier !== 1 ? ranked * multiplier : Math.max(1, Math.floor(ranked));
    return { value: Math.max(1, Math.floor(adjusted * fieldMultiplier)), multiplier, statusMultiplier, passives };
  }

  function statValue(fighter, stat, context) {
    return effectiveStat(fighter, stat, context).value;
  }

  function changeEnergy(fighter, delta) {
    if (!Number.isInteger(delta)) throw new Error("無効なEN変化量です。");
    fighter.energy = Math.max(0, Math.min(MAX_ENERGY, fighter.energy + delta));
  }

  // Base EN data stays immutable. These shared helpers read active individual modifiers.
  function effectiveEnergyCharge(fighter, turn) {
    let charge = fighter.base.energy_charge;
    const effects = [...(fighter.timedEffects?.values() ?? [])].filter(entry => activeTimed(entry, turn) && effectKind(entry.definition) === "en-charge-modifier");
    for (const { definition } of effects) if (definition.damage_type === "none") charge += definition.damage_value;
    for (const { definition } of effects) if (definition.damage_type === "multiplier") charge *= definition.damage_value;
    return Math.max(0, Math.floor(charge));
  }

  function effectiveMoveCost(fighter, move, turn) {
    if (fighter.pending?.moveId === move.skill_id) return 0; // Paid when charging started.
    if (move.skill_id === COMMON_MOVE_ID) return move.cost; // Common dodge is a basic action.
    let cost = move.cost;
    for (const entry of fighter.timedEffects?.values() ?? []) {
      if (activeTimed(entry, turn) && effectKind(entry.definition) === "en-cost-modifier") cost += entry.definition.damage_value;
    }
    return Math.max(0, cost);
  }

  function effectivenessFor(element, defender, chart, override) {
    const row = chart.get(element);
    const defendingTypes = [defender.element_1, defender.element_2].filter((type) => type != null);
    if (!row || !defendingTypes.length) throw new Error("攻撃技または防御側の属性が未定義です。");
    let multiplier = 1;
    for (const type of new Set(defendingTypes)) {
      const factor = override?.element === type ? override.modifier : row.get(type);
      if (!Number.isFinite(factor) || factor < 0) throw new Error(`属性相性が未定義です (${element}/${type})。`);
      multiplier *= factor;
    }
    return multiplier;
  }

  // Shared by resolution and future previews/AI. Modifiers are resolved inputs.
  function calculateDamage(attacker, defender, move, chart, modifiers = {}) {
    if (move.category !== "attack") return { damage: 0, reason: "not-attack" };
    const stats = Object.hasOwn(DAMAGE_STATS, move.attack_type) && DAMAGE_STATS[move.attack_type];
    if (!stats || move.element2 != null) throw new Error("未対応の攻撃分類または複合属性技です。");

    const effects = moveEffects(move).filter(({ table, chance }) => table === "battleEffects" && chance > 0)
      .map(({ id }) => modifiers.battleEffects?.get(id)).filter(Boolean);
    const override = effects.find((effect) => battleEffectKind(effect) === "type-override");
    const powerPassives = modifiers.power == null
      ? geneOrderPassives.matching(attacker, "power", (effect) => effect.element === move.element) : [];
    const power = modifiers.power ?? resolvePower(move, attacker, defender, modifiers, effects, powerPassives);
    const immunity = geneOrderPassives.first(defender, "element-immunity",
      (effect) => effect.element === move.element && effect.value > 0);
    if (immunity) return { damage: 0, decoyDamage: 0, power, reason: "passive-immune", powerPassives, immunity };
    const pierce = move.hit_type === "guard_break"
      ? effects.find((effect) => battleEffectKind(effect) === "position")?.modifier ?? 1 : 1;
    const absorb = activeDefense(defender, "absorb", modifiers.turn ?? 1);
    const reflection = activeDefense(defender, "reflection", modifiers.turn ?? 1);
    const revenge = activeDefense(defender, "revenge", modifiers.turn ?? 1);
    const attackStat = modifiers.attackStat ?? (move.attack_stat || stats[0]);
    const { value: attack, passives: attackPassives } = effectiveStat(attacker, attackStat, { opponent: defender });
    const { value: defense, passives: defensePassives } = effectiveStat(defender, stats[1], { opponent: attacker });
    const guard = activeDefense(defender, "guard", modifiers.turn ?? 1);
    const cut = Math.max(guard?.definition.damage_cut ?? (defender.halfGuard ?? 0), absorb?.definition.damage_cut ?? 0);
    const damagePassives = geneOrderPassives.matching(defender, "incoming-damage",
      (effect) => effect.element === move.element);
    const passiveMultiplier = damagePassives.reduce((multiplier, effect) => multiplier * effect.value, 1);
    const finalMultiplier = (modifiers.finalMultiplier ?? (100 - cut * pierce) / 100) *
      fieldDamageMultiplier(move, modifiers.targetFields ?? [], modifiers.turn ?? 1, pierce) * passiveMultiplier;
    if (!Number.isFinite(power) || power <= 0 || !Number.isFinite(finalMultiplier) || finalMultiplier < 0) {
      throw new Error("技威力または最終補正が無効です。");
    }

    const baseDamage = Math.floor(22 * power * attack / (50 * defense)) + 2;
    const stab = [attacker.base.element_1, attacker.base.element_2].includes(move.element) ? 1.25 : 1;
    const afterStab = roundHalfDown(baseDamage * stab);
    const effectiveness = effectivenessFor(move.element, defender.base, chart, override);
    const afterEffectiveness = Math.floor(afterStab * effectiveness);
    const reason = attackBlockReason(defender, move, effectiveness === 0 || finalMultiplier === 0 ||
      modifiers.blocked === true);
    const virtualDamage = reason ? 0 : Math.max(1, roundHalfDown(afterEffectiveness * finalMultiplier));
    const decoy = virtualDamage > 0 ? defender.decoy : null;
    const decoyDamage = decoy ? Math.min(virtualDamage, decoy.hp) : 0;
    const absorbed = virtualDamage > 0 && !decoy && absorb?.definition.element === move.element;
    const reflected = virtualDamage > 0 && !decoy && !absorbed && reflection && guardApplies(reflection.definition, move);
    const incoming = decoy || absorbed || reflected ? 0 : virtualDamage;
    // Only the direct damage to the fighter can spend this passive's use.
    const survival = incoming > 0 ? geneOrderPassives.survive(defender, incoming) : null;
    const damage = survival ? defender.hp - 1 : incoming;
    // Only this incoming attack can trigger a response. Returned damage is applied directly to HP.
    const response = reflected ? reflection : damage > 0 && damage < defender.hp ? revenge : null;
    return { damage, decoyDamage, power, attack, defense, baseDamage, stab, afterStab, effectiveness, afterEffectiveness,
      reason: decoy ? "decoy" : absorbed ? "absorbed" : reflected ? "reflected" : reason ?? "hit",
      response: response ? { id: response.id, damage: Math.max(1, Math.round(virtualDamage * response.definition.damage_value / 100)) } : null,
      powerPassives, attackPassives, defensePassives, damagePassives, survival, heal: absorbed ? Math.floor(defender.maxHp * absorb.definition.modifier / 100) : 0 };
  }


  function attackBlockReason(defender, move, immune) {
    if (immune) return "blocked";
    if (defender.pending?.definition.battle_effect_group === "position" &&
      move.hit_type !== defender.pending.definition.weak_hit_type) return "position-miss";
    if (defender.dodgeActive && move.hit_type !== "ignore_dodge") return "evaded";
    return null;
  }

  function activeDefense(fighter, kind, turn) {
    return [...(fighter.defenses?.values() ?? [])].find((effect) => activeTimed(effect, turn) &&
      battleEffectKind(effect.definition) === kind);
  }

  const COMMON_MOVE_ID = "skill_000";
  const DODGE_ID = "bf_dodge_guard";
  const GUARD_ID = "bf_half_guard";
  const HP_ONE_RULE = "bf_hp_exact_1";

  const TARGET_STATUS_RULE = "target_status";
  const validAttackStat = (move) => !move.attack_stat || (move.category === "attack" && STATS.includes(move.attack_stat));

  function effectKind(effect) {
    if (!effect || effect.damage_value === "" || !Number.isFinite(Number(effect.damage_value))) return null;
    const value = Number(effect.damage_value);
    const statusMultiplier = statusNumber(effect.stat_modifier_multiplier, 1);
    const failure = statusNumber(effect.action_failure_chance, 0);
    const modifierTarget = effect.stat_modifier_target;
    if (!Number.isFinite(statusMultiplier) || statusMultiplier <= 0 || !Number.isFinite(failure) || failure < 0 || failure > 100 ||
      (modifierTarget && modifierTarget !== "none" && !STATS.includes(modifierTarget)) ||
      (statusMultiplier !== 1 && !STATS.includes(modifierTarget))) return null;
    if (effect.damage_type === "stat_stage" && STATS.includes(effect.target_stat) && Number.isInteger(value) && Math.abs(value) <= MAX_STAGE &&
      ((effect.effect_group === "buff" && value > 0) || (effect.effect_group === "debuff" && value < 0))) return "stage";
    const duration = Number(effect.turn);
    const lasting = Number.isSafeInteger(duration) && duration > 0;
    if (["status", "control"].includes(effect.effect_group) && effect.damage_type === "none" && value === 0 && lasting) return "status";
    if (effect.damage_type === "percent_maxhp" && value > 0 && lasting) {
      if (effect.effect_group === "damage") return "status-damage";
      if (effect.effect_group === "bind") return "bind-damage";
    }
    const delay = Number(effect.start_delay ?? 1);
    if (effect.effect_group === "evasion" && effect.damage_type === "multiplier" &&
      effect.target_stat === "evasion_percent" && value >= 0 && lasting &&
      Number.isSafeInteger(delay) && delay >= 0) return "evasion-boost";
    if (effect.effect_group === "clear_field") return "clear-field";
    if (effect.effect_group === "clear_buff") return "clear-buff";
    if (effect.effect_group === "recoil" && effect.damage_type === "actual_damage_percent" && value > 0) return "recoil";
    if (effect.effect_group === "en_drain" && effect.target_stat === "en" && effect.damage_type === "none" && Number.isSafeInteger(value) && value >= 0) return "en-drain";
    if (effect.effect_group === "en_charge_modifier" && effect.target_stat === "cost_charge" && lasting &&
      ((effect.damage_type === "none" && Number.isSafeInteger(value)) || (effect.damage_type === "multiplier" && Number.isSafeInteger(value) && value >= 0))) return "en-charge-modifier";
    if (effect.effect_group === "en_cost_modifier" && effect.target_stat === "en" && effect.damage_type === "none" && Number.isSafeInteger(value) && lasting) return "en-cost-modifier";
    if (effect.effect_group === "heal" && effect.target_stat === "en" && effect.damage_type === "none" && Number.isSafeInteger(value)) return "recover-en";
    if (effect.effect_group !== "heal" || value < 0) return null;
    if (effect.target_stat === "hp" && ["percent_maxhp", "fixed_hp"].includes(effect.damage_type)) return "heal";
    if (effect.target_stat === "hp" && effect.damage_type === "actual_damage_percent") return "drain";
    if (effect.target_stat === "en" && effect.damage_type === "none" && Number.isInteger(value)) return "recover-en";
    return null;
  }

  // Fractions keep exact HP costs even when max HP is divisible by the denominator.
  function hpRatio(value) {
    const match = /^(\d+)\/([1-9]\d*)$/.exec(value ?? "");
    if (!match) return null;
    const numerator = Number(match[1]);
    const denominator = Number(match[2]);
    return Number.isSafeInteger(numerator) && Number.isSafeInteger(denominator) &&
      numerator > 0 && numerator <= denominator ? [numerator, denominator] : null;
  }

  function battleEffectKind(effect) {
    if (!effect || Number(effect.turn) < 1) return null;
    if (effect.battle_effect_group === "field_speed") return "field-speed";
    if (effect.battle_effect_group === "guard" && effect.battle_effect_id !== GUARD_ID &&
      (["phy_damage", "sp_damage"].includes(effect.guard_type) || effect.guard_type?.endsWith("_damage")) &&
      Number(effect.damage_cut) > 0 && Number(effect.damage_cut) <= 100) return "field-guard";
    const cut = Number(effect.damage_cut);
    if (effect.battle_effect_id === DODGE_ID && effect.battle_effect_group === DODGE_ID) return "dodge";
    if (effect.battle_effect_id === GUARD_ID && effect.battle_effect_group === "guard" && cut >= 0 && cut <= 100) return "guard";
    const group = effect.battle_effect_group;
    const modifier = Number(effect.modifier);
    const positiveModifier = modifier > 0 && Number.isFinite(modifier);
    if (group === "next_element_power" && effect.element && positiveModifier) return "next-element-power";
    if (group === "bf_water_absorb_guard" && effect.element && positiveModifier && cut >= 0 && cut <= 100) return "absorb";
    if (group === "bf_water_super_effective" && effect.element && positiveModifier) return "type-override";
    if (group === "trigger" && effect.damage_type === "received_damage_rate" && effect.damage_value > 0) return "revenge";
    if (group === "reflection" && effect.damage_type === "received_damage_rate" && effect.damage_value > 0) return "reflection";
    if (group === "charge") return "charge";
    if (group === "relay") return "relay";
    if (group === "change_character") return "post-attack";
    if (["decoy", "bf_shed_tail"].includes(group) && hpRatio(effect.hp_cost_ratio) && hpRatio(effect.decoy_hp_ratio)) {
      if (group === "decoy") return "decoy";
      if (Number.isInteger(Number(effect.max_uses)) && Number(effect.max_uses) > 0) return "tail-purge";
    }
    if (group === "position" && effect.weak_hit_type && positiveModifier && modifier <= 1) return "position";
    if (group === "hit_power" && effect.damage_type === "multiplier" && effect.damage_value > 0) return "hit-power";
    return null;
  }

  const SPEED_ADVANTAGE_RULE = "speed_advantage";

  function hasSpeedPowerRules(powerRules) {
    const rules = [...(powerRules?.get(SPEED_ADVANTAGE_RULE) ?? [])].sort((a, b) => a.min_ratio - b.min_ratio);
    let start = 0;
    return rules.length > 0 && rules.every(({ min_ratio, max_ratio, power_multiplier }, index) => {
      if (min_ratio !== start || !Number.isFinite(power_multiplier) || power_multiplier <= 0) return false;
      if (index === rules.length - 1) return max_ratio === null;
      if (!Number.isFinite(max_ratio) || max_ratio <= start) return false;
      start = max_ratio;
      return true;
    });
  }

  function powerRuleAt(group, powerRules, value) {
    if (![HP_ONE_RULE, TARGET_STATUS_RULE, SPEED_ADVANTAGE_RULE, "en_value"].includes(group)) return null;
    return powerRules?.get(group)?.find(({ min_ratio: min, max_ratio: max, power_multiplier: multiplier }) =>
      Number.isFinite(multiplier) && multiplier > 0 && (min === max ? value === min :
        value >= min && (max === null || value < max))) ?? null;
  }

  function resolvePower(move, attacker, defender, { powerRules, speedFields = {} }, effects, powerPassives) {
    const group = move.power_rule;
    let multiplier = 1;
    if (group && group !== "none") {
      let value;
      if (group === SPEED_ADVANTAGE_RULE) {
        const own = statValue(attacker, "speed", { opponent: defender, fieldMultiplier: speedFields.attacker });
        const other = statValue(defender, "speed", { opponent: attacker, fieldMultiplier: speedFields.defender });
        value = own / other * 100;
      } else {
        value = group === "en_value" ? attacker.energy : group === HP_ONE_RULE
          ? Number(attacker.hp === 1) : Number(geneOrderPassives.hasStatus(defender));
      }
      const rule = powerRuleAt(group, powerRules, value);
      if (!rule) throw new Error(`未対応の威力ルール ${group}`);
      multiplier = rule.power_multiplier;
    }
    if (attacker.tookDirectDamage) {
      const boost = effects.find((effect) => battleEffectKind(effect) === "hit-power");
      if (boost) multiplier *= boost.damage_value;
    }
    for (const effect of powerPassives) multiplier *= effect.value;
    multiplier *= attacker.nextElementPower?.get(move.element)?.modifier ?? 1;
    return Math.min(Math.round(move.power * multiplier), move.power_cap ?? Infinity);
  }

  function chargeSlot(move, data) {
    return moveEffects(move).find(({ id, table, chance }) => table === "battleEffects" && chance > 0 &&
      ["charge", "position"].includes(battleEffectKind(data.battleEffects?.get(id))));
  }

  function moveEffects(move) {
    return [
      ...[1, 2, 3].map((slot) => ({
        id: move[`effect${slot}`], chance: move[`effect_chance${slot}`],
        target: move[`effect_target${slot}`] ?? "enemy", table: "effects",
      })),
      ...[1, 2].map((slot) => ({
        id: move[`battle_effect${slot}`], chance: move[`battle_effect_chance${slot}`],
        target: "self", table: "battleEffects",
      })),
    ].filter(({ id }) => id && id !== "none");
  }

  function moveAvailability(move, data = {}) {
    if (!move) return { issues: ["技が登録されていません。"], supportedParts: 0 };
    const issues = [];
    const attack = move.category === "attack";
    const normalHit = !move.hit_type || ["normal", "ignore_dodge", "sure_hit"].includes(move.hit_type) ||
      (move.hit_type === "guard_break" && Boolean(chargeSlot(move, data)));
    const validAttack = Object.hasOwn(DAMAGE_STATS, move.attack_type) && move.element != null &&
      move.element2 == null && (!move.target || move.target === "enemy");
    let supportedParts = Number(attack && validAttack);
    if (attack && !validAttack) issues.push("攻撃分類・属性・対象");
    if (!validAttackStat(move)) issues.push(`攻撃参照能力 ${move.attack_stat}`);
    if (!attack && move.category !== "status") issues.push("技分類");
    if (!normalHit) issues.push(`命中種別 ${move.hit_type}`);
    const group = move.power_rule;
    if (group && group !== "none") {
      const supported = group === SPEED_ADVANTAGE_RULE ? hasSpeedPowerRules(data.powerRules)
        : (group === "en_value" ? Array.from({ length: MAX_ENERGY + 1 }, (_, en) => en) : [0, 1])
          .every((value) => powerRuleAt(group, data.powerRules, value));
      if (!supported) issues.push(`威力ルール ${group}`);
    }
    const slots = moveEffects(move);
    for (const { id, target, table } of slots) {
      const definition = data[table]?.get(id);
      const kind = table === "effects" ? effectKind(definition) : battleEffectKind(definition);
      if (kind) supportedParts++;
      else issues.push(id);
      if (kind === "bind-damage" && target !== "enemy") issues.push("締め付けの対象は相手のみ");
    }
    for (const slot of slots) {
      const effect = data.battleEffects?.get(slot.id);
      if (slot.table === "battleEffects" && ["type-override", "hit-power", "charge", "position"].includes(battleEffectKind(effect)) &&
          slot.chance !== 100) issues.push(`${slot.id}の発動率`);
    }
    if (!attack && !supportedParts && !issues.length) issues.push("変化技の効果未設定");
    return { issues, supportedParts };
  }

  function unsupportedMoveReason(move, data) {
    const { issues } = moveAvailability(move, data);
    return issues.length ? `v0.32未対応（${issues.join("、")}）` : "";
  }

  function rollChance(chance, random) {
    return chance >= 100 || (chance > 0 && random() * 100 < chance);
  }

  function activeTimed(effect, turn) {
    return effect.starts <= turn && turn < effect.expires;
  }

  function fieldEffectsForSide(battle, side) {
    return battle.fields[side];
  }

  function setTimedEffect(effects, definition, turn, delay = 0) {
    const id = definition.battle_effect_id ?? definition.effect_id;
    const current = effects.get(id);
    const start = turn + delay;
    const effect = { id, definition, createdTurn: turn,
      starts: current && activeTimed(current, turn) ? turn : start,
      expires: start + definition.turn };
    effects.set(id, effect);
    return effect;
  }

  function tickTimedEffects(effects, turn, onExpire, include = () => true) {
    for (const [id, effect] of effects) {
      if (effect.expires <= turn + 1 && include(effect)) {
        effects.delete(id);
        onExpire(effect);
      }
    }
  }

  function guardApplies(effect, move) {
    const type = effect.guard_type;
    if (type === "phy_damage") return move.attack_type === "physical";
    if (type === "sp_damage") return move.attack_type === "special";
    return type === move.element + "_damage";
  }

  function fieldDamageMultiplier(move, effects, turn, pierce) {
    let multiplier = 1;
    for (const effect of effects) {
      if (activeTimed(effect, turn) && effect.definition.battle_effect_group === "guard" &&
        guardApplies(effect.definition, move)) multiplier *= (100 - effect.definition.damage_cut * pierce) / 100;
    }
    return multiplier;
  }

  function fieldSpeedMultiplier(battle, side) {
    let fieldMultiplier = 1;
    for (const effect of fieldEffectsForSide(battle, side).values()) {
      if (activeTimed(effect, battle.turn) && effect.definition.battle_effect_group === "field_speed") {
        fieldMultiplier *= effect.definition.damage_value;
      }
    }
    return fieldMultiplier;
  }

  function speedDetails(battle, side) {
    return effectiveStat(activeFighter(battle, side), "speed", {
      opponent: activeFighter(battle, opposingSide(side)), fieldMultiplier: fieldSpeedMultiplier(battle, side),
    });
  }

  function effectiveSpeed(battle, side) {
    return speedDetails(battle, side).value;
  }

  function evasionRate(fighter, turn) {
    let rate = fighter.base.evasion_percent ?? 0;
    for (const effect of (fighter.timedEffects ?? new Map()).values()) {
      if (activeTimed(effect, turn) && effectKind(effect.definition) === "evasion-boost") rate *= effect.definition.damage_value;
    }
    return Math.max(0, Math.min(100, rate));
  }

  function movePayment(actor, move, pending) {
    const hpCosts = pending ? [] : geneOrderPassives.moveCosts(actor, move);
    const hpAfterCost = actor.hp - hpCosts.reduce((sum, cost) => sum + cost.damage, 0);
    return { hpCosts, hpAfterCost };
  }

  function evaluateMoveDamage(battle, side, move) {
    const other = opposingSide(side);
    const actor = activeFighter(battle, side);
    const pending = actor.pending?.moveId === move.skill_id ? actor.pending : null;
    const { hpCosts, hpAfterCost } = movePayment(actor, move, pending);
    if (hpAfterCost <= 0) return { damage: 0, decoyDamage: 0, reason: "hp-cost-faint", hpCosts };
    const attacker = hpAfterCost === actor.hp ? actor : { ...actor, hp: hpAfterCost };
    const target = activeFighter(battle, other);
    if (target.fainted && move.category === "attack") return { damage: 0, reason: "no-target", hpCosts };
    const result = calculateDamage(attacker, target, move, battle.effectiveness, {
      power: pending?.power, powerRules: battle.powerRules, battleEffects: battle.battleEffects,
      targetFields: fieldEffectsForSide(battle, other).values(), turn: battle.turn,
      speedFields: move.power_rule === SPEED_ADVANTAGE_RULE
        ? { attacker: fieldSpeedMultiplier(battle, side), defender: fieldSpeedMultiplier(battle, other) } : undefined,
    });
    const nextPower = !pending && move.category === "attack" ? attacker.nextElementPower.get(move.element) : undefined;
    if (pending || !chargeSlot(move, battle)) return { ...result, hpCosts, nextPower };
    const { immunity, survival, ...charge } = result;
    return { ...charge, hpCosts, nextPower, damage: 0, decoyDamage: 0, response: null, heal: 0, reason: "charging" };
  }

  function hpEffectAmount(kind, recipient, damage, value, damageType) {
    if (kind === "heal" && damageType === "fixed_hp") return Math.floor(value);
    const base = kind === "heal" ? recipient.maxHp : damage;
    return Math.floor(base * value / 100);
  }

  // Forecast this move against the current field. Other actions and upkeep are separate.
  function previewDamage(battle, side, move) {
    const result = evaluateMoveDamage(battle, side, move);
    const actor = activeFighter(battle, side);
    const defender = activeFighter(battle, opposingSide(side));
    const hpCost = Math.min(actor.hp, result.hpCosts.reduce((sum, entry) => sum + entry.damage, 0));
    const actualDamage = Math.min(defender.hp, result.damage);
    const actualHeal = Math.min(defender.maxHp - defender.hp, result.heal ?? 0);
    const responseDamage = Math.min(actor.hp - hpCost, result.response?.damage ?? 0);
    let actorHp = actor.hp - hpCost - responseDamage;
    let targetHp = defender.hp - actualDamage + actualHeal;
    const hpEffects = [];
    if (!["hp-cost-faint", "no-target"].includes(result.reason)) {
      const statusBlock = geneOrderPassives.statusMoveBlock(defender, actor, move);
      const hidden = defender.pending?.definition.battle_effect_group === "position" &&
        move.hit_type !== defender.pending.definition.weak_hit_type;
      const releasing = actor.pending?.moveId === move.skill_id;
      for (const { id, chance, target, table } of moveEffects(move)) {
        if (table !== "effects" || !(chance > 0) || !actorHp) continue;
        const self = target === "self";
        if (self && releasing) continue;
        if (!self && (!targetHp || result.reason === "charging" ||
          (move.category === "attack" && result.reason !== "hit") || (move.category === "status" && (hidden || statusBlock)))) continue;
        const definition = battle.effects.get(id);
        const kind = effectKind(definition);
        if (!["heal", "drain", "recoil"].includes(kind)) continue;
        const recipient = self ? actor : defender;
        const hp = self ? actorHp : targetHp;
        const amount = hpEffectAmount(kind, recipient, actualDamage + (result.decoyDamage ?? 0), definition.damage_value, definition.damage_type);
        const delta = kind === "recoil" ? -Math.min(hp, amount) : Math.min(recipient.maxHp - hp, amount);
        if (!delta) continue;
        hpEffects.push({ id, kind, target: self ? "self" : "enemy", chance, delta });
        if (chance >= 100) {
          if (self) actorHp += delta;
          else targetHp += delta;
        }
      }
    }
    const wakesTarget = wakesOnAttackDamage(defender, actualDamage);
    const targetAfterDamage = wakesTarget ? { ...defender, statuses: defender.statuses.filter(({ definition }) => definition.effect_id !== "sleep") } : defender;
    const failureChance = actionFailureChance(actor);
    const executionChance = 1 - failureChance / 100;
    return { ...result, energyCost: effectiveMoveCost(actor, move, battle.turn), hpCost, actualDamage, actualHeal, responseDamage, hpEffects, actorHp, targetHp,
      wakesTarget, targetActionFailureChanceAfterDamage: actionFailureChance(targetAfterDamage),
      actionFailureChance: failureChance, executionChance, expectedDamage: actualDamage * executionChance,
      expectedDecoyDamage: (result.decoyDamage ?? 0) * executionChance, expectedHpCost: hpCost * executionChance };
  }

  function previewRelease(battle, side, move, start) {
    if (start.reason !== "charging") return null;
    const index = battle.active[side];
    const actor = activeFighter(battle, side);
    const team = battle.teams[side].slice();
    const charging = { ...actor, hp: start.actorHp, stages: { ...actor.stages }, pending: {
      moveId: move.skill_id, power: start.power, definition: battle.battleEffects.get(chargeSlot(move, battle).id),
    } };
    for (const { id, chance, target, table } of moveEffects(move)) {
      const effect = battle.effects.get(id);
      if (table === "effects" && target === "self" && chance === 100 && effectKind(effect) === "stage") {
        changeStage(charging, effect.target_stat, effect.damage_value);
      }
    }
    for (const effect of geneOrderPassives.matching(charging, "after-use", (effect) => effect.element === move.element)) {
      changeStage(charging, effect.stat, effect.value);
    }
    team[index] = charging;
    return previewDamage({ ...battle, teams: { ...battle.teams, [side]: team } }, side, move);
  }

  // MHB sleep wakes only on direct attack damage to the body, before secondary effects.
  function wakesOnAttackDamage(fighter, damage) {
    return damage > 0 && activeStatuses(fighter).some(({ definition }) => definition.effect_id === "sleep");
  }

  function clearSleepOnAttackDamage(fighter, damage, side, events) {
    if (!wakesOnAttackDamage(fighter, damage)) return;
    fighter.statuses = fighter.statuses.filter(({ definition }) => definition.effect_id !== "sleep");
    if (fighter.hp > 0) events.push({ type: "awakened", side, actor: fighter.base.name, effect: "sleep" });
  }

  function applyStatus(recipient, definition, event, events) {
    const existing = recipient.statuses.find((status) => status.definition.effect_id === definition.effect_id);
    if (existing) existing.turns = Math.max(existing.turns, definition.turn);
    else recipient.statuses.push({ definition, turns: definition.turn });
    events.push({ ...event, type: "status-applied", name: definition.name, turns: existing?.turns ?? definition.turn });
  }

  function applyMoveEffects(battle, side, actor, defender, move, actualDamage, blocked, events, phase) {
    const slots = moveEffects(move);
    const statusBlock = geneOrderPassives.statusMoveBlock(defender, actor, move);
    let blockedStatus = false;
    let dodgeAction = false;
    for (const { id, chance, target, table } of slots) {
      if (actor.fainted ||
        (phase === "charge" && target !== "self") || (phase === "release" && target === "self")) continue;
      const recipient = target === "self" ? actor : defender;
      if (recipient === defender && (defender.fainted || blocked)) continue;
      if (recipient === defender && defender.pending?.definition.battle_effect_group === "position" &&
        move.category === "status" && move.hit_type !== defender.pending.definition.weak_hit_type) continue;
      const effect = battle[table].get(id);
      const kind = table === "battleEffects" ? battleEffectKind(effect) : effectKind(effect);
      if (["charge", "position", "type-override", "hit-power", "decoy", "tail-purge", "relay", "post-attack"].includes(kind) ||
        (kind === "revenge" && slots.some((slot) => battleEffectKind(battle.battleEffects.get(slot.id)) === "reflection"))) continue;
      if (recipient === defender && statusBlock && kind !== "clear-field") {
        if (!blockedStatus && chance > 0) {
          geneOrderPassives.activate(defender, opposingSide(side), statusBlock, events);
          blockedStatus = true;
        }
        continue;
      }
      if (!rollChance(chance, battle.random)) continue;
      const event = { side: recipient === actor ? side : (side === "player" ? "enemy" : "player"),
        actor: recipient.base.name, effect: id };
      if (table === "battleEffects") {
        if (kind === "dodge") {
          if (dodgeAction) continue;
          dodgeAction = true;
          applyPassiveStages(actor, side, "dodge-action", events);
          const chance = evasionRate(actor, battle.turn);
          const success = rollChance(chance, battle.random);
          if (success) {
            actor.dodgeActive = true;
            setTimedEffect(actor.defenses, effect, battle.turn);
          }
          events.push({ ...event, type: "dodge-attempt", chance, success });
        } else if (kind === "next-element-power") {
          const replaced = actor.nextElementPower.has(effect.element);
          actor.nextElementPower.set(effect.element, effect);
          events.push({ ...event, type: "next-power-ready", element: effect.element, multiplier: effect.modifier, replaced });
        } else if (["field-guard", "field-speed"].includes(kind)) {
          const timed = setTimedEffect(fieldEffectsForSide(battle, side), effect, battle.turn, Number(effect.start_delay ?? 0));
          events.push({ ...event, type: "field-applied", name: effect.name, starts: timed.starts, expires: timed.expires });
        } else {
          const timed = setTimedEffect(actor.defenses, effect, battle.turn);
          if (kind === "guard" || kind === "absorb") {
            events.push({ ...event, type: "half-guard", cut: effect.damage_cut });
          }
          if (kind !== "guard") events.push({ ...event, type: "defense-ready", name: effect.name, expires: timed.expires });
        }
        continue;
      }
      const value = effect.damage_value;
      if (kind === "recoil") {
        const damage = hpEffectAmount(kind, recipient, actualDamage, value);
        if (damage > 0) events.push({ ...event, type: "recoil", damage: applyHPDamage(recipient, damage) });
      } else if (kind === "clear-buff") {
        for (const stat of STATS) {
          if (recipient.stages[stat] <= 0) continue;
          const delta = changeStage(recipient, stat, -recipient.stages[stat]);
          events.push({ ...event, type: "stage", stat, delta, stage: recipient.stages[stat] });
        }
      } else if (kind === "bind-damage") {
        recipient.bind = { source: actor, turns: effect.turn, definition: effect };
        events.push({ ...event, type: "bind", turns: effect.turn });
      } else if (kind === "status-damage" || kind === "status") {
        applyStatus(recipient, effect, event, events);
      } else if (kind === "evasion-boost") {
        const timed = setTimedEffect(recipient.timedEffects, effect, battle.turn, effect.start_delay ?? 1);
        events.push({ ...event, type: "evasion-boost", starts: timed.starts,
          delay: timed.starts - battle.turn, duration: timed.expires - timed.starts, multiplier: value });
      } else if (kind === "clear-field") {
        const fields = fieldEffectsForSide(battle, event.side);
        const removed = [...fields.values()].map(({ definition }) => definition.name);
        fields.clear();
        events.push({ ...event, type: "field-cleared", removed });
      } else if (kind === "stage") {
        const delta = changeStage(recipient, effect.target_stat, value, { source: actor, side: event.side, events });
        events.push({ ...event, type: "stage", stat: effect.target_stat, delta, stage: recipient.stages[effect.target_stat] });
      } else if (kind === "en-charge-modifier" || kind === "en-cost-modifier") {
        const replaced = recipient.timedEffects.has(id);
        const timed = setTimedEffect(recipient.timedEffects, effect, battle.turn);
        events.push({ ...event, type: "en-modifier", name: effect.name, turns: effect.turn, replaced, kind,
          charge: effectiveEnergyCharge(recipient, battle.turn), expires: timed.expires });
      } else if (kind === "en-drain") {
        const before = recipient.energy;
        changeEnergy(recipient, -value);
        const lost = before - recipient.energy;
        const userBefore = actor.energy;
        changeEnergy(actor, lost);
        events.push({ ...event, type: "en-drain", user: actor.base.name, userSide: side, lost, recovered: actor.energy - userBefore });
      } else if (kind === "recover-en") {
        const before = recipient.energy;
        changeEnergy(recipient, value);
        events.push({ ...event, type: "effect-energy", recovered: recipient.energy - before });
      } else {
        if (kind === "drain" && actualDamage === 0) continue;
        const before = recipient.hp;
        recipient.hp = Math.min(recipient.maxHp, before + hpEffectAmount(kind, recipient, actualDamage, value, effect.damage_type));
        events.push({ ...event, type: "heal", recovered: recipient.hp - before });
      }
    }
  }

  function applyPassiveStages(fighter, side, phase, events, { move, target = fighter } = {}) {
    if (fighter.fainted || target.fainted) return;
    const targetSide = target === fighter ? side : opposingSide(side);
    const effects = geneOrderPassives.matching(fighter, phase, (effect) => !move || effect.element === move.element);
    for (const effect of effects) {
      const delta = changeStage(target, effect.stat, effect.value, { source: fighter, side: targetSide, events });
      if (delta) geneOrderPassives.activate(fighter, side, effect, events, { stat: effect.stat, delta, target: target.base.name });
    }
  }

  function applyEntryPassive(battle, side, events) {
    applyPassiveStages(activeFighter(battle, side), side, "entry", events, {
      target: activeFighter(battle, opposingSide(side)),
    });
  }

  function applyBodyHitPassives(battle, side, attacker, defender, move, events) {
    const targetSide = opposingSide(side);
    applyPassiveStages(defender, targetSide, "body-hit", events, { move });
    if (defender.fainted || attacker.fainted) return;
    for (const effect of geneOrderPassives.matching(defender, "body-hit-status",
      (entry) => entry.condition.attackType === move.attack_type)) {
      const definition = battle.effects.get(effect.statusId);
      if (!["status-damage", "status"].includes(effectKind(definition)) || !rollChance(effect.value * 100, battle.random)) continue;
      geneOrderPassives.activate(defender, targetSide, effect, events, { target: attacker.base.name });
      applyStatus(attacker, definition, { side, actor: attacker.base.name, effect: effect.statusId }, events);
    }
  }

  function createFighter(character, passives) {
    if (!character?.name || ![character.hp, ...STATS.map((stat) => character[stat])]
      .every((value) => Number.isInteger(value) && value > 0)) throw new Error("戦闘個体の能力値が無効です。");
    if (!Number.isInteger(character.energy_charge) || character.energy_charge < 0) {
      throw new Error("戦闘個体のEN回復量が無効です。");
    }
    const fighter = { base: character, hp: character.hp, maxHp: character.hp, energy: START_ENERGY, fainted: false, dodgeActive: false, halfGuard: 0,
      statuses: [], timedEffects: new Map(), defenses: new Map(), nextElementPower: new Map(), bind: null, pending: null, tookDirectDamage: false, decoy: null, moveUses: new Map() };
    fighter.passive = passives.get(character.passive_id) ?? null;
    fighter.passiveEffects = fighter.passive?.effects ?? [];
    fighter.passiveState = { uses: new Map() };
    resetStages(fighter);
    return fighter;
  }

  function createBattle({ player, enemy, skills, effectiveness, effects = new Map(), battleEffects = new Map(), powerRules = new Map(),
    passives = new Map(), random = Math.random, manualSwitches = false, onSwitch = null, captureFrame = null }) {
    if (!player.length || !enemy.length) throw new Error("両チームに個体が必要です。");
    const teams = { player: player.map((base) => createFighter(base, passives)),
      enemy: enemy.map((base) => createFighter(base, passives)) };
    const startEvents = [];
    for (const side of SIDES) {
      for (const fighter of teams[side]) {
        const effect = geneOrderPassives.first(fighter, "battle-start");
        if (!effect) continue;
        changeEnergy(fighter, effect.value - fighter.energy);
        geneOrderPassives.activate(fighter, side, effect, startEvents, { energy: fighter.energy });
      }
    }
    const battle = {
      teams, startEvents,
      active: { player: 0, enemy: 0 }, fields: { player: new Map(), enemy: new Map() }, skills, effectiveness, effects, battleEffects, powerRules, random, turn: 1, winner: null, manualSwitches, onSwitch, captureFrame, pendingSwitch: null,
    };
    for (const side of SIDES) applyEntryPassive(battle, side, startEvents);
    return battle;
  }

  function activeFighter(battle, side) {
    return battle.teams[side][battle.active[side]];
  }

  function checkAction(battle, side, action) {
    const fighter = activeFighter(battle, side);
    if (battle.pendingSwitch) return "交代先の選択待ちです。";
    if (battle.winner || !fighter || fighter.fainted) return "行動できません。";
    if (fighter.pending && (action?.type !== "move" || action.moveId !== fighter.pending.moveId)) return "溜め技の予約行動が優先されます。";
    if (action?.type === "wait") return "";
    if (action?.type === "switch") {
      if (fighter.bind) return "締め付けで交代できません。";
      return switchTargets(battle, side).includes(action.index) ? "" : "交代先に指定できません。";
    }
    if (action?.type !== "move" || (action.moveId !== COMMON_MOVE_ID && !fighter.base.skillIds.includes(action.moveId))) return "選択できない技です。";
    const move = battle.skills.get(action.moveId);
    const unsupported = unsupportedMoveReason(move, battle);
    if (unsupported) return unsupported;
    if (!Number.isInteger(move.cost) || move.cost < 0) return "技の消費ENが無効です。";
    if ((move.category === "attack" && (!Number.isFinite(move.power) || move.power <= 0)) || !Number.isInteger(move.priority)) {
      return "技の威力または優先度が無効です。";
    }
    if (fighter.energy < effectiveMoveCost(fighter, move, battle.turn)) return "ENが不足しています。";
    const effect = specialSwitchEffect(move, battle);
    if (!effect) return "";
    const reason = battleEffectKind(effect.definition);
    if (reason === "decoy" || reason === "tail-purge") {
      const { hpAfterCost } = movePayment(fighter, move, fighter.pending);
      const error = decoyError(fighter, effect.definition, hpAfterCost > 0 ? hpAfterCost : fighter.hp);
      if (error) return error;
    }
    if (["tail-purge", "relay"].includes(reason) && !switchTargets(battle, side).length) return "生存している控えがいません。";
    if (reason !== "decoy" && action.switchIndex != null && !switchTargets(battle, side).includes(action.switchIndex)) {
      return "交代先に指定できません。";
    }
    return "";
  }

  function switchTargets(battle, side) {
    return battle.teams[side].flatMap((fighter, index) =>
      index !== battle.active[side] && !fighter.fainted && fighter.hp > 0 ? [index] : []);
  }

  function specialSwitchEffect(move, battle) {
    for (const slot of moveEffects(move)) {
      if (slot.table !== "battleEffects") continue;
      const definition = battle.battleEffects.get(slot.id);
      if (["decoy", "tail-purge", "relay", "post-attack"].includes(battleEffectKind(definition))) {
        return { definition, chance: slot.chance };
      }
    }
    return null;
  }

  function decoyValues(fighter, definition) {
    const fractionOfMaxHp = (ratio) => {
      const [numerator, denominator] = hpRatio(ratio);
      return Math.floor(fighter.maxHp * numerator / denominator);
    };
    return { cost: fractionOfMaxHp(definition.hp_cost_ratio), maxHp: fractionOfMaxHp(definition.decoy_hp_ratio) };
  }

  function decoyError(fighter, definition, hp = fighter.hp) {
    if (definition.max_uses != null && (fighter.moveUses.get(definition.battle_effect_id) ?? 0) >= definition.max_uses) {
      return "テールパージは使用済みです。";
    }
    if (fighter.decoy) return "デコイがすでに存在します。";
    const { cost, maxHp } = decoyValues(fighter, definition);
    if (maxHp < 1) return "デコイのHPが1未満になるため使用できません。";
    if (hp <= cost) return `デコイを出すためのHPが不足しています。消費は${cost}（最大HP基準）で、使用後にHPが1以上必要です。`;
    return "";
  }

  function createDecoy(fighter, definition, side, events) {
    const { cost, maxHp } = decoyValues(fighter, definition);
    fighter.hp -= cost;
    fighter.decoy = { hp: maxHp, maxHp };
    if (definition.max_uses != null) {
      const id = definition.battle_effect_id;
      fighter.moveUses.set(id, (fighter.moveUses.get(id) ?? 0) + 1);
    }
    events.push({ type: "decoy-created", side, actor: fighter.base.name, cost, maxHp });
  }

  function switchFighter(battle, side, index, reason, events, deferredEntries) {
    if (!switchTargets(battle, side).includes(index)) throw new Error("交代先に指定できません。");
    const from = activeFighter(battle, side);
    const to = battle.teams[side][index];
    const notify = (phase) => battle.onSwitch?.({ phase, battle, side, reason, from, to, events });
    notify("before-switch");
    notify("leave");
    const stages = reason === "relay" ? { ...from.stages } : null;
    const decoy = reason === "relay" || reason === "tail-purge" ? from.decoy : null;
    resetStages(from);
    from.timedEffects.clear();
    from.defenses.clear();
    from.nextElementPower.clear();
    from.dodgeActive = false;
    from.halfGuard = 0;
    from.pending = null;
    from.bind = null;
    from.decoy = null;
    from.tookDirectDamage = false;
    releaseBinds(battle, events, from);
    if (stages) to.stages = stages;
    to.decoy = decoy;
    battle.active[side] = index;
    notify("enter");
    if (deferredEntries) deferredEntries.push(side);
    else applyEntryPassive(battle, side, events);
    events.push({ type: reason === "replacement" ? "replacement" : "switch", side, reason,
      actor: from.base.name, target: to.base.name, inheritedStages: stages, decoyHp: decoy?.hp ?? 0 });
    notify("after-switch");
  }

  function previewSwitch(battle, side, index, reason, decoy = null) {
    const clone = (fighter) => ({ ...fighter, timedEffects: new Map(fighter.timedEffects),
      defenses: new Map(fighter.defenses), nextElementPower: new Map(fighter.nextElementPower), stages: { ...fighter.stages },
      passiveState: { uses: new Map(fighter.passiveState.uses) } });
    const other = opposingSide(side);
    const team = battle.teams[side].slice();
    team[battle.active[side]] = clone(activeFighter(battle, side));
    team[index] = clone(team[index]);
    const opponents = battle.teams[other].slice();
    opponents[battle.active[other]] = clone(activeFighter(battle, other));
    const projected = { ...battle, onSwitch: null, pendingSwitch: null, active: { ...battle.active },
      teams: { [side]: team, [other]: opponents } };
    if (decoy) activeFighter(projected, side).decoy = decoy;
    const mapSource = (original, copy) => {
      if (!original.bind) return;
      const source = original.bind.source;
      const outgoing = activeFighter(battle, side);
      const target = activeFighter(battle, other);
      copy.bind = { ...original.bind, source: source === outgoing ? activeFighter(projected, side) :
        source === target ? activeFighter(projected, other) : source };
    };
    mapSource(activeFighter(battle, side), activeFighter(projected, side));
    mapSource(activeFighter(battle, other), activeFighter(projected, other));
    switchFighter(projected, side, index, reason, []);
    applyEntryPassive(projected, side, []);
    return projected;
  }

  function* selectSwitch(battle, side, reason, index) {
    const candidates = switchTargets(battle, side);
    if (!candidates.length) return null;
    if (candidates.includes(index)) return index;
    return battle.manualSwitches ? yield { side, reason, candidates } : candidates[0];
  }

  function orderActions(battle, selected) {
    const actions = SIDES.map((side) => {
      const action = selected[side];
      const actor = activeFighter(battle, side);
      const move = action.type === "move" ? battle.skills.get(action.moveId) : null;
      const priority = action.type === "switch" ? SWITCH_PRIORITY : move?.priority ?? -Infinity;
      const speed = speedDetails(battle, side);
      return { side, action, actor, move, priority, speed: speed.value, speedPassives: speed.passives };
    });
    const [first, second] = actions;
    const difference = first.priority === second.priority ? first.speed - second.speed : first.priority - second.priority;
    if (difference < 0 || (difference === 0 && battle.random() >= 0.5)) actions.reverse();
    return actions;
  }

  function applyHPDamage(fighter, damage) {
    const actualDamage = Math.min(fighter.hp, damage);
    fighter.hp -= actualDamage;
    fighter.fainted = fighter.hp === 0;
    return actualDamage;
  }

  function releaseBinds(battle, events, source) {
    for (const side of SIDES) {
      const target = activeFighter(battle, side);
      if (target.bind?.source !== source) continue;
      target.bind = null;
      events.push({ type: "bind-ended", side, actor: target.base.name });
    }
  }

  function recordFaint(battle, side, fighter, events) {
    fighter.bind = null;
    fighter.pending = null;
    fighter.decoy = null;
    fighter.defenses.clear();
    fighter.nextElementPower.clear();
    events.push({ type: "faint", side, actor: fighter.base.name });
    releaseBinds(battle, events, fighter);
  }

  function determineWinner(battle, events) {
    const alive = SIDES.filter((side) => battle.teams[side].some((fighter) => !fighter.fainted));
    if (alive.length === 2) return;
    battle.winner = alive[0] ?? "draw";
    events.push(alive.length ? { type: "win", side: battle.winner } : { type: "draw" });
  }

  function residualDamage(fighter, definition) {
    if (!["status-damage", "bind-damage"].includes(effectKind(definition))) return 0;
    return Math.max(1, Math.round(fighter.maxHp * definition.damage_value / 100));
  }

  function naturalRecovery(fighter, hp = fighter.hp) {
    const value = fighter.base.regen_value;
    if (fighter.fainted || hp <= 0 || !Number.isFinite(value) || value <= 0) return 0;
    return Math.max(0, Math.min(fighter.maxHp - hp, value));
  }

  // Current statuses only. Other actions, newly applied effects and switches are not assumed.
  function previewTurnEndRecovery(fighter, hp = fighter.hp) {
    const damage = [...fighter.statuses, fighter.bind].filter(Boolean)
      .reduce((sum, effect) => sum + residualDamage(fighter, effect.definition), 0);
    const afterResidual = fighter.fainted ? 0 : Math.max(0, hp - damage);
    const recovered = naturalRecovery(fighter, afterResidual);
    return { hp: afterResidual + recovered, recovered, residualDamage: Math.min(hp, damage) };
  }

  function finishResiduals(battle, events) {
    const defeated = [];
    // Defer faint cleanup until both active fighters have resolved residual damage.
    for (const side of SIDES) {
      const fighter = activeFighter(battle, side);
      if (fighter.fainted) continue;
      for (const effect of [...fighter.statuses, fighter.bind].filter(Boolean)) {
        if (fighter.fainted) break;
        const { definition } = effect;
        const amount = residualDamage(fighter, definition);
        if (amount > 0) {
          const actualDamage = applyHPDamage(fighter, amount);
          events.push({ type: "residual", side, actor: fighter.base.name, name: definition.name, damage: actualDamage });
        }
        effect.turns--;
        if (!effect.turns) {
          if (effect === fighter.bind) fighter.bind = null;
          events.push({ type: "effect-expired", side, actor: fighter.base.name, name: definition.name });
        }
      }
      fighter.statuses = fighter.statuses.filter(({ turns }) => turns > 0);
      if (fighter.fainted) defeated.push({ side, fighter });
    }
    for (const { side, fighter } of defeated) recordFaint(battle, side, fighter, events);
    determineWinner(battle, events);
    for (const side of SIDES) {
      tickTimedEffects(fieldEffectsForSide(battle, side), battle.turn, (effect) => {
        events.push({ type: "field-expired", side, name: effect.definition.name });
      });
      for (const fighter of battle.teams[side]) {
        tickTimedEffects(fighter.timedEffects, battle.turn, (effect) => {
          events.push({ type: "effect-expired", side, actor: fighter.base.name, name: effect.definition.name });
        }, effect => !["en-charge-modifier", "en-cost-modifier"].includes(effectKind(effect.definition)));
      }
    }
  }

  function resolveTurn(battle, selected) {
    for (const side of SIDES) {
      const error = checkAction(battle, side, selected[side]);
      if (error) throw new Error(`${side}: ${error}`);
    }
    const state = { turn: battle.turn, events: [] };
    if (battle.captureFrame) {
      state.frames = [];
      state.events.push = (...entries) => {
        for (const entry of entries) state.frames.push(battle.captureFrame(battle, entry));
        return Array.prototype.push.apply(state.events, entries);
      };
    }
    const actions = orderActions(battle, selected);
    if (actions[0].priority === actions[1].priority && actions[0].action.type !== "wait" && actions[1].action.type !== "wait") {
      for (const { actor, side, speedPassives } of actions) {
        for (const effect of speedPassives) {
          geneOrderPassives.activate(actor, side, effect, state.events, { stat: "speed", multiplier: effect.value });
        }
      }
    }
    return advanceTurn(battle, state, runTurn(battle, actions, state.events));
  }

  function advanceTurn(battle, state, iterator, choice) {
    const next = iterator.next(choice);
    battle.pendingSwitch = next.done ? null : next.value;
    battle.turnContinuation = next.done ? null : { state, iterator };
    const result = { turn: state.turn, events: state.events.splice(0), winner: battle.winner, pendingSwitch: battle.pendingSwitch };
    if (state.frames) result.frames = state.frames.splice(0);
    return result;
  }

  function continueSwitch(battle, side, index) {
    const pending = battle.pendingSwitch;
    if (!pending || pending.side !== side || !pending.candidates.includes(index) ||
      !switchTargets(battle, side).includes(index)) throw new Error("交代先に指定できません。");
    const { state, iterator } = battle.turnContinuation;
    return advanceTurn(battle, state, iterator, index);
  }

  function* runTurn(battle, actions, events) {
    for (const { side, action, actor, move } of actions) {
      if (battle.winner) break;
      if (actor.fainted) {
        events.push({ type: "skipped", side, actor: actor.base.name });
        continue;
      }
      const other = opposingSide(side);
      if (action.type === "switch") {
        switchFighter(battle, side, action.index, "normal", events);
        continue;
      }
      if (action.type === "wait") {
        events.push({ type: "wait", side, actor: actor.base.name });
        continue;
      }
      const cost = effectiveMoveCost(actor, move, battle.turn);
      if (actor.energy < cost) {
        events.push({ type: "insufficient-energy", side, actor: actor.base.name, move: move.name, cost, energy: actor.energy });
        continue;
      }
      const failureChance = actionFailureChance(actor);
      if (rollChance(failureChance, battle.random)) {
        events.push({ type: "action-failed", side, actor: actor.base.name, move: move.name, moveId: move.skill_id,
          chance: failureChance, statuses: activeStatuses(actor).filter(({ definition }) =>
            statusNumber(definition.action_failure_chance, 0) > 0).map(({ definition }) => definition.name) });
        continue;
      }
      const defender = activeFighter(battle, other);
      const defenderWasFainted = defender.fainted;
      const special = specialSwitchEffect(move, battle);
      const kind = special && battleEffectKind(special.definition);
      let switchIndex = null;
      let specialTriggered = false;
      const pending = actor.pending;
      const { hpAfterCost } = movePayment(actor, move, pending);
      if (hpAfterCost > 0 && ["tail-purge", "relay", "decoy"].includes(kind)) {
        if ((kind !== "decoy" && !switchTargets(battle, side).length) ||
          (kind !== "relay" && decoyError(actor, special.definition, hpAfterCost))) {
          events.push({ type: "move-failed", side, actor: actor.base.name, move: move.name });
          continue;
        }
        specialTriggered = rollChance(special.chance, battle.random);
        if (specialTriggered && kind !== "decoy") {
          switchIndex = yield* selectSwitch(battle, side, kind, action.switchIndex);
        }
      }
      const result = evaluateMoveDamage(battle, side, move);
      changeEnergy(actor, -cost);
      for (const { effect, damage } of result.hpCosts) {
        if (damage > 0) geneOrderPassives.activate(actor, side, effect, events, { damage: applyHPDamage(actor, damage) });
        if (actor.fainted) break;
      }
      if (actor.fainted) {
        events.push({ type: "move-failed", side, actor: actor.base.name, move: move.name });
        recordFaint(battle, side, actor, events);
        determineWinner(battle, events);
        if (battle.winner) break;
        continue;
      }
      for (const effect of result.powerPassives ?? []) {
        geneOrderPassives.activate(actor, side, effect, events, { power: result.power });
      }
      if (result.reason === "no-target") {
        events.push({ type: "move-failed", side, actor: actor.base.name, move: move.name });
        actor.pending = null;
        continue;
      }
      if (result.nextPower) {
        const { element, modifier } = result.nextPower;
        actor.nextElementPower.delete(element);
        events.push({ type: "next-power-used", side, actor: actor.base.name, move: move.name,
          effect: result.nextPower.battle_effect_id, element, multiplier: modifier, power: result.power });
      }
      if (result.reason === "charging") {
        actor.pending = { moveId: move.skill_id, power: result.power, definition: battle.battleEffects.get(chargeSlot(move, battle).id) };
        events.push({ type: "charge", side, actor: actor.base.name, characterId: actor.base.character_id, move: move.name, moveId: move.skill_id, cost, power: result.power });
        applyMoveEffects(battle, side, actor, defender, move, 0, false, events, "charge");
        if (!actor.fainted) applyPassiveStages(actor, side, "after-use", events, { move });
        continue;
      }
      actor.pending = null;
      if (["hit", "decoy", "absorbed", "reflected"].includes(result.reason)) {
        for (const effect of result.attackPassives) {
          geneOrderPassives.activate(actor, side, effect, events, { stat: effect.stat, multiplier: effect.value });
        }
        for (const effect of result.defensePassives) {
          geneOrderPassives.activate(defender, other, effect, events, { stat: effect.stat, multiplier: effect.value });
        }
        for (const effect of result.damagePassives) {
          geneOrderPassives.activate(defender, other, effect, events, { multiplier: effect.value });
        }
      }
      if (result.immunity) geneOrderPassives.activate(defender, other, result.immunity, events);
      if (result.survival) geneOrderPassives.activate(defender, other, result.survival, events);
      const actualDamage = applyHPDamage(defender, result.damage);
      const decoyDamage = result.decoyDamage ?? 0;
      if (decoyDamage) {
        defender.decoy.hp -= decoyDamage;
        events.push({ type: "decoy-hit", side: other, actor: defender.base.name, damage: decoyDamage, hp: defender.decoy.hp });
        if (!defender.decoy.hp) {
          defender.decoy = null;
          events.push({ type: "decoy-broken", side: other, actor: defender.base.name });
        }
      }
      if (actualDamage > 0) defender.tookDirectDamage = true;
      events.push({ type: "move", side, actor: actor.base.name, target: defender.base.name, move: move.name, characterId: actor.base.character_id, moveId: move.skill_id,
        category: move.category, cost, power: result.power, damage: result.damage, actualDamage, decoyDamage, reason: result.reason });
      if (result.reason === "evaded") {
        events.push({ type: "evaded", side: other, actor: defender.base.name, move: move.name });
        applyPassiveStages(defender, other, "evaded", events);
      }
      if (actualDamage > 0) {
        applyBodyHitPassives(battle, side, actor, defender, move, events);
        clearSleepOnAttackDamage(defender, actualDamage, other, events);
      }
      if (result.reason === "absorbed") {
        const recovered = Math.min(result.heal, defender.maxHp - defender.hp);
        defender.hp += recovered;
        events.push({ type: "absorbed", side: other, actor: defender.base.name, recovered });
      }
      if (result.response) {
        defender.defenses.delete(result.response.id);
        events.push({ type: result.response.id === "reflection" ? "reflected" : "revenge", side: other,
          actor: defender.base.name, target: actor.base.name, damage: applyHPDamage(actor, result.response.damage) });
      }
      applyMoveEffects(battle, side, actor, defender, move, actualDamage + decoyDamage,
        move.category === "attack" && result.reason !== "hit", events, pending ? "release" : null);
      if (!pending && !actor.fainted) applyPassiveStages(actor, side, "after-use", events, { move });
      const defenderJustFainted = defender.fainted && !defenderWasFainted;
      if (defenderJustFainted) recordFaint(battle, other, defender, events);
      if (actor.fainted) recordFaint(battle, side, actor, events);
      if (defenderJustFainted || actor.fainted) determineWinner(battle, events);
      if (battle.winner || actor.fainted) continue;
      if (specialTriggered && (kind === "decoy" || kind === "tail-purge")) createDecoy(actor, special.definition, side, events);
      if (switchIndex !== null) switchFighter(battle, side, switchIndex, kind, events);
      if (kind === "post-attack" && (actualDamage > 0 || decoyDamage > 0) && switchTargets(battle, side).length &&
        rollChance(special.chance, battle.random)) {
        const index = yield* selectSwitch(battle, side, kind, action.switchIndex);
        switchFighter(battle, side, index, kind, events);
      }
    }

    if (!battle.winner) finishResiduals(battle, events);

    for (const side of SIDES) {
      for (const fighter of battle.teams[side]) {
        fighter.tookDirectDamage = false;
        tickTimedEffects(fighter.defenses, battle.turn, (effect) => {
          if (effect.id === DODGE_ID) return;
          events.push({ type: "effect-expired", side, actor: fighter.base.name, name: effect.definition.name });
        });
        if ((fighter.dodgeActive && !fighter.defenses.has(DODGE_ID)) || fighter.halfGuard) {
          events.push({ type: "defense-expired", side, actor: fighter.base.name,
            dodge: fighter.dodgeActive && !fighter.defenses.has(DODGE_ID), guard: fighter.halfGuard });
          fighter.dodgeActive = fighter.defenses.has(DODGE_ID);
          fighter.halfGuard = 0;
        }
      }
    }

    if (!battle.winner) {
      for (const side of SIDES) {
        const fighter = activeFighter(battle, side);
        if (fighter.fainted) continue;
        applyPassiveStages(fighter, side, "turn-end", events);
        const recovered = naturalRecovery(fighter);
        if (recovered > 0) {
          fighter.hp += recovered;
          events.push({ type: "heal", source: "natural", side, actor: fighter.base.name, recovered });
        }
        const before = fighter.energy;
        changeEnergy(fighter, effectiveEnergyCharge(fighter, battle.turn));
        events.push({ type: "energy", side, recovered: fighter.energy - before });
      }
      // Include the final natural recovery before expiring EN modifiers.
      for (const side of SIDES) for (const fighter of battle.teams[side]) {
        tickTimedEffects(fighter.timedEffects, battle.turn, effect => {
          events.push({ type: "effect-expired", side, actor: fighter.base.name, name: effect.definition.name });
        }, effect => ["en-charge-modifier", "en-cost-modifier"].includes(effectKind(effect.definition)));
      }
      const replacements = [];
      for (const side of SIDES) {
        if (!activeFighter(battle, side).fainted) continue;
        replacements.push({ side, index: yield* selectSwitch(battle, side, "replacement") });
      }
      const entries = [];
      for (const { side, index } of replacements) switchFighter(battle, side, index, "replacement", events, entries);
      for (const side of entries) applyEntryPassive(battle, side, events);
      battle.turn += 1;
    }
  }

  return { START_ENERGY, MAX_ENERGY, SWITCH_PRIORITY, roundHalfDown, changeStage, stageDelta, statValue, effectiveStat, changeEnergy,
    calculateDamage, effectivenessFor, previewDamage, previewRelease, previewSwitch, moveEffects, decoyValues, residualDamage,
    naturalRecovery, previewTurnEndRecovery, statusStatMultiplier, actionFailureChance, effectiveEnergyCharge, effectiveMoveCost,
    guardApplies, activeTimed, effectiveSpeed, evasionRate, moveAvailability, unsupportedMoveReason, validAttackStat, effectKind, battleEffectKind, createBattle, activeFighter, switchTargets, checkAction, resolveTurn, continueSwitch };
})();

// Pure battle calculation and battle-state helpers shared by app.js.
// Loaded as a classic script before app.js; project-wide module conversion is intentionally avoided.

function pendingSkillFor(fighter) {
  return fighter?.pendingSkill ?? fighter?.pendingMove ?? null;
}

function pendingSkillId(fighter) {
  const pendingSkill = pendingSkillFor(fighter);
  return pendingSkill?.skillId ?? pendingSkill?.moveId ?? "";
}

function setPendingSkill(fighter, pendingSkill) {
  if (!fighter) return;
  fighter.pendingSkill = pendingSkill;
  fighter.pendingMove = pendingSkill;
}

function clearPendingSkill(fighter) {
  if (!fighter) return;
  fighter.pendingSkill = null;
  fighter.pendingMove = null;
}

const ELEMENT_GUARD_TYPES = {
  fire_damage: "fire",
  water_damage: "water",
  thunder_damage: "thunder",
  ice_damage: "ice",
  dragon_damage: "dragon",
};

const POWER_RULE_STATUS_IDS = new Set([
  "poison",
  "paralysis",
  "sleep",
  "burn",
  "blood",
]);

function createEmptyStatMods() {
  return STAT_MOD_KEYS.reduce((mods, stat) => {
    mods[stat] = 0;
    return mods;
  }, {});
}

function createEmptyWeakMods() {
  return ELEMENT_TYPES.reduce((mods, element) => {
    mods[element] = { value: 0, turns: 0 };
    return mods;
  }, {});
}

function ensureFighterWeakMods(fighter) {
  if (!fighter.weakMods || typeof fighter.weakMods !== "object") {
    fighter.weakMods = createEmptyWeakMods();
  }

  for (const element of ELEMENT_TYPES) {
    const current = fighter.weakMods[element];
    if (typeof current === "number") {
      fighter.weakMods[element] = {
        value: clamp(Math.round(current), TEMP_WEAK_MOD_MIN, TEMP_WEAK_MOD_MAX),
        turns: 0,
      };
      continue;
    }
    if (!current || typeof current !== "object") {
      fighter.weakMods[element] = { value: 0, turns: 0 };
      continue;
    }
    current.value = clamp(Math.round(number(current.value)), TEMP_WEAK_MOD_MIN, TEMP_WEAK_MOD_MAX);
    current.turns = Math.max(0, Math.floor(number(current.turns)));
  }

  return fighter.weakMods;
}

function moveElements(move) {
  const elements = [move?.element, move?.element2]
    .map((element) => safeText(element, "none"))
    .filter((element) => element !== "none" && ELEMENT_TYPES.includes(element));
  return [...new Set(elements)];
}

function moveHasElement(move, element) {
  const normalizedElement = safeText(element, "none");
  return normalizedElement !== "none" && moveElements(move).includes(normalizedElement);
}

function moveWeaknessMultiplier(target, move) {
  const elements = moveElements(move);
  if (!elements.length) return 1;

  const totalMultiplier = elements.reduce(
    (total, element) => total + weaknessMultiplier(target, element),
    0,
  );
  return totalMultiplier / elements.length;
}

function sameElementBonusForMove(attacker, move) {
  const attackerElement = safeText(attacker?.base?.element, "none");

  if (attackerElement === "none") {
    const moveElement = safeText(move?.element, "none");
    const moveElement2 = safeText(move?.element2, "none");
    return moveElement === "none" && moveElement2 === "none" ? 1.15 : 1;
  }

  return moveHasElement(move, attackerElement) ? 1.15 : 1;
}

function moveWithEffectivePower(move, actor, target, powerRules) {
  const effectivePower = effectiveMovePower(move, actor, target, powerRules);
  return effectivePower === number(move?.power) ? move : { ...move, power: effectivePower };
}

function moveWithPendingPower(move, pendingSkill, actor, target, powerRules) {
  const pendingPower = optionalNumber(pendingSkill?.power);
  return pendingPower === null
    ? moveWithEffectivePower(move, actor, target, powerRules)
    : { ...move, power: pendingPower };
}

function effectiveMovePower(move, actor, target, powerRules) {
  const basePower = number(move?.power);
  const ruleGroup = safeText(move?.power_rule);
  if (!ruleGroup) return basePower;

  const multiplier = powerRuleMultiplier(ruleGroup, move, actor, target, powerRules);
  const uncappedPower = Math.round(basePower * multiplier);
  return Number.isFinite(move?.power_cap) ? Math.min(uncappedPower, move.power_cap) : uncappedPower;
}

function powerRuleMultiplier(ruleGroup, move, actor, target, powerRules) {
  const rules = powerRules?.get(ruleGroup);
  if (!rules?.length) {
    warnPowerRuleFallback(ruleGroup, move, "rule group not found");
    return 1;
  }

  const value = powerRuleValue(ruleGroup, move, actor, target);
  if (!Number.isFinite(value)) return 1;

  const matchedRule = rules.find((rule) => powerRuleMatchesValue(ruleGroup, rule, value));
  if (!matchedRule) {
    warnPowerRuleFallback(ruleGroup, move, "matching range not found", { value });
    return 1;
  }

  return number(matchedRule.power_multiplier, 1);
}

function powerRuleValue(ruleGroup, move, actor, target) {
  if (ruleGroup === "speed_ratio") {
    return speedRatioValue(actor, target, ruleGroup, move);
  }
  if (ruleGroup === "inverse_speed_ratio") {
    return speedRatioValue(target, actor, ruleGroup, move);
  }
  if (ruleGroup === "en_value") {
    if (!actor) {
      warnPowerRuleFallback(ruleGroup, move, "actor not found");
      return Number.NaN;
    }
    return number(actor.energy);
  }
  if (ruleGroup === "hp_ratio") {
    if (!actor || actor.maxHp <= 0) {
      warnPowerRuleFallback(ruleGroup, move, "actor hp not available");
      return Number.NaN;
    }
    return clamp(Math.floor((actor.hp / actor.maxHp) * 100), 0, 100);
  }
  if (ruleGroup === "self_status") {
    if (!actor) {
      warnPowerRuleFallback(ruleGroup, move, "actor not found");
      return Number.NaN;
    }
    return hasPowerRuleStatus(actor) ? 1 : 0;
  }
  if (ruleGroup === "target_status") {
    if (!target) {
      warnPowerRuleFallback(ruleGroup, move, "target not found");
      return Number.NaN;
    }
    return hasPowerRuleStatus(target) ? 1 : 0;
  }

  warnPowerRuleFallback(ruleGroup, move, "rule value calculation not implemented");
  return Number.NaN;
}

function hasPowerRuleStatus(fighter) {
  return Array.isArray(fighter?.statuses) &&
    fighter.statuses.some((status) => POWER_RULE_STATUS_IDS.has(status?.id));
}

function speedRatioValue(numeratorFighter, denominatorFighter, ruleGroup, move) {
  const numeratorSpeed = numeratorFighter ? effectiveStat(numeratorFighter, "speed") : 0;
  const denominatorSpeed = denominatorFighter ? effectiveStat(denominatorFighter, "speed") : 0;
  if (denominatorSpeed <= 0) {
    warnPowerRuleFallback(ruleGroup, move, "speed denominator is zero or below", {
      numeratorSpeed,
      denominatorSpeed,
    });
    return Number.NaN;
  }
  return (numeratorSpeed / denominatorSpeed) * 100;
}

function powerRuleMatchesValue(ruleGroup, rule, value) {
  if (rule.max_ratio !== null && rule.min_ratio === rule.max_ratio) {
    return value === rule.min_ratio;
  }
  if (value < rule.min_ratio) return false;
  if (rule.max_ratio === null) return true;
  if (ruleGroup === "hp_ratio") return value <= rule.max_ratio;
  return value < rule.max_ratio;
}

function warnPowerRuleFallback(ruleGroup, move, reason, details = {}) {
  console.warn("[PowerRule] falling back to multiplier 1", {
    skill_id: move?.skill_id,
    name: move?.name,
    power_rule: ruleGroup,
    reason,
    ...details,
  });
}

function estimateMoveDamage(
  attacker,
  target,
  move,
  aiConfig = ENEMY_AI_CONFIG,
  powerRules,
  targetFieldEffects = [],
) {
  if (!attacker || !target || !move) return 0;
  const hitCheck = canHitTarget(target, move);
  if (!hitCheck.canHit) return 0;

  const damageMove = moveWithEffectivePower(move, attacker, target, powerRules);
  const physical = move.attack_type !== "special";
  const attackStat = effectiveStat(attacker, physical ? "phy_atk" : "sp_atk");
  const defenseStat = effectiveStat(target, physical ? "phy_def" : "sp_def");
  const ratio = attackStat / Math.max(45, defenseStat + 40);
  const elementMultiplier = moveWeaknessMultiplier(target, move);
  const sameElementBonus = sameElementBonusForMove(attacker, move);
  const lowHpDamageMultiplier = lowHpDamageMultiplierFromPassive(attacker, damageMove);
  let damage = 0.95 * (damageMove.power * 1.10 + attackStat * 0.60) * ratio;

  damage *= elementMultiplier *
    sameElementBonus *
    lowHpDamageMultiplier *
    aiConfig.AVERAGE_DAMAGE_VARIANCE;
  damage = applyIncomingBattleEffects(target, damage, damageMove, targetFieldEffects);
  return Math.max(1, Math.round(damage));
}

function dealDamage(attacker, target, move, targetFieldEffects = []) {
  const hitCheck = canHitTarget(target, move);
  if (!hitCheck.canHit) {
    return {
      damage: 0,
      effectText: ` ${hitCheck.reason}`,
      actualDamage: 0,
      drainHeal: 0,
      revengeDamage: 0,
      events: [],
    };
  }

  const physical = move.attack_type !== "special";
  const attackStat = effectiveStat(attacker, physical ? "phy_atk" : "sp_atk");
  const defenseStat = effectiveStat(target, physical ? "phy_def" : "sp_def");
  const ratio = attackStat / Math.max(45, defenseStat + 40);
  const elementMultiplier = moveWeaknessMultiplier(target, move);
  const sameElementBonus = sameElementBonusForMove(attacker, move);
  const elementPassiveMultiplier = elementDamageMultiplierFromPassive(attacker, move);
  const lowHpDamageMultiplier = lowHpDamageMultiplierFromPassive(attacker, move);
  const damagePassiveMultiplier = damageMultiplierFromPassive(target, move, { actor: attacker });
  const variance = 0.9 + Math.random() * 0.15;
  let damage = 0.95 * (move.power * 1.10 + attackStat * 0.60) * ratio;
  let effectText = effectivenessText(elementMultiplier);

  damage *= elementMultiplier *
    sameElementBonus *
    elementPassiveMultiplier *
    lowHpDamageMultiplier *
    damagePassiveMultiplier *
    variance;
  damage = applyIncomingBattleEffects(target, damage, move, targetFieldEffects, { actor: attacker });
  damage = Math.max(1, Math.round(damage));

  const beforeTargetHp = target.hp;
  const events = [];
  const endure = target.battleEffects.find((effect) => effect.id === "endure");
  if (endure && target.hp - damage <= 0) {
    target.hp = 1;
    removeBattleEffect(target, "endure");
    effectText += " こらえた！";
  } else if (attacker !== target && target.hp === target.maxHp && target.hp - damage <= 0) {
    const surviveOnce = target.passiveState?.survive_once_used
      ? null
      : surviveOncePassiveEffect(target, move, { actor: attacker });
    if (surviveOnce) {
      target.passiveState = target.passiveState ?? {};
      target.passiveState.survive_once_used = true;
      target.hp = 1;
      events.push(...passiveActivationLogEvents(target, surviveOnce));
    } else {
      target.hp = Math.max(0, target.hp - damage);
    }
  } else {
    target.hp = Math.max(0, target.hp - damage);
  }
  const actualDamage = Math.max(0, beforeTargetHp - target.hp);

  let drainHeal = 0;
  const drainPercent = attacker !== target ? damageDrainPercentFromPassive(attacker, move) : 0;
  if (actualDamage > 0 && drainPercent > 0 && attacker && !attacker.fainted && attacker.hp < attacker.maxHp) {
    const drainAmount = Math.floor(actualDamage * drainPercent / 100);
    const beforeAttackerHp = attacker.hp;
    attacker.hp = Math.min(attacker.maxHp, attacker.hp + drainAmount);
    drainHeal = attacker.hp - beforeAttackerHp;
  }

  const revenge = target.battleEffects.find((effect) => effect.id === "revenge");
  const revengeDamage =
    revenge && damage > 0 ? Math.max(1, Math.round(damage * ((revenge.damage_value || 50) / 100))) : 0;
  if (revenge) removeBattleEffect(target, "revenge");

  return { damage, effectText, actualDamage, drainHeal, revengeDamage, events };
}

function addBattleEffect(fighter, battleEffect, currentTurn, extra = {}) {
  const current = fighter.battleEffects.find(
    (effect) => effect.id === battleEffect.battle_effect_id,
  );
  const next = {
    id: battleEffect.battle_effect_id,
    name: battleEffect.name,
    group: battleEffect.battle_effect_group,
    turns: battleEffect.turn,
    createdTurn: currentTurn,
    damage_type: battleEffect.damage_type,
    damage_value: battleEffect.damage_value,
    damage_cut: battleEffect.damage_cut,
    guard_type: battleEffect.guard_type,
    can_move: battleEffect.can_move,
    animation: battleEffect.animation,
    animation_duration_ms: battleEffect.animation_duration_ms,
    start_text: battleEffect.start_text,
    ...extra,
  };
  if (current) {
    Object.assign(current, next);
  } else {
    fighter.battleEffects.push(next);
  }
}

function removeBattleEffect(fighter, id) {
  fighter.battleEffects = fighter.battleEffects.filter((effect) => effect.id !== id);
}

function applyDamageLinkedStun(move, actor, target, battleEffects, currentTurn) {
  const appliedBattleEffects = [];
  const events = [];
  if (move.category !== "attack" || !target) return { appliedBattleEffects, events };

  const stunEffect = battleEffects?.get(STUN_BATTLE_EFFECT_ID);
  if (!stunEffect) return { appliedBattleEffects, events };

  const pairs = [
    [move.battle_effect1, move.battle_effect_chance1],
    [move.battle_effect2, move.battle_effect_chance2],
  ];

  for (const [battleEffectId, chance] of pairs) {
    if (battleEffectId !== STUN_BATTLE_EFFECT_ID || chance <= 0) continue;
    if (Math.random() * 100 > chance) continue;

    const blockedBy = findBlockingBattleEffectPassive({ actor, target, battleEffect: stunEffect, move });
    if (blockedBy) {
      events.push(...passiveActivationLogEvents(target, blockedBy));
      continue;
    }

    addBattleEffect(target, stunEffect, currentTurn);
    events.push(...battleEffectStartLogEvents(actor, stunEffect, target));
    appliedBattleEffects.push(stunEffect);
  }

  return { appliedBattleEffects, events };
}

function startTwoTurnMove(actor, move, effectId, targetSide, battleEffects, currentTurn) {
  const battleEffect = battleEffects?.get(effectId);
  if (!battleEffect) return null;

  setPendingSkill(actor, {
    skillId: move.skill_id,
    moveId: move.skill_id,
    power: move.power,
    effectId,
    target: move.target,
    targetSide,
    startedTurn: currentTurn,
  });
  addBattleEffect(actor, battleEffect, currentTurn);
  return {
    battleEffect,
    battleEffectId: effectId,
    events: battleEffectStartLogEvents(actor, battleEffect),
  };
}

function battleEffectStartTemplate(battleEffect) {
  const template = safeText(battleEffect?.start_text);
  if (!template) return null;
  return template.toLowerCase() === "none" ? "" : template;
}

function formatBattleEffectStartValue(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && `${value}`.trim() !== "") {
    return Number.isInteger(numeric) ? `${numeric}` : `${Math.round(numeric * 100) / 100}`;
  }
  return safeText(value);
}

function renderBattleEffectStartTemplate(template, actor, battleEffect, recipient = actor) {
  const values = {
    actor: actor?.name ?? "",
    target: recipient?.name ?? "",
    name: battleEffect?.name ?? "",
    turn: battleEffect?.turn ?? "",
    damage_cut: battleEffect?.damage_cut ?? "",
  };
  return template.replace(/\{(actor|target|name|turn|damage_cut)\}/g, (_, key) => (
    formatBattleEffectStartValue(values[key])
  ));
}

function battleEffectStartText(actor, battleEffect, recipient = actor, fallbackText = null) {
  const template = battleEffectStartTemplate(battleEffect);
  if (template !== null) {
    return template ? renderBattleEffectStartTemplate(template, actor, battleEffect, recipient) : "";
  }

  if (fallbackText !== null) return fallbackText;
  if (!battleEffect) return "";

  if (battleEffect.battle_effect_id === "future_blast") {
    return "周囲に粉塵が舞う！";
  }

  if (battleEffect.battle_effect_group === "delayed_attack" && recipient !== actor) {
    return `${actor.name}は${recipient.name}に${battleEffect.name}を仕掛けた！`;
  }

  if (battleEffect.battle_effect_group === DELAYED_HEAL_BATTLE_EFFECT_GROUP) {
    return `${actor.name}は${battleEffect.name}を用意した！`;
  }

  if (battleEffect.battle_effect_id === STUN_BATTLE_EFFECT_ID) {
    return `${recipient.name}はスタンした！`;
  }

  if (battleEffect.battle_effect_id === "protect") {
    return `${actor.name}は防御態勢をとっている！`;
  }

  const positionMessages = {
    fly: "上空に飛び上がった",
    underground: "地中に潜った",
    underwater: "水中に潜った",
    ghost_phase: "姿を消した",
  };
  const message = positionMessages[battleEffect.battle_effect_id];
  return message
    ? `${actor.name}は${message}！`
    : `${actor.name}は${battleEffect.name}の構え！`;
}

function battleEffectStartLogEvents(actor, battleEffect, recipient = actor, fallbackText = null) {
  const text = battleEffectStartText(actor, battleEffect, recipient, fallbackText);
  return text ? [{ type: "log", text }] : [];
}

const EFFECT_START_STAT_LABELS = {
  phy_atk: "物理攻撃",
  phy_def: "物理防御",
  sp_atk: "特殊攻撃",
  sp_def: "特殊防御",
  speed: "敏捷",
  regen_value: "回復力",
  weak_fire: "火耐性",
  weak_water: "水耐性",
  weak_thunder: "雷耐性",
  weak_ice: "氷耐性",
  weak_dragon: "龍耐性",
  hp: "HP",
  en: "EN",
};

function effectStartTemplate(effect) {
  const template = safeText(effect?.start_text);
  if (!template) return null;
  return template.toLowerCase() === "none" ? "" : template;
}

function effectTargetStat(effect) {
  return safeText(effect?.target_stat ?? effect?.targetStat, "none");
}

function effectDamageValue(effect) {
  return number(effect?.damage_value ?? effect?.damageValue);
}

function effectStartStatLabel(effect, statLabels = {}) {
  const stat = effectTargetStat(effect);
  return EFFECT_START_STAT_LABELS[stat] ?? statLabels[stat] ?? stat;
}

function renderEffectStartTemplate(template, effect, actor, target, context = {}) {
  const value = Math.abs(effectDamageValue(effect));
  const changed = Object.prototype.hasOwnProperty.call(context, "changed")
    ? Math.abs(number(context.changed))
    : value;
  const values = {
    actor: actor?.name ?? "",
    target: target?.name ?? "",
    name: effect?.name ?? "",
    stat: effectStartStatLabel(effect, context.statLabels),
    value,
    turn: effect?.turn ?? "",
    changed,
  };
  return template.replace(/\{(actor|target|name|stat|value|turn|changed)\}/g, (_, key) => (
    formatBattleEffectStartValue(values[key])
  ));
}

function effectStartText(effect, actor, target, context = {}, fallbackText = null) {
  const template = effectStartTemplate(effect);
  if (template !== null) {
    return template ? renderEffectStartTemplate(template, effect, actor, target, context) : "";
  }
  return fallbackText ?? "";
}

function effectStartLogEvents(effect, actor, target, context = {}, fallbackText = null) {
  const text = effectStartText(effect, actor, target, context, fallbackText);
  return text ? [{ type: "log", text }] : [];
}

function applyStandardBattleEffect(actor, target, battleEffect, currentTurn, move = null) {
  const appliedBattleEffects = [];
  const events = [];
  const recipient =
    battleEffect.battle_effect_id === STUN_BATTLE_EFFECT_ID ||
    battleEffect.battle_effect_id === SWITCH_LOCK_BATTLE_EFFECT_ID
      ? target
      : actor;
  if (!recipient) return { appliedBattleEffects, events };

  const blockedBy = findBlockingBattleEffectPassive({ actor, target: recipient, battleEffect, move });
  if (blockedBy) {
    events.push(...passiveActivationLogEvents(recipient, blockedBy));
    return { appliedBattleEffects, events };
  }

  addBattleEffect(recipient, battleEffect, currentTurn);
  events.push(...battleEffectStartLogEvents(actor, battleEffect, recipient));
  appliedBattleEffects.push(battleEffect);
  return { appliedBattleEffects, events };
}

function isSideGuardBattleEffectId(effectId) {
  return [
    "phy_protect",
    "phy_protect2",
    "sp_protect",
    "sp_protect2",
    "fire_protect",
    "water_protect",
    "thunder_protect",
    "ice_protect",
    "dragon_protect",
  ].includes(effectId);
}

function applySideGuardBattleEffect(
  fieldEffects,
  actorSide,
  actor,
  battleEffect,
  currentTurn,
  nextFieldEffectId,
) {
  const appliedBattleEffects = [];
  const events = [];
  if (!actorSide) {
    return {
      applied: false,
      appliedBattleEffects,
      events,
      nextFieldEffectId,
    };
  }

  const effects = fieldEffectsForSide(fieldEffects, actorSide);
  const current = effects.find((effect) => effect.id === battleEffect.battle_effect_id);
  let updatedNextFieldEffectId = nextFieldEffectId;
  if (current) {
    Object.assign(current, {
      id: battleEffect.battle_effect_id,
      name: battleEffect.name,
      group: battleEffect.battle_effect_group,
      turns: battleEffect.turn,
      createdTurn: currentTurn,
      damage_type: battleEffect.damage_type,
      damage_value: battleEffect.damage_value,
      damage_cut: battleEffect.damage_cut,
      guard_type: battleEffect.guard_type,
      can_move: battleEffect.can_move,
      animation: battleEffect.animation,
      animation_duration_ms: battleEffect.animation_duration_ms,
      start_text: battleEffect.start_text,
    });
  } else {
    const fieldEffectResult = addFieldEffect(
      fieldEffects,
      actorSide,
      battleEffect,
      currentTurn,
      nextFieldEffectId,
    );
    updatedNextFieldEffectId = fieldEffectResult.nextFieldEffectId;
  }

  events.push(...battleEffectStartLogEvents(actor, battleEffect, actor));
  appliedBattleEffects.push(battleEffect);
  return {
    applied: true,
    appliedBattleEffects,
    events,
    nextFieldEffectId: updatedNextFieldEffectId,
  };
}

function applyChargeAttackBattleEffect(actor, battleEffect) {
  actor.statMods.phy_atk = clamp(actor.statMods.phy_atk + 10, -100, 100);
  return battleEffectStartLogEvents(actor, battleEffect, actor, `${actor.name}は勢いづいた！`);
}

function delayedBattleEffectPayload(move, actor, battleEffect, sourceSide = "", targetSide = "") {
  const fixedPower = battleEffect.damage_type === "fixed_power" ? battleEffect.damage_value : 0;
  const ratePower =
    battleEffect.damage_type === "skill_power_rate"
      ? Math.round(move.power * ((battleEffect.damage_value || 100) / 100))
      : 0;
  const delayedPower = Math.max(1, fixedPower || ratePower || move.power);
  return {
    delayedMove: {
      name: move.name,
      power: delayedPower,
      element: safeText(move.element, "none"),
      element2: safeText(move.element2, "none"),
      attack_type: safeText(move.attack_type, "special"),
      hit_type: safeText(move.hit_type, "sure_hit"),
      animation_id: safeText(move.animation_id),
      animation_duration_ms: Math.max(0, number(move.animation_duration_ms)),
      repeat_count: Math.max(0, number(move.repeat_count)),
      isBattleEffectDamage: true,
    },
    source: {
      name: actor.name,
      side: sourceSide,
      targetSide,
      element: actor.base.element,
      phy_atk: effectiveStat(actor, "phy_atk"),
      sp_atk: effectiveStat(actor, "sp_atk"),
    },
  };
}

function applyDelayedAttackBattleEffect(
  fieldEffects,
  targetSide,
  battleEffect,
  move,
  actor,
  target,
  currentTurn,
  nextFieldEffectId,
  actorSide = "",
) {
  const appliedBattleEffects = [];
  const events = [];
  if (!targetSide) {
    return {
      created: false,
      appliedBattleEffects,
      events,
      nextFieldEffectId,
    };
  }

  const fieldEffectResult = addFieldEffect(
    fieldEffects,
    targetSide,
    battleEffect,
    currentTurn,
    nextFieldEffectId,
    delayedBattleEffectPayload(move, actor, battleEffect, actorSide, targetSide),
  );
  appliedBattleEffects.push(battleEffect);
  events.push(...battleEffectStartLogEvents(actor, battleEffect, target));
  return {
    created: true,
    appliedBattleEffects,
    events,
    nextFieldEffectId: fieldEffectResult.nextFieldEffectId,
  };
}

function applyDelayedHealBattleEffect(
  fieldEffects,
  actorSide,
  battleEffect,
  actor,
  currentTurn,
  nextFieldEffectId,
) {
  const appliedBattleEffects = [];
  const events = [];
  if (!actorSide) {
    return {
      created: false,
      appliedBattleEffects,
      events,
      nextFieldEffectId,
    };
  }

  const fieldEffectResult = addFieldEffect(
    fieldEffects,
    actorSide,
    battleEffect,
    currentTurn,
    nextFieldEffectId,
  );
  appliedBattleEffects.push(battleEffect);
  events.push(...battleEffectStartLogEvents(actor, battleEffect, actor));
  return {
    created: true,
    appliedBattleEffects,
    events,
    nextFieldEffectId: fieldEffectResult.nextFieldEffectId,
  };
}

function fieldEffectsForSide(fieldEffects, side) {
  const key = side === "player" ? "player" : "enemy";
  if (!fieldEffects || typeof fieldEffects !== "object") return [];
  if (!Array.isArray(fieldEffects[key])) {
    fieldEffects[key] = [];
  }
  return fieldEffects[key];
}

function addFieldEffect(
  fieldEffects,
  side,
  battleEffect,
  currentTurn,
  nextFieldEffectId,
  extra = {},
) {
  const fieldEffect = {
    id: battleEffect.battle_effect_id,
    instanceId: nextFieldEffectId,
    name: battleEffect.name,
    group: battleEffect.battle_effect_group,
    turns: battleEffect.turn,
    createdTurn: currentTurn,
    damage_type: battleEffect.damage_type,
    damage_value: battleEffect.damage_value,
    damage_cut: battleEffect.damage_cut,
    guard_type: battleEffect.guard_type,
    can_move: battleEffect.can_move,
    animation: battleEffect.animation,
    animation_duration_ms: battleEffect.animation_duration_ms,
    start_text: battleEffect.start_text,
    ...extra,
  };
  fieldEffectsForSide(fieldEffects, side).push(fieldEffect);
  return {
    fieldEffect,
    nextFieldEffectId: nextFieldEffectId + 1,
  };
}

function removeFieldEffect(fieldEffects, side, effectToRemove) {
  const effects = fieldEffectsForSide(fieldEffects, side);
  const index = effects.indexOf(effectToRemove);
  if (index >= 0) {
    effects.splice(index, 1);
  }
}

function delayedBattleEffectReady(effect, currentTurn) {
  const delayTurns = Math.max(1, number(effect.turns, 1));
  return currentTurn - effect.createdTurn >= delayTurns;
}

function readyDelayedBattleEffects(fieldEffects, side, currentTurn) {
  const key = side === "player" ? "player" : "enemy";
  const effects =
    fieldEffects && typeof fieldEffects === "object" && Array.isArray(fieldEffects[key])
      ? fieldEffects[key]
      : [];
  return effects.filter(
    (effect) =>
      (effect.group === "delayed_attack" || effect.group === DELAYED_HEAL_BATTLE_EFFECT_GROUP) &&
      delayedBattleEffectReady(effect, currentTurn),
  );
}

function delayedEffectAttacker(effect, fallbackAttacker) {
  const source = effect.source;
  if (source) {
    return {
      name: source.name || effect.name,
      base: {
        element: safeText(source.element, "none"),
        phy_atk: Math.max(1, number(source.phy_atk, 1)),
        sp_atk: Math.max(1, number(source.sp_atk, 1)),
      },
      statMods: createEmptyStatMods(),
    };
  }

  return fallbackAttacker;
}

function prepareDelayedAttack(fieldEffects, side, effect, target, fallbackAttacker) {
  if (!target || target.fainted) {
    return {
      ready: false,
      removed: false,
      attacker: null,
      move: null,
    };
  }

  removeFieldEffect(fieldEffects, side, effect);
  const attacker = delayedEffectAttacker(effect, fallbackAttacker);
  const move = delayedEffectMove(effect);
  return {
    ready: Boolean(attacker && move),
    removed: true,
    attacker,
    move,
  };
}

function resolveDelayedHealState(fieldEffects, side, effect, target) {
  removeFieldEffect(fieldEffects, side, effect);
  if (!target || target.fainted) {
    return {
      validTarget: false,
      healAmount: 0,
      healed: 0,
    };
  }

  const healAmount = delayedHealAmount(effect, target);
  const beforeHp = target.hp;
  target.hp = Math.min(target.maxHp, target.hp + healAmount);
  return {
    validTarget: true,
    healAmount,
    healed: target.hp - beforeHp,
  };
}

function applyBattleEffects(
  move,
  actor,
  target,
  battleEffects,
  currentTurn,
  fieldEffects,
  nextFieldEffectId,
  skipEffectIds = null,
  actorSide = "",
  targetSide = "",
) {
  const appliedBattleEffects = [];
  const events = [];
  let updatedNextFieldEffectId = nextFieldEffectId;
  const pairs = [
    [move.battle_effect1, move.battle_effect_chance1],
    [move.battle_effect2, move.battle_effect_chance2],
  ];

  for (const [battleEffectId, chance] of pairs) {
    if (!battleEffectId || battleEffectId === "none" || chance <= 0) continue;
    if (skipEffectIds?.has(battleEffectId)) continue;
    if (move.category === "attack" && battleEffectId === STUN_BATTLE_EFFECT_ID) continue;
    const battleEffect = battleEffects?.get(battleEffectId);
    if (battleEffect?.battle_effect_group === CHANGE_CHARACTER_BATTLE_EFFECT_GROUP) continue;
    if (Math.random() * 100 > chance) continue;

    if (battleEffectId === "charge_attack") {
      events.push(...applyChargeAttackBattleEffect(actor, battleEffect));
      if (battleEffect) {
        appliedBattleEffects.push(battleEffect);
      }
      continue;
    }

    if (!battleEffect) continue;

    if (isSideGuardBattleEffectId(battleEffectId) && actorSide) {
      const sideGuardResult = applySideGuardBattleEffect(
        fieldEffects,
        actorSide,
        actor,
        battleEffect,
        currentTurn,
        updatedNextFieldEffectId,
      );
      if (!sideGuardResult.applied) continue;
      updatedNextFieldEffectId = sideGuardResult.nextFieldEffectId;
      events.push(...sideGuardResult.events);
      appliedBattleEffects.push(...sideGuardResult.appliedBattleEffects);
      continue;
    }

    if (battleEffect.battle_effect_group === "delayed_attack") {
      const delayedTargetSide = actorSide === "player"
        ? "enemy"
        : actorSide === "enemy"
          ? "player"
          : targetSide;
      const delayedBattleEffectResult = applyDelayedAttackBattleEffect(
        fieldEffects,
        delayedTargetSide,
        battleEffect,
        move,
        actor,
        target,
        currentTurn,
        updatedNextFieldEffectId,
        actorSide,
      );
      if (!delayedBattleEffectResult.created) continue;
      updatedNextFieldEffectId = delayedBattleEffectResult.nextFieldEffectId;
      events.push(...delayedBattleEffectResult.events);
      appliedBattleEffects.push(...delayedBattleEffectResult.appliedBattleEffects);
      continue;
    }

    if (battleEffect.battle_effect_group === DELAYED_HEAL_BATTLE_EFFECT_GROUP) {
      const delayedBattleEffectResult = applyDelayedHealBattleEffect(
        fieldEffects,
        actorSide,
        battleEffect,
        actor,
        currentTurn,
        updatedNextFieldEffectId,
      );
      if (!delayedBattleEffectResult.created) continue;
      updatedNextFieldEffectId = delayedBattleEffectResult.nextFieldEffectId;
      events.push(...delayedBattleEffectResult.events);
      appliedBattleEffects.push(...delayedBattleEffectResult.appliedBattleEffects);
      continue;
    }

    const standardBattleEffectResult = applyStandardBattleEffect(
      actor,
      target,
      battleEffect,
      currentTurn,
      move,
    );
    events.push(...standardBattleEffectResult.events);
    appliedBattleEffects.push(...standardBattleEffectResult.appliedBattleEffects);
  }

  return {
    appliedBattleEffects,
    events,
    nextFieldEffectId: updatedNextFieldEffectId,
  };
}

function applyIncomingBattleEffects(target, damage, move, targetFieldEffects = [], context = {}) {
  let adjusted = damage;
  const activeFieldEffects = (targetFieldEffects ?? []).filter((effect) => !(
    effect?.group === "guard" &&
    isSideGuardBattleEffectId(effect.id) &&
    ignoresOpponentFieldEffect(target, context.actor, effect)
  ));
  const incomingBattleEffects = [
    ...(target?.battleEffects ?? []),
    ...activeFieldEffects,
  ];
  const applicableGuards = incomingBattleEffects
    .filter((effect) => effect.group === "guard" && guardAppliesToMove(effect, move));
  const strongestGeneralGuard = applicableGuards
    .filter((effect) => !isSideGuardBattleEffectId(effect.id))
    .reduce((best, effect) => {
      if (!best || number(effect.damage_cut) > number(best.damage_cut)) {
        return effect;
      }
      return best;
    }, null);
  const sideGuardsById = new Map();
  for (const effect of applicableGuards) {
    if (!isSideGuardBattleEffectId(effect.id)) continue;
    const current = sideGuardsById.get(effect.id);
    if (!current || number(effect.damage_cut) > number(current.damage_cut)) {
      sideGuardsById.set(effect.id, effect);
    }
  }

  for (const guard of [strongestGeneralGuard, ...sideGuardsById.values()].filter(Boolean)) {
    const cutRate = move.hit_type === "guard_break" ? (guard.damage_cut || 50) / 200 : (guard.damage_cut || 50) / 100;
    adjusted *= 1 - cutRate;
  }

  const position = target.battleEffects.find((effect) => POSITION_EFFECT_IDS.includes(effect.id));
  if (position) {
    adjusted *= 0.75;
  }

  return adjusted;
}

function guardAppliesToMove(effect, move) {
  const guardType = safeText(effect?.guard_type, "all_damage");
  if (guardType === "all_damage") return true;
  if (guardType === "phy_damage") return move?.attack_type === "physical";
  if (guardType === "sp_damage") return move?.attack_type === "special";
  if (Object.prototype.hasOwnProperty.call(ELEMENT_GUARD_TYPES, guardType)) {
    return safeText(move?.element, "none") === ELEMENT_GUARD_TYPES[guardType];
  }
  return true;
}

function canHitTarget(target, move) {
  const position = target.battleEffects.find((effect) => POSITION_EFFECT_IDS.includes(effect.id));
  if (!position || move.hit_type === "sure_hit") {
    return { canHit: true, reason: "" };
  }

  const requiredHitType = {
    fly: "anti_air",
    underground: "ground_wave",
    underwater: "water_wave",
    ghost_phase: "sure_hit",
  }[position.id];

  if (move.hit_type === requiredHitType) {
    return { canHit: true, reason: "" };
  }

  return { canHit: false, reason: `${target.name}に届かなかった！` };
}

function clearSleepOnAttackDamage(target) {
  if (!target?.statuses?.some((status) => status.id === "sleep")) return [];
  target.statuses = target.statuses.filter((status) => status.id !== "sleep");
  return target.hp > 0
    ? [{ type: "log", text: `${target.name}は目を覚ました！` }]
    : [];
}

function statusSourceMetadata(actor, context = {}) {
  const metadata = {};
  const sourceName = safeText(actor?.name);
  const sourceSide = safeText(context.actorSide);
  const targetSide = safeText(context.targetSide);
  if (sourceName) metadata.sourceName = sourceName;
  if (sourceSide) metadata.sourceSide = sourceSide;
  if (targetSide) metadata.targetSide = targetSide;
  return metadata;
}

function addTimedStatusEffect(effect, actor, target, context = {}) {
  const current = target.statuses.find((status) => status.id === effect.effect_id);
  const sourceMetadata = statusSourceMetadata(actor, context);
  if (current) {
    current.turns = Math.max(current.turns, effect.turn);
    current.damageValue = effect.damage_value;
    current.targetStat = effect.target_stat;
    Object.assign(current, sourceMetadata);
  } else {
    target.statuses.push({
      id: effect.effect_id,
      name: effect.name,
      group: effect.effect_group,
      damageType: effect.damage_type,
      damageValue: effect.damage_value,
      targetStat: effect.target_stat,
      turns: effect.turn,
      ...sourceMetadata,
    });
  }
  return effectStartLogEvents(
    effect,
    actor,
    target,
    {},
    `${target.name}は${effect.name}になった！`,
  );
}

function ensureTimedStatMods(fighter) {
  if (!Array.isArray(fighter?.timedStatMods)) {
    if (!fighter) return [];
    fighter.timedStatMods = [];
  }
  return fighter.timedStatMods;
}

function clearTimedStatModsForStat(fighter, stat) {
  if (!fighter || !Array.isArray(fighter.timedStatMods)) return;
  fighter.timedStatMods = fighter.timedStatMods.filter((entry) => entry.stat !== stat);
}

function tickTimedStatModsAfterRound(fighter) {
  if (!fighter || !fighter.statMods || !Array.isArray(fighter.timedStatMods)) return;

  const remaining = [];
  for (const entry of fighter.timedStatMods) {
    const turns = Math.max(0, Math.floor(number(entry.turns))) - 1;
    if (turns > 0) {
      remaining.push({ ...entry, turns });
      continue;
    }

    const stat = safeText(entry.stat);
    if (!stat || !Object.prototype.hasOwnProperty.call(fighter.statMods, stat)) continue;
    fighter.statMods[stat] = number(fighter.statMods[stat]) - number(entry.amount);
  }
  fighter.timedStatMods = remaining;
}

function applyStatModifierEffect(effect, actor, target, statLabels = {}) {
  const stat = effect.target_stat;
  if (!target.statMods[stat] && target.statMods[stat] !== 0) return [];

  const amount = effect.effect_group === "buff" ? effect.damage_value : -effect.damage_value;
  const before = target.statMods[stat];
  const stageLimit = Math.max(0, Math.abs(effect.damage_value) * 4);
  target.statMods[stat] = clamp(target.statMods[stat] + amount, -stageLimit, stageLimit);
  const changed = target.statMods[stat] - before;

  if (changed !== 0 && stat === "regen_value" && effect.turn > 0) {
    ensureTimedStatMods(target).push({
      stat,
      amount: changed,
      turns: effect.turn,
    });
  }

  if (changed !== 0) {
    return effectStartLogEvents(
      effect,
      actor,
      target,
      { changed, statLabels },
      `${target.name}の${statLabels[stat] ?? stat}が${amount > 0 ? "上がった" : "下がった"}！`,
    );
  }
  return [];
}

function applyClearDebuffEffect(effect, actor, target) {
  if (!target?.statMods) return [];

  let cleared = false;
  for (const stat of Object.keys(target.statMods)) {
    if (target.statMods[stat] < 0) {
      target.statMods[stat] = 0;
      clearTimedStatModsForStat(target, stat);
      cleared = true;
    }
  }

  const weakMods = ensureFighterWeakMods(target);
  for (const element of ELEMENT_TYPES) {
    const current = weakMods[element];
    if (current.value > 0) {
      current.value = 0;
      current.turns = 0;
      cleared = true;
    }
  }

  return cleared
    ? effectStartLogEvents(effect, actor, target, {}, `${target.name}の弱体が解除された！`)
    : [];
}

function applyClearBuffEffect(effect, actor, target) {
  if (!target?.statMods) return [];

  let cleared = false;
  for (const stat of Object.keys(target.statMods)) {
    if (target.statMods[stat] > 0) {
      target.statMods[stat] = 0;
      clearTimedStatModsForStat(target, stat);
      cleared = true;
    }
  }

  return cleared
    ? effectStartLogEvents(effect, actor, target, {}, `${target.name}の強化が解除された！`)
    : [];
}

function applyClearStatusEffect(effect, actor, target) {
  if (!Array.isArray(target?.statuses)) return [];

  const remainingStatuses = target.statuses.filter(
    (status) => !PASSIVE_STATUS_IMMUNITY_ALL_EFFECT_IDS.has(status.id),
  );
  if (remainingStatuses.length === target.statuses.length) return [];

  target.statuses = remainingStatuses;
  return effectStartLogEvents(
    effect,
    actor,
    target,
    {},
    `${target.name}の状態異常が回復した！`,
  );
}

function applyGenericStatusEffect(effect, actor, target, context = {}) {
  const current = target.statuses.find((status) => status.id === effect.effect_id);
  const sourceMetadata = statusSourceMetadata(actor, context);
  if (current) {
    current.turns = Math.max(current.turns, effect.turn);
    Object.assign(current, sourceMetadata);
  } else {
    target.statuses.push({
      id: effect.effect_id,
      name: effect.name,
      group: effect.effect_group,
      damageType: effect.damage_type,
      damageValue: effect.damage_value,
      targetStat: effect.target_stat,
      turns: effect.turn,
      ...sourceMetadata,
    });
  }
  return effectStartLogEvents(
    effect,
    actor,
    target,
    {},
    `${target.name}は${effect.name}になった！`,
  );
}

function applyEffect(effectId, actor, target, effects, statLabels = {}, context = {}) {
  if (!target) return [];

  if (effectId === "def_down") {
    return [
      ...applyEffect("phy_def_down", actor, target, effects, statLabels, context),
      ...applyEffect("sp_def_down", actor, target, effects, statLabels, context),
    ];
  }

  const effect = effects?.get(effectId);
  if (!effect) return [];

  const blockedBy = findBlockingEffectPassive({ actor, target, effect, move: context.move });
  if (blockedBy) return passiveActivationLogEvents(target, blockedBy);

  if (effect.effect_group === "heal") {
    return applyHealEffect(effect, actor, target);
  }

  if (effect.effect_group === "energy_up" || effect.effect_group === "energy_down") {
    return applyEnergyEffect(effect, actor, target);
  }

  if (effect.effect_group === "buff" || effect.effect_group === "debuff") {
    return applyStatModifierEffect(effect, actor, target, statLabels);
  }

  if (effect.effect_group === "clear_debuff") {
    return applyClearDebuffEffect(effect, actor, target);
  }

  if (effect.effect_group === "clear_buff") {
    return applyClearBuffEffect(effect, actor, target);
  }

  if (effect.effect_group === "clear_status") {
    return applyClearStatusEffect(effect, actor, target);
  }

  if (effect.effect_group === "resistance") {
    return applyResistanceEffect(effect, actor, target);
  }

  return applyGenericStatusEffect(effect, actor, target, context);
}

function normalizeEffectTarget(value) {
  return safeText(value, "enemy").toLowerCase() === "self" ? "self" : "enemy";
}

function applySkillEffects(move, actor, target, effects, statLabels, options = {}) {
  const events = [];
  const context = { ...options, move };
  const allowedTargets = Array.isArray(options.targets)
    ? new Set(options.targets.map(normalizeEffectTarget))
    : null;
  const pairs = [
    [move.effect1, move.effect_chance1, move.effect_target1],
    [move.effect2, move.effect_chance2, move.effect_target2],
    [move.effect3, move.effect_chance3, move.effect_target3],
  ];

  for (const [effectId, chance, effectTarget] of pairs) {
    if (!effectId || effectId === "none" || chance <= 0) continue;
    const normalizedTarget = normalizeEffectTarget(effectTarget);
    if (allowedTargets && !allowedTargets.has(normalizedTarget)) continue;
    if (Math.random() * 100 <= effectChanceWithPassive(actor, chance)) {
      const recipient = skillEffectRecipient(normalizedTarget, actor, target);
      events.push(...applyEffect(
        effectId,
        actor,
        recipient,
        effects,
        statLabels,
        {
          ...context,
          targetSide: normalizedTarget === "self" ? options.actorSide : options.targetSide,
        },
      ));
    }
  }

  return events;
}

function skillEffectRecipient(effectTarget, actor, target) {
  return normalizeEffectTarget(effectTarget) === "self" ? actor : target;
}

function elementFromWeakTargetStat(targetStat) {
  const match = safeText(targetStat).match(/^weak_(fire|water|thunder|ice|dragon)$/);
  return match?.[1] ?? "";
}

function elementFromResistanceEffectId(effectId) {
  const match = safeText(effectId).match(/^(fire|water|thunder|ice|dragon)_weak_(?:up|down)$/);
  return match?.[1] ?? "";
}

function resistanceEffectElement(effect) {
  return (
    elementFromWeakTargetStat(effect?.target_stat ?? effect?.targetStat) ||
    elementFromResistanceEffectId(effect?.effect_id ?? effect?.id)
  );
}

function resistanceWeakModDelta(effect) {
  const effectId = safeText(effect?.effect_id ?? effect?.id);
  const amount = Math.abs(number(effect?.damage_value ?? effect?.damageValue));
  if (effectId.endsWith("_weak_up")) return amount;
  if (effectId.endsWith("_weak_down")) return -amount;

  const name = safeText(effect?.name).toLowerCase();
  if (name.endsWith("down")) return amount;
  if (name.endsWith("up")) return -amount;
  return 0;
}

function applyResistanceEffect(effect, actor, target) {
  const element = resistanceEffectElement(effect);
  const delta = resistanceWeakModDelta(effect);
  if (!element || !delta) return [];

  const weakMods = ensureFighterWeakMods(target);
  const current = weakMods[element];
  const beforeValue = current.value;
  current.value = clamp(current.value + delta, TEMP_WEAK_MOD_MIN, TEMP_WEAK_MOD_MAX);
  current.turns = Math.max(0, Math.floor(number(effect.turn)));
  return effectStartLogEvents(
    effect,
    actor,
    target,
    { changed: current.value - beforeValue },
    `${target.name}は${effect.name}になった！`,
  );
}

function applyHealEffect(effect, actor, target) {
  const amount = Math.max(0, Math.abs(effect.damage_value));
  if (amount <= 0) return [];

  if (effect.target_stat === "hp") {
    const beforeHp = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + amount);
    const healed = target.hp - beforeHp;
    if (healed > 0) {
      return effectStartLogEvents(
        effect,
        actor,
        target,
        { changed: healed },
        `${target.name}は ${healed} 回復した！`,
      );
    }
    return [];
  }

  if (effect.target_stat === "en") {
    const beforeEnergy = target.energy;
    target.energy = clamp(target.energy + amount, 0, target.maxEnergy);
    const recovered = target.energy - beforeEnergy;
    if (recovered > 0) {
      return effectStartLogEvents(
        effect,
        actor,
        target,
        { changed: recovered },
        `${target.name}のENが ${recovered} 回復した！`,
      );
    }
  }

  return [];
}

function applyEnergyEffect(effect, actor, target) {
  if (effect.target_stat !== "en") return [];

  const amount = Math.max(0, Math.abs(effect.damage_value));
  if (amount <= 0) return [];

  if (effect.turn <= 0) {
    const beforeEnergy = target.energy;
    const nextEnergy = effect.effect_group === "energy_up"
      ? target.energy + amount
      : target.energy - amount;
    target.energy = clamp(nextEnergy, 0, target.maxEnergy);
    const changed = target.energy - beforeEnergy;
    if (changed > 0) {
      return effectStartLogEvents(
        effect,
        actor,
        target,
        { changed },
        `${target.name}のENが ${changed} 増えた！`,
      );
    }
    if (changed < 0) {
      return effectStartLogEvents(
        effect,
        actor,
        target,
        { changed },
        `${target.name}のENが ${Math.abs(changed)} 減った！`,
      );
    }
    return [];
  }

  return addTimedStatusEffect(effect, actor, target);
}

function twoTurnBattleEffectId(move) {
  return [
    [move.battle_effect1, move.battle_effect_chance1],
    [move.battle_effect2, move.battle_effect_chance2],
  ].find(([effectId, chance]) => (
    TWO_TURN_BATTLE_EFFECT_IDS.has(effectId) && chance > 0
  ))?.[0] ?? "";
}

function hasSetupOnlyDelayedAttackBattleEffect(move) {
  return [
    [move.battle_effect1, move.battle_effect_chance1],
    [move.battle_effect2, move.battle_effect_chance2],
  ].some(([effectId, chance]) => (
    chance > 0 && DELAYED_ATTACK_SETUP_ONLY_EFFECT_IDS.has(effectId)
  ));
}

function delayedHealAmount(effect, target) {
  if (effect.damage_type === "percent_maxhp") {
    return Math.max(0, Math.round(target.maxHp * ((effect.damage_value || 0) / 100)));
  }
  return Math.max(0, Math.round(effect.damage_value || 0));
}

function delayedEffectMove(effect) {
  if (!effect.delayedMove) return null;
  return {
    skill_id: effect.id,
    name: effect.delayedMove.name || effect.name,
    category: "attack",
    power: Math.max(1, number(effect.delayedMove.power, 1)),
    element: safeText(effect.delayedMove.element, "none"),
    attack_type: safeText(effect.delayedMove.attack_type, "special"),
    hit_type: safeText(effect.delayedMove.hit_type, "sure_hit"),
    animation_id: safeText(effect.delayedMove.animation_id),
    animation_duration_ms: Math.max(0, number(effect.delayedMove.animation_duration_ms)),
    repeat_count: Math.max(0, number(effect.delayedMove.repeat_count)),
    isBattleEffectDamage: true,
    target: "enemy",
  };
}

function effectiveEnergyCharge(fighter) {
  const baseCharge = Math.max(0, fighter?.base?.energy_charge || 0);
  const modifier = fighterEnergyChargeModifier(fighter);
  return Math.max(0, baseCharge + modifier);
}

function effectiveRegenValue(fighter) {
  const baseRegen = Math.max(0, fighter?.base?.regen_value || 0);
  const modifier = fighter?.statMods?.regen_value || 0;
  return Math.max(0, Math.round(baseRegen + modifier));
}

function fighterEnergyChargeModifier(fighter) {
  if (!fighter) return 0;
  return fighter.statuses.reduce((total, status) => {
    if (status.targetStat !== "en") return total;
    const amount = Math.max(0, Math.abs(status.damageValue || 0));
    if (status.group === "energy_up") return total + amount;
    if (status.group === "energy_down") return total - amount;
    return total;
  }, 0);
}

function tickWeakModsAfterRound(fighter) {
  if (!fighter) return;
  const weakMods = ensureFighterWeakMods(fighter);
  for (const element of ELEMENT_TYPES) {
    const current = weakMods[element];
    if (current.turns <= 0) continue;
    current.turns -= 1;
    if (current.turns <= 0) {
      current.value = 0;
      current.turns = 0;
    }
  }
}

function effectiveStat(fighter, stat) {
  return Math.max(1, Math.round(fighter.base[stat] * (1 + (fighter.statMods[stat] || 0) / 100)));
}

function weaknessMultiplier(target, element) {
  if (!element || element === "none") return 1;
  return effectiveWeakPercent(target, element) / 100;
}

function effectiveWeakPercent(target, element) {
  const baseWeak = Math.round(number(target?.base?.weaknesses?.[element], 1) * 100);
  return baseWeak + temporaryWeakModValue(target, element);
}

function temporaryWeakModValue(target, element) {
  if (!target || !ELEMENT_TYPES.includes(element)) return 0;
  return ensureFighterWeakMods(target)[element].value;
}
