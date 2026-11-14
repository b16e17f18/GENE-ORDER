const GO_EFFECT_ALIASES = new Map([
  "pa_down1", "pa_up1", "pa_up2", "pd_down1", "pd_up1", "sa_down4", "sa_down1", "sa_up1", "sa_up2",
  "sd_down1", "sd_up2", "sp_up1", "sp_down2", "heal_half", "drain_50", "heal_en",
].map((id) => [id, `bf_${id}`]));
const GO_BATTLE_EFFECT_ALIASES = new Map([
  ["dodge_guard", "bf_dodge_guard"], ["protect", "bf_half_guard"],
  ["shed_tail", "bf_shed_tail"], ["water_absorb_guard", "bf_water_absorb_guard"],
  ["water_super_effective", "bf_water_super_effective"], ["next_fire_power_150", "bf_next_fire_power_150"],
]);

function canonicalizeGeneOrderSkill(row) {
  const skill = { ...row };
  for (const slot of [1, 2, 3]) {
    const field = `effect${slot}`;
    skill[field] = GO_EFFECT_ALIASES.get(row[field]) ?? row[field];
  }
  for (const slot of [1, 2]) {
    const field = `battle_effect${slot}`;
    skill[field] = GO_BATTLE_EFFECT_ALIASES.get(row[field]) ?? row[field];
  }
  if (row.power_rule === "hp_exact_1") skill.power_rule = "bf_hp_exact_1";
  return skill;
}

const GO_DATA_IDS = {
  characters: "character_id", passives: "passive_id", skills: "skill_id",
  effects: "effect_id", battleEffects: "battle_effect_id", powerRules: "power_rule_id",
  elements: "element_id", effectiveness: "attack_element", species: "species_id",
};

const GO_REQUIRED_COLUMNS = {
  characters: ["name", "element_1", "element_2", "species_id", "evasion_percent", "image", "passive_id",
    "hp", "phy_atk", "phy_def", "sp_atk", "sp_def", "speed", "regen_value", "cost_charge", "slot",
    "skill_1", "skill_2", "skill_3", "skill_4"],
  passives: ["name", "text", ...[1, 2, 3].flatMap((slot) => (
    [`passive_type${slot}`, `target_id${slot}`, `value${slot}`, `trigger_text${slot}`]
  ))],
  skills: ["name", "category", "element", "element2", "power", "cost", "priority", "power_rule",
    ...[1, 2, 3].flatMap((slot) => [`effect${slot}`, `effect_target${slot}`, `effect_chance${slot}`]),
    ...[1, 2].flatMap((slot) => [`battle_effect${slot}`, `battle_effect_chance${slot}`])],
  effects: ["name", "effect_group", "damage_type", "damage_value", "turn", "target_stat"],
  battleEffects: ["name", "battle_effect_group", "damage_value", "turn", "damage_cut"],
  powerRules: ["power_rule_group", "power_multiplier", "min_ratio", "max_ratio"],
  elements: ["name"],
  effectiveness: ["defense_element", "multiplier"],
  species: ["name"],
};

function masterIdLookup(rows, idColumn) {
  const lookup = new Map();
  for (const row of rows) {
    const id = row[idColumn];
    if (!id) continue;
    lookup.set(id, id);
    if (row.name) lookup.set(row.name, id);
  }
  return lookup;
}

function characterImagePath(imageName) {
  const name = imageName?.trim();
  if (!name || name === "none" || /[\\/]/.test(name) || name === "." || name === "..") return "";
  return `./asset/${encodeURIComponent(/\.[a-z0-9]+$/i.test(name) ? name : name + ".png")}`;
}

