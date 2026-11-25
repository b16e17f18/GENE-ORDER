const ENEMY_AI_CONFIG = {
  DEBUG: false,
  AVERAGE_DAMAGE_VARIANCE: 0.975,
  WAITING_PENALTY: 25,
  TWO_TURN_DAMAGE_MULTIPLIER: 0.82,
  DELAYED_DAMAGE_MULTIPLIER: 0.62,
  MIN_FUTURE_GAIN: 20,
  ENERGY_COST_PENALTY: 3,
  EMPTY_ENERGY_PENALTY: 8,
  LOW_HP_DAMAGE_RATIO: 0.7,
  SAVE_BLOCK_PENALTY: 10000,
  HEAL_BASE_WEIGHT: 0.45,
  HEAL_MISSING_HP_WEIGHT: 1.25,
  BUFF_LOW_HP_RATIO: 0.25,
  BUFF_LOW_HP_MULTIPLIER: 0.45,
  PROTECT_BASE_WEIGHT: 0.8,
  PROTECT_MISSING_HP_WEIGHT: 1,
  PROTECT_TURN_BONUS: 5,
  STATUS_CONTROL_BASE_SCORE: 42,
  STATUS_DAMAGE_BASE_SCORE: 28,
  STATUS_TURN_BONUS: 6,
  STATUS_DAMAGE_WEIGHT: 0.45,
  STATUS_TARGET_HP_MIN_MULTIPLIER: 0.15,
  STATUS_EFFECT_SCORE_MULTIPLIERS: {
    paralysis: 1.12,
    sleep: 0.95,
    poison: 1,
    burn: 1.05,
    stun: 0.75,
  },
  DEBUFF_TARGET_HP_MIN_MULTIPLIER: 0.25,
  NEAR_BEST_RANDOM_RANGE: 0.1,
  NEAR_BEST_MIN_RANGE: 5,
  CANDIDATE_MIN_WEIGHT: 1,
  CANDIDATE_WEIGHT_OFFSET: 1,
  KO_BONUS: 1000,
  LEGACY_FALLBACK_SCORE_RATIO: 0.94,
  MAIN_SKILL_SCORE_MULTIPLIER: 1.08,
  SETUP_SKILL_SCORE_MULTIPLIER: 1.18,
  SETUP_FIRST_TURN_MULTIPLIER: 1.25,
  SETUP_MAIN_EN_SHORT_MULTIPLIER: 1.12,
  SWITCH_OFFENSE_WEIGHT: 1,
  SWITCH_INCOMING_DAMAGE_WEIGHT: 0.65,
  SWITCH_INCOMING_HP_RATIO_WEIGHT: 35,
  SWITCH_HP_RATIO_WEIGHT: 30,
  SWITCH_MATCHUP_ADVANTAGE_THRESHOLD: 60,
  SWITCH_MATCHUP_MIN_BENCH_SCORE: 20,
  SWITCH_MATCHUP_MIN_BENCH_HP_RATIO: 0.18,
};

const ENEMY_AI_TYPE_CONFIGS = {
  balanced: {},
  aggressive: {
    WAITING_PENALTY: 40,
    ATTACK_SCORE_MULTIPLIER: 1.1,
    MAIN_SKILL_TYPE_MULTIPLIER: 1.04,
  },
  patient: {
    WAITING_PENALTY: 10,
    SETUP_SKILL_TYPE_MULTIPLIER: 1.08,
  },
  defensive: {
    HEAL_SCORE_MULTIPLIER: 1.15,
    PROTECT_SCORE_MULTIPLIER: 1.15,
    DEFENSE_BUFF_SCORE_MULTIPLIER: 1.15,
  },
  disruptor: {
    STATUS_SCORE_MULTIPLIER: 1.15,
    DEBUFF_SCORE_MULTIPLIER: 1.15,
  },
  tactical: {
    SETUP_SKILL_TYPE_MULTIPLIER: 1.12,
    MAIN_SKILL_TYPE_MULTIPLIER: 1.06,
    SWITCH_MATCHUP_ADVANTAGE_MULTIPLIER: 1.1,
  },
};

const ENEMY_AI_ELEMENT_GUARD_TYPES = {
  fire_damage: "fire",
  water_damage: "water",
  thunder_damage: "thunder",
  ice_damage: "ice",
  dragon_damage: "dragon",
};
const ENEMY_AI_SWITCH_LOCK_BATTLE_EFFECT_ID = "switch_lock";
const ENEMY_AI_NO_VOLUNTARY_SWITCH_BATTLE_IDS = new Set([
  "rank_f_1",
  "rank_f_2",
  "rank_e_1",
  "rank_e_2",
  "rank_d_1",
  "rank_d_2",
]);

function isLowRankNoSwitchBattle(context) {
  return ENEMY_AI_NO_VOLUNTARY_SWITCH_BATTLE_IDS.has(safeText(context?.battleId));
}

function canAiVoluntarilySwitch(context, enemy) {
  return !isLowRankNoSwitchBattle(context) && !enemyAiHasSwitchLock(enemy);
}

function chooseEnemyBattleAction(context) {
  const enemy = context.enemy;
  const pendingMoveId = pendingSkillId(enemy);
  if (pendingMoveId) {
    return { side: "enemy", type: "move", moveId: pendingMoveId };
  }

  const lowHp = enemy.hp / enemy.maxHp <= 0.28;
  const bench = context.enemyBenchIndex;
  const canVoluntarilySwitch = canAiVoluntarilySwitch(context, enemy);

  if (canVoluntarilySwitch && lowHp && bench >= 0 && Math.random() < 0.22) {
    return {
      side: "enemy",
      type: "switch",
      index: chooseEnemySwitchIndex(context, bench, enemyAiConfigFor(enemy)),
    };
  }

  const target = context.target;
  const aiConfig = enemyAiConfigFor(enemy);
  const allMoves = context.allMoves;
  const usableMoves = allMoves.filter((move) => (
    move.cost <= enemy.energy &&
    !enemyAiMoveBlockedByHealBlock(enemy, target, move, context)
  ));
  const usableAttackMoveScores = usableMoves
    .map((move) => scoreEnemyUsableMove(enemy, target, move, context, aiConfig))
    .filter(Boolean)
    .map((candidate) => applyEnemySkillPreference(candidate, context, enemy, aiConfig));
  const twoTurnMoveScores = usableMoves
    .map((move) => scoreEnemyTwoTurnMove(enemy, target, move, context, aiConfig))
    .filter(Boolean)
    .map((candidate) => applyEnemySkillPreference(candidate, context, enemy, aiConfig));
  const delayedAttackMoveScores = usableMoves
    .map((move) => scoreEnemyDelayedAttackMove(enemy, target, move, context, aiConfig))
    .filter(Boolean)
    .map((candidate) => applyEnemySkillPreference(candidate, context, enemy, aiConfig));
  const supportMoveScores = usableMoves
    .map((move) => scoreEnemySupportMove(enemy, target, move, context, aiConfig))
    .filter(Boolean)
    .map((candidate) => applyEnemySkillPreference(candidate, context, enemy, aiConfig));
  const usableMoveScores = [
    ...usableAttackMoveScores,
    ...twoTurnMoveScores,
    ...delayedAttackMoveScores,
    ...supportMoveScores,
  ];
  const scoredMoveIds = new Set(usableMoveScores.map((candidate) => candidate.move.skill_id));
  const legacyFallbackMove = pickLegacyEnemyMove(
    usableMoves.filter((move) => (
      !scoredMoveIds.has(move.skill_id) &&
      move.category === "attack" &&
      !hasEnemyAiDelayedAttackBattleEffect(move, context.battleEffects)
    )),
  );
  const saveEnergy = scoreEnemySaveEnergy(enemy, target, allMoves, usableMoveScores, context, aiConfig);
  const knockoutMoves = [...usableAttackMoveScores, ...delayedAttackMoveScores]
    .filter((candidate) => candidate.canKnockout);

  if (knockoutMoves.length) {
    const selected = knockoutMoves.sort(compareEnemyKnockoutMoves)[0];
    debugEnemyAI(enemy, {
      usableMoveScores,
      saveEnergy,
      selected: selected.move.skill_id,
      reason: "knockout",
    });
    return { side: "enemy", type: "move", moveId: selected.move.skill_id };
  }

  const matchupSwitchIndex = canVoluntarilySwitch && !lowHp
    ? chooseEnemyMatchupSwitchIndex(context, bench, aiConfig)
    : -1;
  if (matchupSwitchIndex >= 0) {
    return { side: "enemy", type: "switch", index: matchupSwitchIndex };
  }

  if (!usableMoves.length) {
    debugEnemyAI(enemy, {
      usableMoveScores,
      saveEnergy,
      selected: context.saveEnergyEnabled ? "save_energy" : "idle",
      reason: "no_usable_moves",
    });
    return context.saveEnergyEnabled
      ? { side: "enemy", type: "save_energy" }
      : { side: "enemy", type: "idle" };
  }

  if (!usableMoveScores.length) {
    if (context.saveEnergyEnabled && saveEnergy.available && saveEnergy.score > 0) {
      debugEnemyAI(enemy, {
        usableMoveScores,
        saveEnergy,
        selected: "save_energy",
        reason: "future_move",
      });
      return { side: "enemy", type: "save_energy" };
    }

    const fallbackMove = pickLegacyEnemyMove(
      usableMoves.filter((move) => !hasEnemyAiDelayedAttackBattleEffect(move, context.battleEffects)),
    );
    if (fallbackMove) {
      debugEnemyAI(enemy, {
        usableMoveScores,
        saveEnergy,
        selected: fallbackMove.skill_id,
        reason: "legacy_fallback",
      });
      return { side: "enemy", type: "move", moveId: fallbackMove.skill_id };
    }

    return context.saveEnergyEnabled
      ? { side: "enemy", type: "save_energy" }
      : { side: "enemy", type: "idle" };
  }

  const currentBestScore = Math.max(...usableMoveScores.map((candidate) => candidate.score));
  const candidates = [
    ...usableMoveScores.map((candidate) => ({
      ...candidate,
      action: { side: "enemy", type: "move", moveId: candidate.move.skill_id },
    })),
  ];
  if (context.saveEnergyEnabled) {
    candidates.push({
      type: "save_energy",
      score: saveEnergy.score,
      estimatedDamage: 0,
      action: { side: "enemy", type: "save_energy" },
    });
  }
  if (legacyFallbackMove) {
    candidates.push({
      type: "move",
      move: legacyFallbackMove,
      score: currentBestScore * aiConfig.LEGACY_FALLBACK_SCORE_RATIO,
      estimatedDamage: 0,
      legacyFallback: true,
      action: { side: "enemy", type: "move", moveId: legacyFallbackMove.skill_id },
    });
  }
  const selected = pickEnemyAiCandidate(candidates, aiConfig);
  debugEnemyAI(enemy, {
    usableMoveScores,
    saveEnergy,
    selected: selected.action.type === "save_energy" ? "save_energy" : selected.action.moveId,
    reason: "scored",
  });
  return selected.action;
}

