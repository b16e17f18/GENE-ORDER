// Server-only bridge for trusted repository scripts. This is not a network endpoint
// or a sandbox for client code. The browser boot callback is deliberately not run.
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SCRIPTS = ['data-validation.js', 'passive.js', 'battle-core.js', 'battle-ai.js', 'dialogue-manager.js', 'app.js'];
const SIDES = ['player', 'enemy'];
const hashFiles = entries => {
  const hash = createHash('sha256');
  for (const [name, bytes] of entries) hash.update(JSON.stringify([name, bytes.length])).update(bytes);
  return hash.digest('hex');
};
const clone = value => structuredClone(value);

export function seededRandom(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('seed must be a uint32');
  let state = seed, draws = 0;
  const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; draws++; return state / 0x100000000; };
  next.inspect = () => ({ seed, state, draws });
  return next;
}

function inputAction(action) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) throw new Error('Invalid action');
  const formats = { move: ['type', 'moveId', 'switchIndex'], switch: ['type', 'index'], skip: ['type'] };
  const allowed = Object.hasOwn(formats, action.type) ? formats[action.type] : null;
  if (!allowed || Object.keys(action).some(key => !allowed.includes(key))) throw new Error('Unsupported action or fields');
  if (action.type === 'move' && (typeof action.moveId !== 'string' || !action.moveId)) throw new Error('Invalid moveId');
  if (action.type === 'switch' && !Number.isSafeInteger(action.index)) throw new Error('Invalid switch index');
  if ('switchIndex' in action && !Number.isSafeInteger(action.switchIndex)) throw new Error('Invalid switchIndex');
  return clone(action);
}

