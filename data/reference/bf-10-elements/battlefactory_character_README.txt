BattleFactory character.csv schema (MHB-derived)

- battlefactory_character_template.csv: 64 blank character slots. Populate new characters, stats, skills, images.
- battlefactory_character_migration_reference.csv: original MHB character rows for comparison ONLY. Old individual weaknesses removed, and element_1 / element_2 left blank intentionally because new 10-element IDs differ.
- element_1 / element_2: optional dual type, IDs fire, water, wind, earth, light, dark, thunder, ice, steel, spirit. element_1 required when adding a real character; element_2 optional.
- Type matchups are defined in separate element_effectiveness.csv. Do not use character-specific weak_* columns.
- STAB = 1.5x when attack element matches either defender's own attacker's element_1 or element_2.
- Dual type incoming multiplier = matchup[attack][element_1] * matchup[attack][element_2]. Single type uses one lookup.
- EN remains (regen_value, cost_charge retained). Existing skill_1..4, passive_id, AI, rendering and stats kept as-is pending actual code compatibility audit.
- No automatic Gen 4 Pokemon damage formula conversion; this is a data schema conversion only.
- The original MHB CSV is unchanged.