function enemyAiMoveBlockedByHealBlock(enemy, target, move, context) {
  return Boolean(
    typeof findHealBlockForMove === "function" &&
      findHealBlockForMove({
        actor: enemy,
        opponent: target,
        move,
        effectLookup: context.effects,
      })
  );
}

function isEnemyAiScoredMove(move, battleEffects) {
  return Boolean(
    move &&
      move.category === "attack" &&
      move.target !== "self" &&
      !twoTurnBattleEffectId(move) &&
      !hasEnemyAiDelayedAttackBattleEffect(move, battleEffects)
  );
}

function enemyAiTypeFor(enemy) {
  const aiType = safeText(enemy?.base?.ai_type, "balanced").toLowerCase();
  return Object.hasOwn(ENEMY_AI_TYPE_CONFIGS, aiType) ? aiType : "balanced";
}

function enemyAiConfigFor(enemy) {
  const aiType = enemyAiTypeFor(enemy);
  return {
    ...ENEMY_AI_CONFIG,
    ...(ENEMY_AI_TYPE_CONFIGS[aiType] ?? ENEMY_AI_TYPE_CONFIGS.balanced),
  };
}

function scoreEnemyUsableMove(enemy, target, move, context, aiConfig = ENEMY_AI_CONFIG) {
  if (!enemy || !target || !isEnemyAiScoredMove(move, context.battleEffects)) return null;
  const hitCheck = canHitTarget(target, move);
  if (!hitCheck.canHit) return null;

  const estimatedDamage = estimateMoveDamage(
    enemy,
    target,
    move,
    aiConfig,
    context.powerRules,
    context.targetFieldEffects,
  );
  const canKnockout = estimatedDamage >= target.hp;
  let score = estimatedDamage * enemyAiTypeMultiplier(aiConfig, "ATTACK_SCORE_MULTIPLIER") -
    move.cost * aiConfig.ENERGY_COST_PENALTY;
  if (enemy.energy - move.cost <= 0) {
    score -= aiConfig.EMPTY_ENERGY_PENALTY;
  }
  if (canKnockout) {
    score += aiConfig.KO_BONUS;
  }
  score += scoreEnemyTargetStatusMove(target, move, context, aiConfig);
  score += scoreEnemyTargetDebuffMove(target, move, context.effects, aiConfig);

  return {
    type: "move",
    move,
    score,
    estimatedDamage,
    canKnockout,
  };
}

function scoreEnemyTwoTurnMove(enemy, target, move, context, aiConfig = ENEMY_AI_CONFIG) {
  if (!enemy || !target || !isEnemyAiTwoTurnScoredMove(move, context.battleEffects)) return null;
  const hitCheck = canHitTarget(target, move);
  if (!hitCheck.canHit) return null;

  const estimatedDamage = estimateMoveDamage(
    enemy,
    target,
    move,
    aiConfig,
    context.powerRules,
    context.targetFieldEffects,
  );
  let score =
    estimatedDamage *
      aiConfig.TWO_TURN_DAMAGE_MULTIPLIER *
      enemyAiTypeMultiplier(aiConfig, "ATTACK_SCORE_MULTIPLIER") -
    aiConfig.WAITING_PENALTY -
    move.cost * aiConfig.ENERGY_COST_PENALTY;
  if (enemy.energy - move.cost <= 0) {
    score -= aiConfig.EMPTY_ENERGY_PENALTY;
  }

  return {
    type: "move",
    move,
    score,
    estimatedDamage,
    canKnockout: false,
    futureCanKnockout: estimatedDamage >= target.hp,
    twoTurn: true,
  };
}

function scoreEnemyDelayedAttackMove(enemy, target, move, context, aiConfig = ENEMY_AI_CONFIG) {
  if (!enemy || !target || !isEnemyAiDelayedAttackScoredMove(move, context.battleEffects)) return null;
  const delayedPairs = enemyAiDelayedAttackBattleEffectPairs(move, context.battleEffects);
  if (!delayedPairs.length) return null;
  if (enemyAiHasPendingDelayedAttack(delayedPairs, context.targetFieldEffects)) return null;

  const setupOnly = enemyAiIsDelayedAttackSetupOnly(move);
  const immediateDamage = setupOnly
    ? 0
    : estimateMoveDamage(
        enemy,
        target,
        move,
        aiConfig,
        context.powerRules,
        context.targetFieldEffects,
      );
  let delayedEstimatedDamage = 0;
  const delayedDamageScore = delayedPairs.reduce((total, pair) => {
    const delayedMove = enemyAiDelayedAttackMove(move, enemy, pair.battleEffect);
    if (!delayedMove) return total;
    const hitCheck = canHitTarget(target, delayedMove);
    if (!hitCheck.canHit) return total;
    const futureDamage = estimateMoveDamage(
      enemy,
      target,
      delayedMove,
      aiConfig,
      context.powerRules,
        context.targetFieldEffects,
      );
    const chanceWeight = enemyAiChanceWeight(pair.chance);
    delayedEstimatedDamage += futureDamage * chanceWeight;
    return total +
      futureDamage *
        aiConfig.DELAYED_DAMAGE_MULTIPLIER *
        chanceWeight;
  }, 0);
  if (setupOnly && delayedDamageScore <= 0) return null;

  const canKnockout = !setupOnly && immediateDamage >= target.hp;
  let score =
    immediateDamage * enemyAiTypeMultiplier(aiConfig, "ATTACK_SCORE_MULTIPLIER") +
    delayedDamageScore -
    move.cost * aiConfig.ENERGY_COST_PENALTY;
  if (setupOnly) {
    score -= aiConfig.WAITING_PENALTY;
  } else {
    score += scoreEnemyTargetStatusMove(target, move, context, aiConfig);
    score += scoreEnemyTargetDebuffMove(target, move, context.effects, aiConfig);
  }
  if (enemy.energy - move.cost <= 0) {
    score -= aiConfig.EMPTY_ENERGY_PENALTY;
  }
  if (canKnockout) {
    score += aiConfig.KO_BONUS;
  }

  return {
    type: "move",
    move,
    score,
    estimatedDamage: immediateDamage,
    delayedEstimatedDamage,
    delayedEstimatedScore: delayedDamageScore,
    canKnockout,
    futureCanKnockout: delayedEstimatedDamage >= target.hp,
    delayedAttack: true,
    delayedSetupOnly: setupOnly,
  };
}

function scoreEnemySupportMove(enemy, target, move, context, aiConfig = ENEMY_AI_CONFIG) {
  if (!enemy || !move || move.category === "attack") return null;
  if (move.target !== "self") {
    const hitCheck = target ? canHitTarget(target, move) : { canHit: false };
    if (!hitCheck.canHit) return null;
  }

  const supportScore =
    scoreEnemyHealingMove(enemy, move, context.effects, aiConfig) +
    scoreEnemySelfBuffMove(enemy, move, context.effects, aiConfig) +
    scoreEnemyProtectMove(enemy, move, context, aiConfig) +
    scoreEnemyTargetStatusMove(target, move, context, aiConfig) +
    scoreEnemyTargetDebuffMove(target, move, context.effects, aiConfig);
  const score = supportScore - move.cost * aiConfig.ENERGY_COST_PENALTY;
  if (enemy.energy - move.cost <= 0) {
    return score - aiConfig.EMPTY_ENERGY_PENALTY > 0
      ? supportMoveCandidate(move, score - aiConfig.EMPTY_ENERGY_PENALTY, supportScore)
      : null;
  }
  return score > 0 ? supportMoveCandidate(move, score, supportScore) : null;
}

function supportMoveCandidate(move, score, supportScore) {
  return {
    type: "move",
    move,
    score,
    estimatedDamage: 0,
    canKnockout: false,
    supportScore,
  };
}

function chooseEnemySwitchIndex(context, fallbackIndex, aiConfig = ENEMY_AI_CONFIG) {
  const candidates = enemyAiSwitchCandidates(context);

  if (candidates.length === 0) return fallbackIndex;
  if (candidates.length === 1) return candidates[0].index;

  const selected = bestEnemySwitchCandidate(context, aiConfig);
  return selected?.index ?? fallbackIndex;
}

function chooseEnemyMatchupSwitchIndex(context, fallbackIndex, aiConfig = ENEMY_AI_CONFIG) {
  if (fallbackIndex < 0) return -1;

  const current = scoreEnemySwitchCandidate(
    { index: -1, fighter: context.enemy, moves: context.allMoves },
    context,
    aiConfig,
  );
  const selected = bestEnemySwitchCandidate(context, aiConfig);
  if (!current || !selected) return -1;
  if (selected.hpRatio < aiConfig.SWITCH_MATCHUP_MIN_BENCH_HP_RATIO) return -1;
  if (selected.score < aiConfig.SWITCH_MATCHUP_MIN_BENCH_SCORE) return -1;
  const advantage = (selected.score - current.score) *
    enemyAiTypeMultiplier(aiConfig, "SWITCH_MATCHUP_ADVANTAGE_MULTIPLIER");
  if (advantage < aiConfig.SWITCH_MATCHUP_ADVANTAGE_THRESHOLD) return -1;

  return selected.index;
}

function bestEnemySwitchCandidate(context, aiConfig = ENEMY_AI_CONFIG) {
  const scoredCandidates = enemyAiSwitchCandidates(context)
    .map((candidate) => scoreEnemySwitchCandidate(candidate, context, aiConfig))
    .filter(Boolean);
  if (!scoredCandidates.length) return null;

  scoredCandidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  });
  return scoredCandidates[0];
}

function enemyAiSwitchCandidates(context) {
  const candidates = Array.isArray(context.enemySwitchCandidates)
    ? context.enemySwitchCandidates.filter((candidate) => (
        candidate &&
        Number.isInteger(candidate.index) &&
        candidate.index >= 0 &&
        candidate.fighter &&
        !candidate.fighter.fainted
      ))
    : [];

  return candidates;
}

function scoreEnemySwitchCandidate(candidate, context, aiConfig) {
  const fighter = candidate.fighter;
  const player = context.target;
  if (!fighter || !player) return null;

  const offense = bestEnemyAiEstimatedAttackDamage(
    fighter,
    player,
    candidate.moves,
    context,
    context.targetFieldEffects,
    aiConfig,
  );
  const incoming = bestEnemyAiEstimatedAttackDamage(
    player,
    fighter,
    context.playerMoves,
    context,
    context.enemyFieldEffects,
    aiConfig,
  );
  if (!offense.available && !incoming.available) return null;

  const hpRatio = enemyAiHpRatio(fighter);
  const incomingHpRatio = fighter.hp > 0
    ? Math.min(2, incoming.damage / fighter.hp)
    : 2;
  const score =
    offense.damage * aiConfig.SWITCH_OFFENSE_WEIGHT -
    incoming.damage * aiConfig.SWITCH_INCOMING_DAMAGE_WEIGHT -
    incomingHpRatio * aiConfig.SWITCH_INCOMING_HP_RATIO_WEIGHT +
    hpRatio * aiConfig.SWITCH_HP_RATIO_WEIGHT;

  return {
    index: candidate.index,
    score,
    offenseDamage: offense.damage,
    incomingDamage: incoming.damage,
    hpRatio,
  };
}