export function loadBattleAdapter({ root = ROOT } = {}) {
  const scripts = SCRIPTS.map(name => [name, readFileSync(resolve(root, name))]);
  const context = vm.createContext({ document: Object.freeze({ addEventListener() {} }) });
  for (const [filename, bytes] of scripts) vm.runInContext(bytes.toString('utf8'), context, { filename });
  // An accidental dependency on ambient randomness fails instead of desynchronizing.
  vm.runInContext('Math.random = () => { throw new Error("Use battle.random on the server"); };', context);
  const shared = vm.runInContext(`({ go: geneOrderBattle, paths: DATA_PATHS, ids: GO_DATA_IDS, columns: GO_REQUIRED_COLUMNS,
    parse: parseCsv, rows: rowsFromCsv, lookup: masterIdLookup, validate: validateGeneOrderData,
    character: normalizeCharacter, skill: normalizeSkill, effect: normalizeEffect,
    battleEffect: normalizeBattleEffect, power: normalizePowerRule, form: geneOrderFormData.normalize,
    passives: geneOrderPassives, statuses: geneOrderStatusIds })`, context);
  const csvFiles = Object.entries(shared.paths).map(([key, path]) => [key, path, readFileSync(resolve(root, path))]);
  const tables = Object.fromEntries(csvFiles.map(([key, path, bytes]) => {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const header = shared.parse(text.replace(/^\uFEFF/, ''))[0] ?? [];
    if ([shared.ids[key], ...shared.columns[key]].some(column => !header.includes(column))) throw new Error('Missing CSV column: ' + path);
    return [key, shared.rows(text)];
  }));
  const diagnostics = clone(shared.validate(tables, path => existsSync(resolve(root, decodeURIComponent(path)))));
  if (diagnostics.some(d => d.level === '重複ID')) throw new Error('Duplicate master IDs: ' + JSON.stringify(diagnostics.filter(d => d.level === '重複ID')));
  const elements = shared.lookup(tables.elements, 'element_id'), species = shared.lookup(tables.species, 'species_id');
  const skills = new Map(tables.skills.map(r => shared.skill(r, elements)).filter(r => r.skill_id && r.name && r.category).map(r => [r.skill_id, r]));
  const effects = new Map(tables.effects.map(shared.effect).map(r => [r.effect_id, r]));
  const battleEffects = new Map(tables.battleEffects.map(r => shared.battleEffect(r, elements)).map(r => [r.battle_effect_id, r]));
  const forms = new Map(tables.forms.map(shared.form).map(r => [r.form_id, r]));
  const catalog = shared.passives.readTypes(tables.passiveTypes);
  if (catalog.issues.length) throw new Error('Invalid passive type catalog: ' + JSON.stringify(catalog.issues));
  const fields = new Map([...battleEffects, ...forms]), statusIds = shared.statuses(tables.effects);
  const passives = new Map(tables.passives.filter(r => r.name || r.text).map(r => [r.passive_id, shared.passives.normalize(r, elements, statusIds, catalog, fields)]));
  const characters = new Map(tables.characters.filter(r => r.character_id && r.name && r.content_scope !== 'tutorial')
    .map(r => { const c = shared.character(r, elements, species); return [c.character_id, c]; }));
  const powerRules = new Map();
  for (const rule of tables.powerRules.map(shared.power)) {
    if (!powerRules.has(rule.power_rule_group)) powerRules.set(rule.power_rule_group, []);
    powerRules.get(rule.power_rule_group).push(rule);
  }
  const effectiveness = new Map([...new Set(tables.elements.map(r => r.element_id))].map(id => [id, new Map()]));
  for (const row of tables.effectiveness) {
    const chart = effectiveness.get(row.attack_element), multiplier = Number(row.multiplier);
    if (!chart || !effectiveness.has(row.defense_element) || chart.has(row.defense_element) || row.multiplier === '' || !Number.isFinite(multiplier) || multiplier < 0) throw new Error('Invalid element chart');
    chart.set(row.defense_element, multiplier);
  }
  if ([...effectiveness.values()].some(chart => chart.size !== effectiveness.size)) throw new Error('Incomplete element chart');
  const assets = { skills, effects, battleEffects, forms, passives, powerRules, effectiveness };
  const dataVersion = hashFiles(csvFiles.map(([, path, bytes]) => [path, bytes]));
  const engineVersion = hashFiles([...scripts, ['server/battle-adapter.mjs', readFileSync(new URL('./battle-adapter.mjs', import.meta.url))]]);
  const rulesetVersion = hashFiles([['data', Buffer.from(dataVersion)], ['engine', Buffer.from(engineVersion)]]);

  function characterIssue(id) {
    const c = characters.get(id);
    if (!c || !Number.isSafeInteger(c.slot) || c.slot <= 0) return 'Unavailable character';
    if (!effectiveness.has(c.element_1) || (c.element_2 && !effectiveness.has(c.element_2)) || !c.species_id || ![c.hp,c.phy_atk,c.phy_def,c.sp_atk,c.sp_def,c.speed].every(n => Number.isSafeInteger(n) && n > 0) || !Number.isSafeInteger(c.energy_charge) || c.energy_charge < 0) return 'Invalid character stats or master reference';
    if (c.skillIds.some(skill => !skills.has(skill))) return 'Unknown learned skill';
    if (!c.skillIds.some(skill => !shared.go.moveAvailability(skills.get(skill), assets).issues.length)) return 'No usable learned skill';
    if (c.passive_id && c.passive_id !== 'none' && passives.get(c.passive_id)?.status !== 'implemented') return 'Unavailable passive';
    return '';
  }

  function createBattle({ player, enemy, seed }) {
    const random = seededRandom(seed);
    const team = ids => {
      if (!Array.isArray(ids) || ids.length !== 3 || new Set(ids).size !== ids.length) throw new Error('Select exactly 3 distinct character IDs');
      return ids.map(id => { const issue = characterIssue(id); if (issue) throw new Error(id + ': ' + issue); return characters.get(id); });
    };
    const initial = clone({ player, enemy, seed, rulesetVersion });
    const options = clone({ ...assets, player: team(player), enemy: team(enemy) });
    const battle = shared.go.createBattle({ ...options, random, manualSwitches: true });
    const history = [];
    return {
      // Private server state only. Do not send battle, events, or this history to peers.
      battle, initial, history,
      randomState: () => random.inspect(),
      legalActions(side) {
        if (!SIDES.includes(side)) throw new Error('Invalid side');
        return clone(shared.go.legalActions(battle, side));
      },
      resolveTurn(selected) {
        if (!selected || Object.keys(selected).length !== 2 || SIDES.some(side => !Object.hasOwn(selected, side))) throw new Error('Both actions are required');
        const actions = Object.fromEntries(SIDES.map(side => [side, inputAction(selected[side])]));
        // The core validates both sides before it advances or consumes RNG.
        const result = shared.go.resolveTurn(battle, actions);
        history.push({ type: 'turn', actions });
        return result;
      },
      continueSwitch(side, index) {
        if (!SIDES.includes(side) || !Number.isSafeInteger(index)) throw new Error('Invalid replacement');
        const result = shared.go.continueSwitch(battle, side, index);
        history.push({ type: 'switch', side, index });
        return result;
      },
    };
  }

  return {
    dataVersion, engineVersion, rulesetVersion, diagnostics,
    counts: Object.fromEntries(Object.entries(tables).map(([key, rows]) => [key, rows.length])),
    eligibleCharacterIds: () => [...characters.keys()].filter(id => !characterIssue(id)),
    createBattle,
    replay(initial, commands) {
      if (initial.rulesetVersion !== rulesetVersion) throw new Error('Ruleset mismatch');
      const session = createBattle(initial);
      for (const command of commands) {
        if (command.type === 'turn') session.resolveTurn(command.actions);
        else if (command.type === 'switch') session.continueSwitch(command.side, command.index);
        else throw new Error('Unknown replay command');
      }
      return session;
    },
  };
}