function validateGeneOrderData(tables, imageExists) {
  const diagnostics = [];
  const add = (level, table, id, field, value = "") => diagnostics.push({ level, table, id, field, value });
  const ids = {};
  for (const [table, rows] of Object.entries(tables)) {
    if (table === "effectiveness") continue;
    ids[table] = new Map();
    for (const row of rows) {
      const field = GO_DATA_IDS[table];
      const id = row[field];
      if (!id) add("ID未設定", table, "(IDなし)", field);
      else if (ids[table].has(id)) add("重複ID", table, id, field);
      else ids[table].set(id, row);
    }
  }

  const placeholders = {
    characters: (row) => !row.name,
    skills: (row) => !row.name && !row.category,
    passives: (row) => !row.name && !row.text,
  };
  const isSet = (value) => Boolean(value && value !== "none");
  const known = (rows, key) => new Set(rows.map((row) => row[key]).filter(Boolean));
  const elements = known(tables.elements, "element_id");
  const elementNames = masterIdLookup(tables.elements, "element_id");
  const speciesNames = masterIdLookup(tables.species, "species_id");
  const powerGroups = known(tables.powerRules, "power_rule_group");
  const supportedPowerGroups = new Set(["bf_hp_exact_1", "target_status", "en_value"]);
  const numeric = (table, id, row, fields) => {
    for (const field of fields) {
      if (row[field] !== "" && row[field] !== undefined && !Number.isFinite(Number(row[field]))) {
        add("数値異常", table, id, field, row[field]);
      }
    }
  };
  const reference = (table, id, row, field, target) => {
    const value = row[field];
    if (!isSet(value)) return;
    const targetRow = ids[target].get(value);
    if (!targetRow) add("参照不一致", table, id, field, value);
    else if (placeholders[target]?.(targetRow)) add("参照先未設定", table, id, field, value);
  };
  const masterReference = (table, id, row, field, master, required = false) => {
    const value = row[field];
    if (!value && required) add("項目未設定", table, id, field);
    if (value && !master.has(value)) add("参照不一致", table, id, field, value);
  };

  for (const row of tables.characters) {
    const id = row.character_id;
    numeric("characters", id, row, ["hp", "phy_atk", "phy_def", "sp_atk", "sp_def", "speed",
      "evasion_percent", "regen_value", "cost_charge", "slot", "display_order", "tolerance",
      "render_offset_x", "render_offset_y", "battle_anchor_x", "battle_anchor_y"]);
    if (placeholders.characters(row)) {
      add("予約行", "characters", id, "name");
      continue;
    }
    masterReference("characters", id, row, "element_1", elementNames, true);
    masterReference("characters", id, row, "element_2", elementNames);
    masterReference("characters", id, row, "species_id", speciesNames, true);
    for (const field of ["skill_1", "skill_2", "skill_3", "skill_4", "skill_5", "ai_setup_skill", "ai_main_skill"]) {
      reference("characters", id, row, field, "skills");
    }
    if (![1, 2, 3, 4, 5].some((slot) => isSet(row[`skill_${slot}`]))) add("項目未設定", "characters", id, "skills");
    reference("characters", id, row, "passive_id", "passives");
    if (!row.evasion_percent) add("項目未設定", "characters", id, "evasion_percent");
    else if (Number(row.evasion_percent) < 0 || Number(row.evasion_percent) > 100) {
      add("数値異常", "characters", id, "evasion_percent", row.evasion_percent);
    }
    const imagePath = characterImagePath(row.image);
    if (!row.image || row.image === "none") add("項目未設定", "characters", id, "image");
    else if (!imagePath || !imageExists(imagePath)) add("画像欠落", "characters", id, "image", row.image);
  }

  for (const raw of tables.skills) {
    const row = canonicalizeGeneOrderSkill(raw);
    const id = row.skill_id;
    numeric("skills", id, row, ["power", "priority", "cost", "power_cap", "animation_duration_ms", "repeat_count",
      "effect_chance1", "effect_chance2", "effect_chance3", "battle_effect_chance1", "battle_effect_chance2"]);
    if (placeholders.skills(row)) {
      add("予約行", "skills", id, "name");
      continue;
    }
    for (const field of ["name", "category"]) {
      if (!row[field]) add("項目未設定", "skills", id, field);
    }
    masterReference("skills", id, row, "element", elementNames, true);
    masterReference("skills", id, row, "element2", elementNames);
    for (const field of ["effect1", "effect2", "effect3"]) reference("skills", id, row, field, "effects");
    for (const field of ["battle_effect1", "battle_effect2"]) reference("skills", id, row, field, "battleEffects");
    if (isSet(row.power_rule) && !powerGroups.has(row.power_rule)) add("参照不一致", "skills", id, "power_rule", row.power_rule);
  }

  for (const row of tables.passives) {
    const id = row.passive_id;
    numeric("passives", id, row, ["value1", "value2", "value3"]);
    if (placeholders.passives(row)) {
      add("予約行", "passives", id, "name");
      continue;
    }
    const passive = geneOrderPassives.normalize(row, elements);
    if (passive.status === "pending" && !passive.issues.length) {
      add("効果未設定", "passives", id, "passive_type", row.name);
    }
    if (passive.status === "partial") {
      for (const { slot } of passive.unconfigured) add("効果未設定", "passives", id, "passive_type" + slot, row.name);
    }
    for (const { field, value } of passive.issues) add("効果未対応", "passives", id, field, value);
  }

  for (const table of ["effects", "battleEffects", "powerRules"]) {
    const fields = table === "powerRules" ? ["min_ratio", "max_ratio", "power_multiplier"] : ["damage_value", "turn", "damage_cut", "modifier", "start_delay", "max_uses"];
    for (const row of tables[table]) {
      const id = row[GO_DATA_IDS[table]];
      numeric(table, id, row, fields);
      if (table === "effects" && !geneOrderBattle.effectKind(row)) {
        add("効果未対応", table, id, "damage_type", row.damage_type);
      }
      if (table === "battleEffects" && !geneOrderBattle.battleEffectKind(row)) {
        add("効果未対応", table, id, "battle_effect_group", row.battle_effect_group);
      }
      if (table === "powerRules" && !supportedPowerGroups.has(row.power_rule_group)) {
        add("効果未対応", table, id, "power_rule_group", row.power_rule_group);
      }
    }
  }

  const pairs = new Set();
  for (const row of tables.effectiveness) {
    const id = `${row.attack_element}/${row.defense_element}`;
    if (pairs.has(id)) add("相性重複", "effectiveness", id, "pair");
    pairs.add(id);
    for (const field of ["attack_element", "defense_element"]) {
      if (!elements.has(row[field])) add("参照不一致", "effectiveness", id, field, row[field]);
    }
    if (!row.multiplier || !Number.isFinite(Number(row.multiplier)) || Number(row.multiplier) < 0) {
      add("数値異常", "effectiveness", id, "multiplier", row.multiplier);
    }
  }
  for (const attack of elements) {
    for (const defense of elements) {
      const id = `${attack}/${defense}`;
      if (!pairs.has(id)) add("相性欠落", "effectiveness", id, "pair");
    }
  }
  return diagnostics;
}