function bestEnemyAiEstimatedAttackDamage(
  attacker,
  target,
  moves,
  context,
  targetFieldEffects,
  aiConfig = ENEMY_AI_CONFIG,
) {
  const attackScores = (moves ?? [])
    .filter((move) => move?.category === "attack")
    .filter((move) => move.cost <= (attacker?.energy ?? 0))
    .filter((move) => isEnemyAiScoredMove(move, context.battleEffects))
    .map((move) => {
      const hitCheck = canHitTarget(target, move);
      if (!hitCheck.canHit) return 0;
      return estimateMoveDamage(
        attacker,
        target,
        move,
        aiConfig,
        context.powerRules,
        targetFieldEffects,
      );
    });
  const damage = Math.max(0, ...attackScores);
  return {
    available: damage > 0,
    damage,
  };
}

function applyEnemySkillPreference(candidate, context, enemy, aiConfig) {
  if (!candidate?.move || candidate.score <= 0) return candidate;

  const skillId = safeText(candidate.move.skill_id);
  const setupSkillId = safeText(context.aiSetupSkill);
  const mainSkillId = safeText(context.aiMainSkill);
  let multiplier = 1;

  if (mainSkillId && skillId === mainSkillId) {
    multiplier *= aiConfig.MAIN_SKILL_SCORE_MULTIPLIER;
    multiplier *= enemyAiTypeMultiplier(aiConfig, "MAIN_SKILL_TYPE_MULTIPLIER");
  }
  if (setupSkillId && skillId === setupSkillId) {
    multiplier *= aiConfig.SETUP_SKILL_SCORE_MULTIPLIER;
    multiplier *= enemyAiTypeMultiplier(aiConfig, "SETUP_SKILL_TYPE_MULTIPLIER");
    if (enemyAiIsOpeningTurn(context)) {
      multiplier *= aiConfig.SETUP_FIRST_TURN_MULTIPLIER;
    }
    if (enemyAiMainSkillNeedsEnergy(context, enemy)) {
      multiplier *= aiConfig.SETUP_MAIN_EN_SHORT_MULTIPLIER;
    }
  }

  if (multiplier === 1) return candidate;
  return {
    ...candidate,
    score: candidate.score * multiplier,
    preferenceMultiplier: multiplier,
  };
}

function enemyAiIsOpeningTurn(context) {
  const turn = Number(context.turn);
  return Number.isFinite(turn) && turn <= 1;
}

function enemyAiMainSkillNeedsEnergy(context, enemy) {
  const mainSkillId = safeText(context.aiMainSkill);
  if (!mainSkillId) return false;

  const mainMove = (context.allMoves ?? []).find((move) => move?.skill_id === mainSkillId);
  return Boolean(mainMove && mainMove.cost > (enemy?.energy ?? 0));
}

function scoreEnemyHealingMove(enemy, move, effects, aiConfig) {
  return enemyAiMoveEffectPairs(move)
    .filter((pair) => enemyAiEffectTargetsSelf(move, pair.effectTarget))
    .reduce((total, pair) => {
      const effect = effects?.get(pair.effectId);
      if (effect?.effect_group !== "heal" || effect.target_stat !== "hp") return total;
      const missingHp = Math.max(0, enemy.maxHp - enemy.hp);
      if (missingHp <= 0) return total;

      const healAmount = Math.max(0, Math.abs(Number(effect.damage_value) || 0));
      if (healAmount <= 0) return total;

      const effectiveHeal = Math.min(missingHp, healAmount);
      const missingRatio = enemy.maxHp > 0 ? missingHp / enemy.maxHp : 0;
      const urgency = aiConfig.HEAL_BASE_WEIGHT + missingRatio * aiConfig.HEAL_MISSING_HP_WEIGHT;
      return total +
        effectiveHeal *
          urgency *
          enemyAiChanceWeight(pair.chance) *
          enemyAiTypeMultiplier(aiConfig, "HEAL_SCORE_MULTIPLIER");
    }, 0);
}

function scoreEnemySelfBuffMove(enemy, move, effects, aiConfig) {
  return enemyAiMoveEffectPairs(move)
    .filter((pair) => enemyAiEffectTargetsSelf(move, pair.effectTarget))
    .reduce((total, pair) => {
      const effect = effects?.get(pair.effectId);
      if (effect?.effect_group !== "buff") return total;

      const stat = effect.target_stat;
      if (!["phy_atk", "phy_def", "sp_atk", "sp_def", "speed"].includes(stat)) return total;

      const amount = Math.max(0, Math.abs(Number(effect.damage_value) || 0));
      if (amount <= 0) return total;

      const current = Number(enemy.statMods?.[stat]) || 0;
      const stageLimit = amount * 4;
      if (current >= stageLimit) return total;

      const stackMultiplier = enemyAiBuffStackMultiplier(current, amount);
      const lowHpMultiplier = enemyAiHpRatio(enemy) <= aiConfig.BUFF_LOW_HP_RATIO
        ? aiConfig.BUFF_LOW_HP_MULTIPLIER
        : 1;
      const statWeight = enemyAiBuffStatWeight(stat);
      return total +
        amount *
          statWeight *
          stackMultiplier *
          lowHpMultiplier *
          enemyAiChanceWeight(pair.chance) *
          enemyAiSelfBuffTypeMultiplier(stat, aiConfig);
    }, 0);
}

function scoreEnemyProtectMove(enemy, move, context, aiConfig) {
  return enemyAiMoveBattleEffectPairs(move)
    .reduce((total, pair) => {
      const battleEffect = context.battleEffects?.get(pair.effectId);
      if (battleEffect?.battle_effect_group !== "guard") return total;
      if (enemyAiHasActiveGuard(enemy, context.actorFieldEffects, battleEffect.battle_effect_id)) return total;
      if (!enemyAiElementGuardMatchesPlayerMoves(enemy, battleEffect, context)) return total;

      const damageCut = Math.max(0, Number(battleEffect.damage_cut) || 0);
      if (damageCut <= 0) return total;

      const missingRatio = 1 - enemyAiHpRatio(enemy);
      const urgency = aiConfig.PROTECT_BASE_WEIGHT + missingRatio * aiConfig.PROTECT_MISSING_HP_WEIGHT;
      const turnBonus = Math.max(0, Math.min(4, Math.floor(Number(battleEffect.turn) || 0))) * aiConfig.PROTECT_TURN_BONUS;
      return total +
        (damageCut * urgency + turnBonus) *
          enemyAiChanceWeight(pair.chance) *
          enemyAiTypeMultiplier(aiConfig, "PROTECT_SCORE_MULTIPLIER");
    }, 0);
}

function enemyAiElementGuardMatchesPlayerMoves(enemy, battleEffect, context) {
  const requiredElement = ENEMY_AI_ELEMENT_GUARD_TYPES[safeText(battleEffect?.guard_type)];
  if (!requiredElement) return true;

  return (context.playerMoves ?? []).some((playerMove) => (
    playerMove?.category === "attack" &&
    safeText(playerMove.element, "none") === requiredElement &&
    playerMove.cost <= (context.target?.energy ?? 0) &&
    canHitTarget(enemy, playerMove).canHit
  ));
}

function enemyAiHasSwitchLock(fighter) {
  return Boolean(
    fighter?.battleEffects?.some((effect) => effect.id === ENEMY_AI_SWITCH_LOCK_BATTLE_EFFECT_ID),
  );
}

function scoreEnemyTargetStatusMove(target, move, context, aiConfig) {
  const effectScore = enemyAiMoveEffectPairs(move)
    .filter((pair) => enemyAiEffectTargetsEnemy(move, pair.effectTarget))
    .reduce((total, pair) => {
      const effect = context.effects?.get(pair.effectId);
      if (!enemyAiIsTargetStatusEffect(effect)) return total;
      if (enemyAiTargetHasEffect(target, effect.effect_id)) return total;
      return total + enemyAiStatusEffectScore(effect, target, aiConfig) * enemyAiChanceWeight(pair.chance);
    }, 0);
  const battleEffectScore = enemyAiMoveBattleEffectPairs(move)
    .reduce((total, pair) => {
      const battleEffect = context.battleEffects?.get(pair.effectId);
      if (battleEffect?.battle_effect_group !== "control") return total;
      if (enemyAiTargetHasEffect(target, battleEffect.battle_effect_id)) return total;
      return total +
        enemyAiControlStatusScore(battleEffect, target, aiConfig) *
          enemyAiChanceWeight(pair.chance) *
          enemyAiTypeMultiplier(aiConfig, "STATUS_SCORE_MULTIPLIER");
    }, 0);
  return effectScore + battleEffectScore;
}

function scoreEnemyTargetDebuffMove(target, move, effects, aiConfig) {
  return enemyAiMoveEffectPairs(move)
    .filter((pair) => enemyAiEffectTargetsEnemy(move, pair.effectTarget))
    .reduce((total, pair) => {
      const effect = effects?.get(pair.effectId);
      if (effect?.effect_group !== "debuff") return total;

      const stat = effect.target_stat;
      if (!["phy_atk", "phy_def", "sp_atk", "sp_def", "speed"].includes(stat)) return total;

      const amount = Math.max(0, Math.abs(Number(effect.damage_value) || 0));
      if (amount <= 0) return total;

      const current = Number(target?.statMods?.[stat]) || 0;
      const stageLimit = amount * 4;
      if (current <= -stageLimit) return total;

      const targetHpMultiplier = Math.max(
        aiConfig.DEBUFF_TARGET_HP_MIN_MULTIPLIER,
        enemyAiHpRatio(target),
      );
      const stackMultiplier = enemyAiDebuffStackMultiplier(current, amount);
      return total +
        amount *
          enemyAiDebuffStatWeight(stat) *
          targetHpMultiplier *
          stackMultiplier *
          enemyAiChanceWeight(pair.chance) *
          enemyAiTypeMultiplier(aiConfig, "DEBUFF_SCORE_MULTIPLIER");
    }, 0);
}

function scoreEnemySaveEnergy(enemy, target, allMoves, usableMoveScores, context, aiConfig = ENEMY_AI_CONFIG) {
  const currentEnergy = enemy?.energy ?? 0;
  const energyCharge = enemy?.base?.energy_charge ?? 1;
  const maxEnergy = enemy?.maxEnergy ?? 7;
  const nextEnergy = Math.min(currentEnergy + energyCharge, maxEnergy);
  const currentBestEstimatedDamage = Math.max(
    0,
    ...usableMoveScores.map((candidate) => candidate.estimatedDamage),
  );
  const futureMoves = (allMoves ?? [])
    .filter((move) => move.cost > currentEnergy && move.cost <= nextEnergy)
    .filter((move) => isEnemyAiScoredMove(move, context.battleEffects))
    .map((move) => {
      const hitCheck = target ? canHitTarget(target, move) : { canHit: false };
      if (!hitCheck.canHit) return null;
      const futureEnemy = { ...enemy, energy: nextEnergy };
      return {
        move,
        estimatedDamage: estimateMoveDamage(
          futureEnemy,
          target,
          move,
          aiConfig,
          context.powerRules,
          context.targetFieldEffects,
        ),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.estimatedDamage - a.estimatedDamage);
  const futureBest = futureMoves[0] ?? null;
  const futureGain = futureBest
    ? futureBest.estimatedDamage - currentBestEstimatedDamage
    : 0;
  let score = futureBest ? futureGain - aiConfig.WAITING_PENALTY : -aiConfig.SAVE_BLOCK_PENALTY;
  let available = Boolean(futureBest);

  if (!futureBest || futureGain < aiConfig.MIN_FUTURE_GAIN) {
    score -= aiConfig.SAVE_BLOCK_PENALTY;
    available = false;
  }
  if (currentEnergy >= maxEnergy) {
    score -= aiConfig.SAVE_BLOCK_PENALTY;
    available = false;
  }
  if (target && currentBestEstimatedDamage >= target.hp * aiConfig.LOW_HP_DAMAGE_RATIO) {
    score -= aiConfig.WAITING_PENALTY;
  }

  return {
    type: "save_energy",
    score,
    available,
    currentEnergy,
    energyCharge,
    nextEnergy,
    currentBestEstimatedDamage,
    futureMoves,
    futureBest,
    futureGain,
  };
}

function compareEnemyKnockoutMoves(a, b) {
  if (a.move.cost !== b.move.cost) return a.move.cost - b.move.cost;
  if (a.estimatedDamage !== b.estimatedDamage) return b.estimatedDamage - a.estimatedDamage;
  return b.score - a.score;
}

function pickLegacyEnemyMove(usableMoves) {
  const attacks = usableMoves.filter((move) => move.category === "attack");
  const candidates = attacks.length ? attacks : usableMoves;
  return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
}

function pickEnemyAiCandidate(candidates, aiConfig = ENEMY_AI_CONFIG, random = Math.random) {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const best = sorted[0];
  const nearBestRange = Math.max(
    aiConfig.NEAR_BEST_MIN_RANGE,
    Math.abs(best.score) * aiConfig.NEAR_BEST_RANDOM_RANGE,
  );
  const nearBest = sorted.filter((candidate) => best.score - candidate.score <= nearBestRange);
  if (nearBest.length <= 1) return best;

  const floor = best.score - nearBestRange;
  const totalWeight = nearBest.reduce(
    (total, candidate) => total + Math.max(
      aiConfig.CANDIDATE_MIN_WEIGHT,
      candidate.score - floor + aiConfig.CANDIDATE_WEIGHT_OFFSET,
    ),
    0,
  );
  let roll = random() * totalWeight;
  for (const candidate of nearBest) {
    roll -= Math.max(
      aiConfig.CANDIDATE_MIN_WEIGHT,
      candidate.score - floor + aiConfig.CANDIDATE_WEIGHT_OFFSET,
    );
    if (roll <= 0) return candidate;
  }
  return best;
}

function debugEnemyAI(enemy, details) {
  if (!ENEMY_AI_CONFIG.DEBUG) return;
  const saveEnergy = details.saveEnergy;
  const usableLines = details.usableMoveScores.length
    ? details.usableMoveScores.map((candidate) => (
        `  ${candidate.move.skill_id} score=${Math.round(candidate.score)} estimatedDamage=${candidate.estimatedDamage}`
      ))
    : ["  none"];
  const futureLines = saveEnergy.futureMoves.length
    ? saveEnergy.futureMoves.map((candidate) => (
        `  ${candidate.move.skill_id} estimatedDamage=${candidate.estimatedDamage}`
      ))
    : ["  none"];
  console.debug([
    "[EnemyAI]",
    `enemy=${enemy?.id ?? ""}`,
    `currentEnergy=${saveEnergy.currentEnergy}`,
    `energyCharge=${saveEnergy.energyCharge}`,
    `nextEnergy=${saveEnergy.nextEnergy}`,
    "usableMoves:",
    ...usableLines,
    "futureMoves:",
    ...futureLines,
    `futureGain=${saveEnergy.futureGain}`,
    `saveEnergyScore=${Math.round(saveEnergy.score)}`,
    `selected=${details.selected}`,
    `reason=${details.reason}`,
  ].join("\n"));
}

function hasEnemyAiDelayedAttackBattleEffect(move, battleEffects) {
  return [
    [move?.battle_effect1, move?.battle_effect_chance1],
    [move?.battle_effect2, move?.battle_effect_chance2],
  ].some(([effectId, chance]) => (
    chance > 0 && battleEffects?.get(effectId)?.battle_effect_group === "delayed_attack"
  ));
}

function isEnemyAiDelayedAttackScoredMove(move, battleEffects) {
  return Boolean(
    move &&
      move.category === "attack" &&
      move.target !== "self" &&
      !twoTurnBattleEffectId(move) &&
      hasEnemyAiDelayedAttackBattleEffect(move, battleEffects)
  );
}

function isEnemyAiTwoTurnScoredMove(move, battleEffects) {
  return Boolean(
    move &&
      move.category === "attack" &&
      move.target !== "self" &&
      twoTurnBattleEffectId(move) &&
      !hasEnemyAiDelayedAttackBattleEffect(move, battleEffects)
  );
}

function enemyAiDelayedAttackBattleEffectPairs(move, battleEffects) {
  return enemyAiMoveBattleEffectPairs(move)
    .map((pair) => ({
      ...pair,
      battleEffect: battleEffects?.get(pair.effectId),
    }))
    .filter((pair) => pair.battleEffect?.battle_effect_group === "delayed_attack");
}

function enemyAiHasPendingDelayedAttack(delayedPairs, targetFieldEffects) {
  return delayedPairs.some((pair) => (
    (targetFieldEffects ?? []).some((effect) => (
      effect?.group === "delayed_attack" && effect.id === pair.effectId
    ))
  ));
}

function enemyAiIsDelayedAttackSetupOnly(move) {
  if (move?.category !== "attack") return true;
  if (typeof hasSetupOnlyDelayedAttackBattleEffect === "function") {
    return hasSetupOnlyDelayedAttackBattleEffect(move);
  }
  return false;
}

function enemyAiDelayedAttackMove(move, enemy, battleEffect) {
  const delayedMove = typeof delayedBattleEffectPayload === "function"
    ? delayedBattleEffectPayload(move, enemy, battleEffect)?.delayedMove
    : enemyAiDelayedAttackMoveFallback(move, battleEffect);
  if (!delayedMove) return null;

  return {
    skill_id: battleEffect.battle_effect_id,
    name: delayedMove.name || battleEffect.name,
    category: "attack",
    power: Math.max(1, Number(delayedMove.power) || 1),
    element: safeText(delayedMove.element, "none"),
    element2: safeText(delayedMove.element2, "none"),
    attack_type: safeText(delayedMove.attack_type, "special"),
    hit_type: safeText(delayedMove.hit_type, "sure_hit"),
    animation_id: safeText(delayedMove.animation_id),
    animation_duration_ms: Math.max(0, Number(delayedMove.animation_duration_ms) || 0),
    repeat_count: Math.max(0, Number(delayedMove.repeat_count) || 0),
    target: "enemy",
    cost: 0,
  };
}

function enemyAiDelayedAttackMoveFallback(move, battleEffect) {
  const fixedPower = battleEffect.damage_type === "fixed_power"
    ? Number(battleEffect.damage_value) || 0
    : 0;
  const ratePower = battleEffect.damage_type === "skill_power_rate"
    ? Math.round((Number(move.power) || 0) * ((Number(battleEffect.damage_value) || 100) / 100))
    : 0;
  return {
    name: move.name,
    power: Math.max(1, fixedPower || ratePower || Number(move.power) || 1),
    element: safeText(move.element, "none"),
    element2: safeText(move.element2, "none"),
    attack_type: safeText(move.attack_type, "special"),
    hit_type: safeText(move.hit_type, "sure_hit"),
    animation_id: safeText(move.animation_id),
    animation_duration_ms: Math.max(0, Number(move.animation_duration_ms) || 0),
    repeat_count: Math.max(0, Number(move.repeat_count) || 0),
  };
}

function enemyAiMoveEffectPairs(move) {
  return [
    { effectId: move?.effect1, chance: move?.effect_chance1, effectTarget: move?.effect_target1 },
    { effectId: move?.effect2, chance: move?.effect_chance2, effectTarget: move?.effect_target2 },
    { effectId: move?.effect3, chance: move?.effect_chance3, effectTarget: move?.effect_target3 },
  ].filter((pair) => pair.effectId && pair.effectId !== "none" && pair.chance > 0);
}

function enemyAiMoveBattleEffectPairs(move) {
  return [
    { effectId: move?.battle_effect1, chance: move?.battle_effect_chance1 },
    { effectId: move?.battle_effect2, chance: move?.battle_effect_chance2 },
  ].filter((pair) => pair.effectId && pair.effectId !== "none" && pair.chance > 0);
}

function enemyAiEffectTargetsSelf(move, effectTarget) {
  const normalizedTarget = safeText(effectTarget, "enemy").toLowerCase() === "self" ? "self" : "enemy";
  return normalizedTarget === "self" || safeText(move?.target, "enemy").toLowerCase() === "self";
}

function enemyAiEffectTargetsEnemy(move, effectTarget) {
  const normalizedTarget = safeText(effectTarget, "enemy").toLowerCase() === "self" ? "self" : "enemy";
  return normalizedTarget !== "self" && safeText(move?.target, "enemy").toLowerCase() !== "self";
}

function enemyAiChanceWeight(chance) {
  const value = Number(chance);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value)) / 100;
}

function enemyAiTypeMultiplier(aiConfig, key) {
  const value = Number(aiConfig?.[key]);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function enemyAiSelfBuffTypeMultiplier(stat, aiConfig) {
  let multiplier = enemyAiTypeMultiplier(aiConfig, "SELF_BUFF_SCORE_MULTIPLIER");
  if (stat === "phy_def" || stat === "sp_def") {
    multiplier *= enemyAiTypeMultiplier(aiConfig, "DEFENSE_BUFF_SCORE_MULTIPLIER");
  }
  return multiplier;
}

function enemyAiHpRatio(fighter) {
  return fighter?.maxHp > 0 ? Math.max(0, Math.min(1, fighter.hp / fighter.maxHp)) : 0;
}

function enemyAiBuffStackMultiplier(current, amount) {
  if (current >= amount * 2) return 0.2;
  if (current >= amount) return 0.55;
  return 1;
}

function enemyAiBuffStatWeight(stat) {
  return {
    phy_atk: 3,
    sp_atk: 3,
    speed: 2.4,
    phy_def: 2.2,
    sp_def: 2.2,
  }[stat] ?? 1;
}

function enemyAiHasActiveGuard(enemy, actorFieldEffects, battleEffectId) {
  const activeEffects = [
    ...(enemy?.battleEffects ?? []),
    ...(actorFieldEffects ?? []),
  ];
  return Boolean(
    activeEffects.some((effect) => effect.id === battleEffectId || effect.group === "guard")
  );
}

function enemyAiIsTargetStatusEffect(effect) {
  return effect?.effect_group === "control" || effect?.effect_group === "damage";
}

function enemyAiTargetHasEffect(target, effectId) {
  return Boolean(
    target?.statuses?.some((status) => status.id === effectId) ||
      target?.battleEffects?.some((effect) => effect.id === effectId)
  );
}

function enemyAiStatusEffectScore(effect, target, aiConfig) {
  const multiplier =
    enemyAiStatusEffectMultiplier(effect, aiConfig) *
    enemyAiTypeMultiplier(aiConfig, "STATUS_SCORE_MULTIPLIER");
  if (effect.effect_group === "control") {
    return enemyAiControlStatusScore(effect, target, aiConfig) * multiplier;
  }
  if (effect.effect_group === "damage") {
    return enemyAiDamageStatusScore(effect, target, aiConfig) * multiplier;
  }
  return 0;
}

function enemyAiStatusEffectMultiplier(effect, aiConfig) {
  const effectId = safeText(effect?.effect_id || effect?.battle_effect_id);
  return aiConfig.STATUS_EFFECT_SCORE_MULTIPLIERS?.[effectId] ?? 1;
}

function enemyAiControlStatusScore(effect, target, aiConfig) {
  const targetHpRatio = enemyAiHpRatio(target);
  const targetHpMultiplier = Math.max(aiConfig.STATUS_TARGET_HP_MIN_MULTIPLIER, targetHpRatio);
  const turns = Math.max(1, Math.floor(Number(effect.turn) || 1));
  return (
    (aiConfig.STATUS_CONTROL_BASE_SCORE + Math.min(4, turns) * aiConfig.STATUS_TURN_BONUS) *
      targetHpMultiplier
  );
}

function enemyAiDamageStatusScore(effect, target, aiConfig) {
  const targetHpRatio = enemyAiHpRatio(target);
  const targetHpMultiplier = Math.max(aiConfig.STATUS_TARGET_HP_MIN_MULTIPLIER, targetHpRatio);
  const turns = Math.max(1, Math.min(4, Math.floor(Number(effect.turn) || 1)));
  const damageValue = Math.max(0, Math.abs(Number(effect.damage_value) || 0));
  if (damageValue <= 0) return 0;

  const estimatedDamage = effect.damage_type === "percent_maxhp"
    ? (target?.maxHp ?? 0) * (damageValue / 100) * turns
    : damageValue * turns;
  return (
    aiConfig.STATUS_DAMAGE_BASE_SCORE *
      targetHpMultiplier +
    estimatedDamage * aiConfig.STATUS_DAMAGE_WEIGHT * targetHpRatio
  );
}

function enemyAiDebuffStackMultiplier(current, amount) {
  if (current <= -amount * 2) return 0.2;
  if (current <= -amount) return 0.55;
  return 1;
}

function enemyAiDebuffStatWeight(stat) {
  return {
    phy_def: 2.4,
    sp_def: 2.4,
    phy_atk: 2,
    sp_atk: 2,
    speed: 1.6,
  }[stat] ?? 1;
}

/* GO evaluates a projected board. The MHB evaluation settings and ranking are shared. */
const geneOrderAI = (() => {
  const CONFIG = {
    UNKNOWN_PRESSURE: 0.18, SURVIVAL_LOSS: 220, BODY_WEIGHT: 1, DECOY_WEIGHT: 0.58,
    RESPONSE_WEIGHT: 1.15, ENTRY_WEIGHT: 10, STAGE_WEIGHT: 13, EN_WEIGHT: 10,
    WAIT_BASE: 9, SWITCH_COST: 28, SWITCH_GAIN_WEIGHT: 0.65, SWITCH_RECENT_COST: 24,
    SUPPORT_RISK: 0.7, PROTECT_USE_WEIGHT: 0.52, KNOWN_PRESSURE_FLOOR: 0.4,
    FIELD_VALUE: 10, STATUS_HORIZON: 3, CAST_RISK: 0.65, PUBLIC_ATTACK_WEIGHT: 0.65,
    KO_THRESHOLD: 0.6, SWITCH_THREAT_WEIGHT: 0.65, REVIVE_VALUE: 13,
    UNKNOWN_EVASION_COVERAGE: 0.75, UNKNOWN_GUARD_COVERAGE: 0.35, UNKNOWN_GUARD_FLOOR: 0.2,
  };
  const COMMON_DODGE = "skill_000";
  const STATS = ["phy_atk", "phy_def", "sp_atk", "sp_def", "speed"];
  const otherSide = (side) => side === "player" ? "enemy" : "player";
  const identity = fighter => (fighter.base.character_id || fighter.base.name) + (fighter.transform ? "/" + fighter.transform.targetId : "");
  const fraction = (value) => Math.min(1, Math.max(0, value));
  const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

  function knownType(type) {
    return Object.hasOwn(ENEMY_AI_TYPE_CONFIGS, safeText(type, "balanced").toLowerCase());
  }

  function record(history, events) {
    for (const event of events) {
      if (!event.moveId || !["move", "charge"].includes(event.type)) continue;
      const side = history[event.side];
      const key = (event.characterId || event.actor) + (event.formId ? "/" + event.formId : "");
      if (!side.has(key)) side.set(key, new Set());
      side.get(key).add(event.moveId);
    }
  }

  function publicFighter(fighter, skillIds, own) {
    const { base } = fighter;
    const publicBase = Object.fromEntries(["character_id", "name", "element_1", "element_2", "energy_charge",
      "evasion_percent", "regen_value", ...STATS].map((key) => [key, base[key]]));
    if (own) Object.assign(publicBase, { ai_type: base.ai_type, ai_setup_skill: base.ai_setup_skill, ai_main_skill: base.ai_main_skill });
    publicBase.skillIds = fighter.transform && own ? [...base.skillIds] : skillIds;
    const { hp, maxHp, energy, fainted, dodgeActive, halfGuard, tookDirectDamage, pending, decoy } = fighter;
    const passiveEffects = fighter.passiveEffects.map((effect) => ({ ...effect, condition: effect.condition && { ...effect.condition } }));
    const profile = geneOrderBattle.battleBase(fighter);
    const transformation = fighter.transform && { ...fighter.transform,
      appearance: { character_id: fighter.transform.appearance.character_id, name: fighter.transform.appearance.name },
      originalStages: { ...fighter.transform.originalStages },
      base: { ...publicBase, ...Object.fromEntries([...STATS, "regen_value"].map(k => [k, profile[k]])), skillIds: [...skillIds] },
      passiveEffects: [...fighter.transform.passiveEffects] };
    return { base: publicBase, passive: fighter.passive, transform: transformation, currentElements: fighter.currentElements && [...fighter.currentElements], hp, maxHp, energy, fainted, dodgeActive, halfGuard, tookDirectDamage,
      stages: { ...fighter.stages }, pending: pending && { ...pending }, decoy: decoy && { ...decoy },
      statuses: fighter.statuses.map((status) => ({ ...status })), timedEffects: new Map(fighter.timedEffects),
      defenses: new Map(fighter.defenses), nextElementPower: new Map(fighter.nextElementPower), bind: null, passiveEffects,
      passiveState: geneOrderPassives.copyState(fighter), moveUses: own ? new Map(fighter.moveUses) : new Map() };
  }

  function observe(battle, side, { history, revealFixedMoves = false, previousSwitch = null } = {}) {
    const go = geneOrderBattle;
    const other = otherSide(side);
    const target = go.activeFighter(battle, other);
    const known = revealFixedMoves ? go.battleSkills(target) : history?.[other].get(identity(target));
    const seenMoves = [...new Set([...(known ?? []), target.pending?.moveId].filter(Boolean))];
    const own = battle.teams[side];
    const team = own.map((fighter) => publicFighter(fighter, go.battleSkills(fighter), true));
    const opponent = publicFighter(target, seenMoves, false);
    const copyBind = (original, snapshot) => {
      if (!original.bind) return;
      const { turns, definition, source } = original.bind;
      snapshot.bind = { turns, definition, source: source === target ? opponent : team[own.indexOf(source)] };
    };
    own.forEach((fighter, index) => copyBind(fighter, team[index]));
    copyBind(target, opponent);
    const moveIds = new Set([COMMON_DODGE, ...seenMoves, ...team.flatMap(fighter => [...go.battleSkills(fighter), ...fighter.base.skillIds]),
      ...team.map((fighter) => fighter.pending?.moveId)]);
    const skills = new Map();
    for (const id of moveIds) if (battle.skills.has(id)) skills.set(id, battle.skills.get(id));
    const ownSelection = battle.pendingSwitch?.side === side;
    return { side, opponentMovesComplete: revealFixedMoves, previousSwitch, turn: battle.turn, winner: battle.winner,
      active: { [side]: battle.active[side], [other]: 0 }, teams: { [side]: team, [other]: [opponent] },
      fields: { [side]: new Map(battle.fields[side]), [other]: new Map(battle.fields[other]), shared: new Map(battle.fields.shared ?? []) }, skills,
      effects: battle.effects, battleEffects: battle.battleEffects, powerRules: battle.powerRules, effectiveness: battle.effectiveness,
      pendingSwitch: ownSelection ? { side, reason: battle.pendingSwitch.reason, candidates: [...battle.pendingSwitch.candidates] } : null,
      awaitingOther: Boolean(battle.pendingSwitch && !ownSelection),
    };
  }

  function availableMoves(board, side, { future = false } = {}) {
    const go = geneOrderBattle;
    const fighter = go.activeFighter(board, side);
    if (fighter.fainted) return [];
    const ids = fighter.pending ? [fighter.pending.moveId] : [...new Set([...go.battleSkills(fighter), COMMON_DODGE])];
    return ids.map((id) => board.skills.get(id)).filter((move) => move &&
      (future ? !go.moveAvailability(move, board).issues.length :
        !go.checkAction(board, side, { type: "move", moveId: move.skill_id })));
  }

  function attackPressure(board, side) {
    const go = geneOrderBattle;
    const other = otherSide(side);
    const actor = go.activeFighter(board, side);
    if (actor.fainted) return [];
    return availableMoves(board, side).filter((move) => move.category === "attack").map((move) => ({
      move, preview: go.previewDamage(board, side, move),
    }));
  }

  function matchup(board, side, config) {
    const go = geneOrderBattle;
    const other = otherSide(side);
    const fighter = go.activeFighter(board, side);
    const target = go.activeFighter(board, other);
    const outgoing = attackPressure(board, side);
    const incoming = attackPressure(board, other);
    const estimate = ({ preview }) => (preview.actualDamage + (preview.decoyDamage ?? 0) * config.DECOY_WEIGHT) * preview.executionChance;
    const best = Math.max(0, ...outgoing.map(estimate));
    const predictedIncoming = Math.max(0, ...incoming.map(estimate));
    const unknown = !target.fainted && (!board.opponentMovesComplete && !target.pending)
      ? fighter.maxHp * config.UNKNOWN_PRESSURE * (incoming.length ? config.KNOWN_PRESSURE_FLOOR : 1) * (1 - go.actionFailureChance(target) / 100) : 0;
    const danger = Math.max(predictedIncoming, unknown);
    const rankValue = STATS.reduce((sum, stat) => sum + fighter.stages[stat], 0) * config.STAGE_WEIGHT / 3;
    const residual = [...fighter.statuses, fighter.bind].filter(Boolean).reduce((sum, status) =>
      sum + Math.min(config.STATUS_HORIZON, status.turns) * go.residualDamage(fighter, status.definition), 0) +
      [...go.fieldEffectsForSide(board, side).values()].filter(entry => go.activeTimed(entry, board.turn)).reduce((sum, entry) =>
        sum + Math.min(config.STATUS_HORIZON, entry.expires - board.turn) * go.residualDamage(fighter, entry.definition), 0);
    const recovery = go.previewTurnEndRecovery(fighter, Math.max(0, fighter.hp - predictedIncoming), { fields: go.fieldEffectsForSide(board, side).values(), turn: board.turn }).recovered;
    const revive = geneOrderPassives.survive(fighter, fighter.hp) ? config.REVIVE_VALUE : 0;
    const speed = go.effectiveSpeed(board, side);
    const otherSpeed = go.effectiveSpeed(board, other);
    const score = best * config.SWITCH_OFFENSE_WEIGHT - danger * config.SWITCH_INCOMING_DAMAGE_WEIGHT
      - danger / Math.max(1, fighter.hp) * config.SWITCH_INCOMING_HP_RATIO_WEIGHT
      + fighter.hp / fighter.maxHp * config.SWITCH_HP_RATIO_WEIGHT + fighter.energy * config.EN_WEIGHT / 4
      + go.evasionRate(fighter, board.turn) / 100 * config.FIELD_VALUE + rankValue + revive
      - residual * config.SWITCH_THREAT_WEIGHT + recovery * config.HEAL_BASE_WEIGHT + (fighter.decoy?.hp ?? 0) * config.DECOY_WEIGHT
      + (speed > otherSpeed ? config.FIELD_VALUE : 0);
    return { best, incoming, danger, score, speed, otherSpeed,
      attacks: new Map(outgoing.map(({ move, preview }) => [move.skill_id, preview])) };
  }

  function moveRisk(context, move) {
    const { actor, target, position, config, board } = context;
    const ownPriority = geneOrderBattle.effectivePriority(board, context.side, move);
    const sooner = (priority) => ownPriority > priority ? 0 : ownPriority < priority ? 1 :
      position.speed > position.otherSpeed ? 0 : position.speed < position.otherSpeed ? 1 : 0.5;
    const known = position.incoming.map(({ move: incoming, preview }) =>
      sooner(geneOrderBattle.effectivePriority(board, otherSide(context.side), incoming)) * preview.executionChance * (preview.targetHp === 0 ? 1 : fraction(preview.actualDamage / actor.hp) * config.SUPPORT_RISK));
    const unknown = board.opponentMovesComplete || target.pending ? 0 : sooner(0) * fraction(position.danger / actor.hp);
    return fraction(Math.max(average(known) * config.PUBLIC_ATTACK_WEIGHT, unknown));
  }

  function nextPowerValue(board, side, actor, effect, config) {
    const go = geneOrderBattle;
    if (effect.modifier <= (actor.nextElementPower.get(effect.element)?.modifier ?? 1)) return 0;
    const index = board.active[side];
    const team = board.teams[side].slice();
    const nextElementPower = new Map(actor.nextElementPower).set(effect.element, effect);
    team[index] = { ...actor, nextElementPower };
    const projected = { ...board, teams: { ...board.teams, [side]: team } };
    const damage = (state, move) => {
      const start = go.previewDamage(state, side, move);
      const release = go.previewRelease(state, side, move, start);
      const result = release ?? start;
      return (result.actualDamage + (result.decoyDamage ?? 0) * config.DECOY_WEIGHT) *
        (release ? config.TWO_TURN_DAMAGE_MULTIPLIER : 1) * start.executionChance;
    };
    const attacks = availableMoves(board, side, { future: true })
      .filter((move) => move.category === "attack" && go.moveHasElement(move, effect.element));
    return Math.max(0, ...attacks.map((move) => damage(projected, move) - damage(board, move)));
  }

  function statusModifierValue(fighter, opponent, effect, config) {
    const go = geneOrderBattle;
    const statuses = fighter.statuses.filter(status => status.definition.effect_id !== effect.effect_id);
    const before = { ...fighter, statuses };
    const after = { ...fighter, statuses: [...statuses, { definition: effect, turns: effect.turn }] };
    const stat = effect.stat_modifier_target;
    const statValue = STATS.includes(stat) ? (go.statValue(before, stat, { opponent }) - go.statValue(after, stat, { opponent })) /
      Math.max(1, go.statValue(before, stat, { opponent })) * config.FIELD_VALUE * enemyAiDebuffStatWeight(stat) : 0;
    const failureValue = (go.actionFailureChance(after) - go.actionFailureChance(before)) / 100 * config.FIELD_VALUE;
    return statValue + failureValue;
  }

  // Evaluate setup through the same pure damage preview as actual attacks.
  function fieldAttackGain(board, side, projected, signed = false) {
    const go = geneOrderBattle;
    const moves = availableMoves(board, side, { future: true }).filter(move => move.category === "attack").map(move => {
      const damage = state => {
        const start = go.previewDamage(state, side, move);
        const result = go.previewRelease(state, side, move, start) ?? start;
        return (result.actualDamage + (result.decoyDamage ?? 0)) * start.executionChance;
      };
      return { before: damage(board), after: damage(projected) };
    });
    return signed ? Math.max(0, ...moves.map(m => m.after)) - Math.max(0, ...moves.map(m => m.before))
      : Math.max(0, ...moves.map(m => m.after - m.before));
  }

  function supportScore(context, move, result, release) {
    const { board, side, actor, target, position, config } = context;
    const go = geneOrderBattle;
    const other = otherSide(side);
    const statusBlock = geneOrderPassives.statusMoveBlock(target, actor, move);
    const positionBlock = target.pending?.definition.battle_effect_group === "position" &&
      move.hit_type !== target.pending.definition.weak_hit_type;
    const already = (map, id) => {
      const timed = map.get(id);
      return timed && (go.activeTimed(timed, board.turn) || timed.starts > board.turn);
    };
    const stageValue = (fighter, stat, delta) => go.stageDelta(fighter, stat, delta) * config.STAGE_WEIGHT;
    const protection = (effect, kind) => {
      const incoming = position.incoming;
      const matches = ({ move: enemyMove }) => kind === "guard" || kind === "revenge" ||
        (kind === "absorb" && go.moveHasElement(enemyMove, effect.element)) || go.guardApplies(effect, enemyMove);
      const applicable = incoming.length ? average(incoming.map((entry) => Number(matches(entry)))) :
        board.opponentMovesComplete ? 0 : kind === "guard" || kind === "revenge" ? 1 : config.UNKNOWN_GUARD_COVERAGE;
      const mix = board.opponentMovesComplete ? applicable : Math.max(config.UNKNOWN_GUARD_FLOOR, applicable);
      const cut = kind === "reflection" || kind === "absorb" ? 1 :
        kind === "revenge" ? effect.damage_value / 100 * config.SUPPORT_RISK : effect.damage_cut / 100;
      const urgency = config.PROTECT_BASE_WEIGHT + (1 - actor.hp / actor.maxHp) * config.PROTECT_MISSING_HP_WEIGHT;
      return position.danger * cut * mix * urgency * config.PROTECT_USE_WEIGHT *
        enemyAiTypeMultiplier(config, "PROTECT_SCORE_MULTIPLIER");
    };

    let score = 0;
    for (const { id, chance, target: destination, table } of go.moveEffectsWithPassive(actor, move)) {
      if (!(chance > 0)) continue;
      const effect = board[table].get(id);
      const kind = table === "effects" ? go.effectKind(effect) : go.battleEffectKind(effect);
      const shared = go.isFieldKind(kind) && go.fieldDestination(effect) === "both";
      const self = shared || (go.isFieldKind(kind) ? go.fieldDestination(effect) : destination) === "self";
      if (self && actor.pending) continue;
      if (!self && (target.fainted || (move.category === "attack" && (release ?? result).reason !== "hit"))) continue;
      const recipient = self ? actor : target;
      if (!self && move.category === "status" && (positionBlock || (statusBlock && kind !== "clear-field" && !go.isFieldKind(kind)))) continue;
      let value = 0;
      if (kind === "transform") {
        const transformation = result.transformation;
        if (transformation?.success) {
          const team = board.teams[side].slice();
          team[board.active[side]] = { ...transformation.fighter, hp: result.actorHp, energy: Math.max(0, actor.energy - result.energyCost) };
          const projected = { ...board, teams: { ...board.teams, [side]: team } };
          value = matchup(projected, side, config).score - position.score;
        } else value = -config.FIELD_VALUE;
      } else if (kind === "stage") {
        if (self || !geneOrderPassives.blocksStage(recipient, effect.target_stat, effect.damage_value, actor)) {
          value = stageValue(recipient, effect.target_stat, effect.damage_value) * (self ?
            enemyAiSelfBuffTypeMultiplier(effect.target_stat, config) : -enemyAiTypeMultiplier(config, "DEBUFF_SCORE_MULTIPLIER"));
        }
      } else if (kind === "next-element-power") {
        value = nextPowerValue(board, side, actor, effect, config);
      } else if (kind === "recover-en") {
        const payment = go.effectiveMoveCost(actor, move, board.turn);
        const gap = go.MAX_ENERGY - recipient.energy + (self ? payment - go.effectiveEnergyCharge(actor, board.turn) : 0);
        value = (effect.damage_value < 0 ? -Math.min(-effect.damage_value, recipient.energy) : Math.min(effect.damage_value, Math.max(0, gap))) * config.EN_WEIGHT * (self ? 1 : -1);
      } else if (kind === "en-drain") {
        const lost = Math.min(effect.damage_value, recipient.energy);
        value = self ? 0 : (lost + Math.min(lost, Math.max(0, go.MAX_ENERGY - actor.energy + go.effectiveMoveCost(actor, move, board.turn)))) * config.EN_WEIGHT;
      } else if (kind === "en-charge-modifier" || kind === "en-cost-modifier") {
        const projected = { ...recipient, timedEffects: new Map(recipient.timedEffects) };
        projected.timedEffects.set(id, { definition: effect, starts: board.turn, expires: board.turn + effect.turn });
        const old = recipient.timedEffects.get(id);
        const remaining = old ? Math.max(0, old.expires - board.turn) : 0;
        const horizon = Math.min(effect.turn, config.STATUS_HORIZON);
        if (kind === "en-charge-modifier") {
          const change = go.effectiveEnergyCharge(recipient, board.turn) - go.effectiveEnergyCharge(projected, board.turn);
          const restored = old ? go.effectiveEnergyCharge({ ...recipient, timedEffects: new Map([...recipient.timedEffects].filter(([key]) => key !== id)) }, board.turn) - go.effectiveEnergyCharge(projected, board.turn) : 0;
          value = (change * horizon + restored * Math.max(0, horizon - remaining)) * config.EN_WEIGHT * (self ? -1 : 1);
        } else {
          value = effect.damage_value * Math.max(0, horizon - Math.min(horizon, remaining)) * config.EN_WEIGHT * (self ? -1 : 1);
        }
      } else if (["status-damage", "status", "bind-damage"].includes(kind)) {
        if (kind !== "bind-damage" && geneOrderPassives.statusBlock(recipient,id)) continue;
        const current = kind === "bind-damage" ? recipient.bind :
          (!self && id === "sleep" && result.wakesTarget) ? null : recipient.statuses.find((status) => status.definition.effect_id === id);
        const turns = Math.max(0, Math.min(effect.turn - (current?.turns ?? 0), config.STATUS_HORIZON));
        const metabolism = geneOrderPassives.matching(recipient, "stat-multiplier", (entry) => entry.condition?.kind === "status").length;
        const damage = Math.min(recipient.hp, go.residualDamage(recipient, effect) * turns);
        const modifierValue = kind === "bind-damage" ? 0 : statusModifierValue(recipient, self ? target : actor, effect, config) * turns;
        value = (damage * config.STATUS_DAMAGE_WEIGHT + modifierValue + (kind === "bind-damage" && !current ? config.FIELD_VALUE : 0)
          - (kind !== "bind-damage" && !current ? metabolism * config.FIELD_VALUE / 2 : 0)) *
          enemyAiTypeMultiplier(config, "STATUS_SCORE_MULTIPLIER") * (self ? -1 : 1);
      } else if (["guard", "absorb", "reflection", "revenge", "field-guard"].includes(kind)) {
        if (kind === "revenge" && go.moveEffects(move).some((slot) => go.battleEffectKind(board.battleEffects.get(slot.id)) === "reflection")) continue;
        if (!already(kind === "field-guard" ? board.fields[side] : actor.defenses, id)) value = protection(effect, kind);
      } else if (kind === "dodge") {
        if (!actor.dodgeActive) {
          const known = position.incoming;
          const evadable = known.length ? average(known.map(({ move: incoming }) => Number(incoming.hit_type !== "ignore_dodge"))) : config.UNKNOWN_EVASION_COVERAGE;
          const success = go.evasionRate(actor, board.turn) / 100;
          value = position.danger * evadable * success * config.PROTECT_USE_WEIGHT *
            enemyAiTypeMultiplier(config, "PROTECT_SCORE_MULTIPLIER");
          value += geneOrderPassives.matching(actor, "dodge-action").reduce((sum, entry) =>
            sum + stageValue(actor, entry.stat, entry.value), 0);
          value += geneOrderPassives.matching(actor, "evaded").reduce((sum, entry) =>
            sum + stageValue(actor, entry.stat, entry.value), 0) * success * evadable * config.SUPPORT_RISK;
        }
      } else if (kind === "evasion-boost" && !already(actor.timedEffects, id)) {
        value = go.evasionRate(actor, board.turn) / 100 * (effect.damage_value - 1) * config.FIELD_VALUE;
      } else if (kind === "field-element-power" && !already(go.fieldEffectsForSide(board, self ? side : other), id)) {
        const recipientSide = self ? side : other;
        const fieldSide = shared ? "shared" : recipientSide;
        const fields = new Map(board.fields[fieldSide]);
        fields.set(id, { id, definition: effect, starts: board.turn, expires: board.turn + effect.turn });
        const projected = { ...board, fields: { ...board.fields, [fieldSide]: fields } };
        value = shared ? fieldAttackGain(board, side, projected) - fieldAttackGain(board, other, projected)
          : fieldAttackGain(board, recipientSide, projected) * (self ? 1 : -1);
      } else if (kind === "field-periodic-damage") {
        const old = board.fields[self ? side : other].get(id);
        const addedTurns = Math.max(0, Math.min(effect.turn, config.STATUS_HORIZON) - Math.max(0, (old?.expires ?? board.turn) - board.turn));
        value = go.residualDamage(recipient, effect) * addedTurns * config.STATUS_DAMAGE_WEIGHT * (self ? -1 : 1);
      } else if (kind === "element-resistance-down") {
        const existing = [...recipient.timedEffects.values()].find(e => go.effectKind(e.definition) === kind && e.definition.element === effect.element && go.activeTimed(e, board.turn));
        if (!existing) {
          const timedEffects = new Map(recipient.timedEffects);
          timedEffects.set(id, { id, definition: effect, starts: board.turn, expires: board.turn + effect.turn });
          const recipientSide = self ? side : other;
          const team = board.teams[recipientSide].slice();
          team[board.active[recipientSide]] = { ...recipient, timedEffects };
          value = fieldAttackGain(board, self ? other : side, { ...board, teams: { ...board.teams, [recipientSide]: team } }) * (self ? -1 : 1);
        }
      } else if (kind === "clear-field") {
        value = [...board.fields[self ? side : other].values()].filter(e => go.fieldClearable(e.definition) && go.activeTimed(e, board.turn))
          .reduce((sum, e) => sum + (go.battleEffectKind(e.definition) === "field-periodic-damage" ? -1 : 1) * config.FIELD_VALUE * (self ? -1 : 1), 0);
        if (board.fields.shared?.size) {
          const shared = new Map([...board.fields.shared].filter(([, entry]) => !go.fieldClearable(entry.definition)));
          const projected = { ...board, fields: { ...board.fields, shared } };
          value += fieldAttackGain(board, side, projected, true) - fieldAttackGain(board, other, projected, true);
        }
      } else if (kind === "field-speed" && !already(board.fields[side], id)) {
        value = (position.speed <= position.otherSpeed ? config.FIELD_VALUE : config.FIELD_VALUE / 3) * effect.damage_value * (self ? 1 : -1);
      } else if (kind === "clear-buff") {
        value = STATS.reduce((sum, stat) => sum + Math.max(0, target.stages[stat]) * config.STAGE_WEIGHT / 2, 0);
      } else if (kind === "decoy" || kind === "tail-purge") {
        const decoy = go.decoyValues(actor, effect);
        value = Math.min(decoy.maxHp, position.danger * config.STATUS_HORIZON) * config.DECOY_WEIGHT - decoy.cost * config.SUPPORT_RISK;
      }
      score += value * chance / 100;
    }

    if (!actor.pending) for (const effect of geneOrderPassives.useStageEffects(actor, move)) {
      score += stageValue(actor, effect.stat, effect.value);
    }
    return score;
  }

  function rankSwitches(context, reason, indices, decoy) {
    const { board, side, actor, position, config } = context;
    const go = geneOrderBattle;
    return indices.map((index) => {
      const projected = go.previewSwitch(board, side, index, reason, decoy);
      const incoming = go.activeFighter(projected, side);
      const next = matchup(projected, side, config);
      const opponent = go.activeFighter(board, otherSide(side));
      const projectedOpponent = go.activeFighter(projected, otherSide(side));
      const entry = STATS.reduce((sum, stat) => sum + opponent.stages[stat] - projectedOpponent.stages[stat], 0)
        * config.ENTRY_WEIGHT;
      const recent = board.previousSwitch?.turn === board.turn - 1 ? config.SWITCH_RECENT_COST : 0;
      const risk = reason === "normal" ? next.danger * config.SWITCH_THREAT_WEIGHT : 0;
      const score = (next.score + entry - position.score) * config.SWITCH_GAIN_WEIGHT *
        enemyAiTypeMultiplier(config, "SWITCH_MATCHUP_ADVANTAGE_MULTIPLIER") - risk - recent -
        (reason === "normal" ? config.SWITCH_COST : 0);
      return { action: { type: "switch", index }, score, label: incoming.base.name,
        reason: reason + "：交代後の攻守・HP/EN・登場効果" };
    }).sort((a, b) => b.score - a.score);
  }

  function elementChangeDefense(context, move, result) {
    if (result.transformation?.success || !result.elementChange || result.executionChance === 0 || result.reason === "charging") return [];
    const { board, side, actor, position } = context, go = geneOrderBattle;
    const team = board.teams[side].slice();
    team[board.active[side]] = { ...actor, currentElements: [...result.actorElementsAfter], hp: result.actorHp };
    const projected = { ...board, teams: { ...board.teams, [side]: team } };
    const own = go.effectivePriority(board, side, move);
    return position.incoming.map(({ move: incoming, preview }) => {
      const enemy = go.effectivePriority(board, otherSide(side), incoming);
      const before = own > enemy ? 1 : own < enemy ? 0 : position.speed > position.otherSpeed ? 1 : position.speed < position.otherSpeed ? 0 : 0.5;
      return { moveId: incoming.skill_id, before: preview.actualDamage,
        after: go.previewDamage(projected, otherSide(side), incoming).actualDamage, weight: before * result.executionChance };
    });
  }

  function scoreMove(context, move) {
    const { board, side, actor, target, config, position } = context;
    const go = geneOrderBattle;
    const action = { type: "move", moveId: move.skill_id };
    const result = position.attacks.get(move.skill_id) ?? go.previewDamage(board, side, move);
    const release = go.previewRelease(board, side, move, result);
    const forecast = release ?? result;
    const typeDefense = elementChangeDefense(context, move, result);
    const typeDefenseGain = typeDefense.length ? typeDefense.reduce((sum, entry) => sum + (entry.before - entry.after) * entry.weight, 0) / typeDefense.length : 0;
    const risk = moveRisk(context, move);
    const cost = go.effectiveMoveCost(actor, move, board.turn);
    const damage = forecast.actualDamage * config.BODY_WEIGHT + (forecast.decoyDamage ?? 0) * config.DECOY_WEIGHT;
    const targetHp = forecast.targetHp;
    const endsKo = move.category === "attack" && !release && target.hp > 0 && targetHp === 0 && forecast.actorHp > 0;
    const koConfidence = endsKo ? (1 - risk) * (target.pending ? 1 : config.PUBLIC_ATTACK_WEIGHT) : 0;
    const healing = result.lifestealHeal + result.hpEffects.reduce((sum, effect) => sum +
      (effect.target === "self" ? 1 : -1) * effect.delta * effect.chance / 100, 0);
    const healWeight = config.HEAL_BASE_WEIGHT + (1 - actor.hp / actor.maxHp) * config.HEAL_MISSING_HP_WEIGHT;
    const survivingSide = (candidate, hp) => hp > 0 || board.teams[candidate].some((fighter, index) =>
      index !== board.active[candidate] && !fighter.fainted && fighter.hp > 0);
    const recoveryAllowed = survivingSide(side, forecast.actorHp) && survivingSide(otherSide(side), forecast.targetHp);
    const actorEnd = recoveryAllowed ? go.previewTurnEndRecovery(actor, forecast.actorHp, { fields: go.fieldEffectsForSide(board, side).values(), turn: board.turn }) : { hp: forecast.actorHp, recovered: 0 };
    const targetEnd = recoveryAllowed ? go.previewTurnEndRecovery(target, forecast.targetHp, { fields: go.fieldEffectsForSide(board, otherSide(side)).values(), turn: board.turn }) : { hp: forecast.targetHp, recovered: 0 };
    const recoveryValue = actorEnd.recovered * healWeight * enemyAiTypeMultiplier(config, "HEAL_SCORE_MULTIPLIER")
      - targetEnd.recovered * config.BODY_WEIGHT;
    const toxic = result.actualDamage > 0 && result.targetHp > 0
      ? geneOrderPassives.matching(target, "body-hit-status", (effect) => effect.condition.attackType === move.attack_type)
        .reduce((sum, effect) => {
          const status = board.effects.get(effect.statusId);
          const existing = actor.statuses.find(({ definition }) => definition.effect_id === effect.statusId);
          const added = status ? Math.max(0, Math.min(status.turn - (existing?.turns ?? 0), config.STATUS_HORIZON)) : 0;
          return added ? sum + go.residualDamage(actor, status) * added * effect.value : sum;
        }, 0) : 0;
    const response = result.responseDamage + result.actualHeal;
    let score = damage * enemyAiTypeMultiplier(config, "ATTACK_SCORE_MULTIPLIER") * (1 - risk)
      + (result.survival ? config.REVIVE_VALUE : 0) + koConfidence * config.KO_BONUS
      + healing * (healing > 0 ? healWeight * enemyAiTypeMultiplier(config, "HEAL_SCORE_MULTIPLIER") : config.RESPONSE_WEIGHT) + recoveryValue
      - response * config.RESPONSE_WEIGHT - result.hpCost - toxic * config.STATUS_DAMAGE_WEIGHT
      - cost * config.ENERGY_COST_PENALTY;
    if (endsKo) score += Math.min(go.MAX_ENERGY - actor.energy + cost,
      geneOrderPassives.matching(actor,"on-ko").reduce((n,e)=>n+e.value,0)) * config.EN_WEIGHT;
    if (cost > 0 && actor.energy - cost <= 0) score -= config.EMPTY_ENERGY_PENALTY;
    score += supportScore(context, move, result, release) * (1 - risk) + typeDefenseGain * config.SUPPORT_RISK;
    if (release) {
      const positionMove = go.moveEffects(move).some(({ id }) => go.battleEffectKind(board.battleEffects.get(id)) === "position");
      const safe = positionMove && !position.incoming.some(({ move: enemyMove }) => enemyMove.hit_type === "sure_hit");
      score = score * config.TWO_TURN_DAMAGE_MULTIPLIER - (safe ? 0 : position.danger * config.CAST_RISK);
    }
    for (const { id, chance, table } of go.moveEffectsWithPassive(actor, move)) {
      if (table !== "battleEffects" || chance <= 0 || result.actorHp <= 0) continue;
      const effect = board.battleEffects.get(id);
      const kind = go.battleEffectKind(effect);
      if (!["tail-purge", "relay", "post-attack"].includes(kind)) continue;
      if (kind === "post-attack" && !go.postMoveSwitchApplies(move, result.actualDamage, result.decoyDamage ?? 0)) continue;
      const indices = go.switchTargets(board, side);
      if (!indices.length) continue;
      const decoy = kind === "tail-purge" ? go.decoyValues(actor, effect) : null;
      const ranked = rankSwitches(context, kind, indices, decoy && { hp: decoy.maxHp, maxHp: decoy.maxHp });
      score += ranked[0].score * chance / 100;
    }
    const executionChance = result.executionChance;
    const fatal = result.actorHp <= 0 && executionChance > 0;
    if (fatal) score -= config.SURVIVAL_LOSS;
    score = score * executionChance + recoveryValue * (1 - executionChance);
    return { action, move, score, fatal, koConfidence: koConfidence * executionChance,
      damage: result.actualDamage, expectedDamage: result.actualDamage * executionChance, decoyDamage: result.decoyDamage ?? 0,
      label: move.name, reason: release ? "予約威力・次の攻撃" : result.reason, forecast: {
        transformation: result.transformation && { success: result.transformation.success, reason: result.transformation.reason, chance: result.transformation.chance },
        priority: result.priority, elementChangeDefense: typeDefense, actorElementsAfter: forecast.actorElementsAfter, targetHp, actorHp: result.actorHp, hpCost: result.hpCost, energyCost: result.energyCost, response: result.responseDamage, power: result.power,
        executionChance, actionFailureChance: result.actionFailureChance, wakesTarget: result.wakesTarget,
        targetActionFailureChanceAfterDamage: result.targetActionFailureChanceAfterDamage, expectedDamage: result.actualDamage * executionChance,
        actorEndHp: actorEnd.hp, targetEndHp: targetEnd.hp,
        actorNaturalRecovery: actorEnd.recovered, targetNaturalRecovery: targetEnd.recovered,
      } };
  }

  function evaluate(board) {
    if (board.winner || board.awaitingOther) return [];
    const go = geneOrderBattle;
    const side = board.side;
    const actor = go.activeFighter(board, side);
    const target = go.activeFighter(board, otherSide(side));
    const config = { ...enemyAiConfigFor(actor), ...CONFIG };
    const position = matchup(board.pendingSwitch ? { ...board, pendingSwitch: null } : board, side, config);
    const ctx = { board, side, actor, target, config, position };
    if (board.pendingSwitch) return rankSwitches(ctx, board.pendingSwitch.reason, board.pendingSwitch.candidates);
    const moves = availableMoves(board, side);
    const allMoves = availableMoves(board, side, { future: true });
    const validPreference = (id) => moves.some((move) => move.skill_id === id) ? id : "";
    const preferences = { turn: board.turn, allMoves,
      aiSetupSkill: validPreference(actor.base.ai_setup_skill), aiMainSkill: validPreference(actor.base.ai_main_skill) };
    const candidates = moves.map((move) => applyEnemySkillPreference(scoreMove(ctx, move), preferences, actor, config));
    if (actor.pending) return candidates;
    const indices = go.switchTargets(board, side).filter((index) => !go.checkAction(board, side, { type: "switch", index }));
    candidates.push(...rankSwitches(ctx, "normal", indices));
    if (!go.checkAction(board, side, { type: "wait" })) {
      const nextEN = Math.min(go.MAX_ENERGY, actor.energy + go.effectiveEnergyCharge(actor, board.turn));
      const index = board.active[side];
      const team = board.teams[side].slice();
      team[index] = { ...actor, energy: nextEN };
      const next = { ...board, turn: board.turn + 1, teams: { ...board.teams, [side]: team } };
      const future = allMoves.filter((move) => move.category === "attack" && go.effectiveMoveCost(actor, move, board.turn) > actor.energy && go.effectiveMoveCost(actor, move, board.turn + 1) <= nextEN)
        .map((move) => go.previewDamage(next, side, move)).filter((result) => result.actorHp > 0);
      const gain = Math.max(0, ...future.map((result) => result.actualDamage)) - position.best;
      const upkeep = geneOrderPassives.matching(actor, "turn-end").reduce((sum, effect) =>
        sum + go.stageDelta(actor, effect.stat, effect.value), 0);
      const score = (nextEN > actor.energy ? config.WAIT_BASE : -config.WAITING_PENALTY) +
        (gain >= config.MIN_FUTURE_GAIN ? Math.max(0, gain - config.WAITING_PENALTY) : 0) +
        upkeep * config.STAGE_WEIGHT / 3 - position.danger * config.SUPPORT_RISK +
        go.previewTurnEndRecovery(actor, actor.hp, { fields: go.fieldEffectsForSide(board, side).values(), turn: board.turn }).recovered * (config.HEAL_BASE_WEIGHT +
          (1 - actor.hp / actor.maxHp) * config.HEAL_MISSING_HP_WEIGHT) * enemyAiTypeMultiplier(config, "HEAL_SCORE_MULTIPLIER");
      candidates.push({ action: { type: "wait" }, score, label: "待機", reason: gain > 0 ? "EN温存" : "行動保留" });
    }
    return candidates;
  }

  function choose(board, { random = Math.random } = {}) {
    const candidates = evaluate(board);
    if (!candidates.length) return { action: null, candidates, type: enemyAiTypeFor(geneOrderBattle.activeFighter(board, board.side)) };
    const actor = geneOrderBattle.activeFighter(board, board.side);
    const safe = candidates.filter((candidate) => !candidate.fatal);
    const pool = safe.length ? safe : candidates;
    const knockout = pool.filter((candidate) => candidate.koConfidence >= CONFIG.KO_THRESHOLD);
    const selected = knockout.length
      ? [...knockout].sort((a, b) => b.koConfidence - a.koConfidence || compareEnemyKnockoutMoves(
        { ...a, estimatedDamage: a.damage }, { ...b, estimatedDamage: b.damage }) || b.score - a.score)[0]
      : pickEnemyAiCandidate(pool, enemyAiConfigFor(actor), random);
    return { action: selected.action, selected, type: enemyAiTypeFor(actor), candidates };
  }

  return { observe, evaluate, choose, record, knownType };
})();
