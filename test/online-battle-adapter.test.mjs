import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { loadBattleAdapter, seededRandom } from '../server/battle-adapter.mjs';

const adapter = loadBattleAdapter();
const roster = adapter.eligibleCharacterIds();
const start = (a = adapter, seed = 91234) => a.createBattle({ player: roster.slice(0, 3), enemy: roster.slice(3, 6), seed });
function canonical(value, seen = new Map()) {
  if (value === null || typeof value !== 'object') return typeof value === 'function' ? undefined : value;
  if (seen.has(value)) return { ref: seen.get(value) };
  seen.set(value, seen.size);
  if (Object.prototype.toString.call(value) === '[object Map]') return { map: [...value].map(([k,v]) => [canonical(k,seen),canonical(v,seen)]) };
  if (Object.prototype.toString.call(value) === '[object Set]') return { set: [...value].map(v => canonical(v,seen)) };
  if (Array.isArray(value)) return Array.from(value, v => canonical(v,seen));
  return Object.fromEntries(Object.keys(value).sort().map(k => [k,canonical(value[k],seen)]));
}
function snapshot(session) {
  const {turn,winner,active,teams,fields,pendingSwitch} = session.battle;
  return JSON.stringify(canonical({turn,winner,active,teams,fields,pendingSwitch,rng:session.randomState()}));
}
function choose(session, side, step) {
  const actions = session.legalActions(side), attacks = actions.filter(a => a.type === 'move' && session.battle.skills.get(a.moveId).category === 'attack');
  return attacks[step % attacks.length] ?? actions.find(a => a.type === 'move') ?? actions[0] ?? {type:'skip'};
}
function step(session, n) {
  if (session.battle.pendingSwitch) {
    const {side,candidates} = session.battle.pendingSwitch;
    return session.continueSwitch(side, candidates[n % candidates.length]);
  }
  return session.resolveTurn(Object.fromEntries(['player','enemy'].map(side => [side,choose(session,side,n)])));
}

test('loads formal CSV via existing normalizers without browser boot or MHB inline data', () => {
  assert.ok(roster.length >= 6);
  assert.equal(adapter.counts.elements, 9);
  assert.equal(adapter.counts.effectiveness, 81);
  assert.ok(adapter.counts.skills > 0 && adapter.counts.passives > 0);
  assert.match(adapter.rulesetVersion, /^[0-9a-f]{64}$/);
  const match = start();
  assert.equal(match.battle.skills.get('skill_066').element2, 'wind');
  assert.equal(match.battle.effectiveness.get('light').get('earth'), 0);
  assert.equal(match.battle.manualSwitches, true);
  assert.ok(match.battle.teams.player[0].passiveEffects.length > 0);
});

test('two independently loaded engines produce identical events, state and RNG consumption', () => {
  const other = loadBattleAdapter();
  assert.equal(other.rulesetVersion, adapter.rulesetVersion);
  const a=start(), b=start(other);
  assert.equal(snapshot(a),snapshot(b));
  for(let n=0;n<30&&!a.battle.winner;n++) {
    assert.deepEqual(canonical(step(a,n)),canonical(step(b,n)));
    assert.equal(snapshot(a),snapshot(b));
  }

});

test('seed is explicit, reproducible, and includes a valid zero seed', () => {
  for(const seed of [0,1,0xffffffff]) {
    const a=seededRandom(seed),b=seededRandom(seed);
    assert.deepEqual(Array.from({length:20},()=>a()),Array.from({length:20},()=>b()));
    assert.equal(a.inspect().draws,20);
  }
  assert.notEqual(seededRandom(1)(),seededRandom(2)());
  for(const seed of [undefined,-1,0x100000000,1.5,NaN,'1'])assert.throws(()=>seededRandom(seed),/uint32/);
});

test('fixed team IDs preserve the chosen lead and reject invented or unset characters', () => {
  const ids=roster.slice(0,3).reverse();
  const a=adapter.createBattle({player:ids,enemy:roster.slice(3,6),seed:1});
  assert.equal(a.battle.teams.player[0].base.character_id,ids[0]);
  for(const player of [[],ids.slice(0,1),ids.slice(0,2),[ids[0],ids[0],ids[2]],roster.slice(0,4),['missing',ids[1],ids[2]],['character_999',ids[1],ids[2]]]) assert.throws(()=>adapter.createBattle({player,enemy:ids,seed:1}));
  const raw=readFileSync(new URL('../data/character.csv',import.meta.url),'utf8');
  assert.ok(raw.includes(a.battle.teams.player[0].base.name));
});

test('separate matches cannot mutate the master data or each other', () => {
  const a=start(),b=start(),before=snapshot(b),id=a.battle.teams.player[0].base.character_id;
  a.battle.teams.player[0].base.phy_atk=9999;
  a.battle.skills.get('skill_000').cost=999;
  a.battle.effects.get('poison').turn=999;
  assert.equal(snapshot(b),before);
  const c=start();assert.notEqual(c.battle.teams.player[0].base.phy_atk,9999);
  assert.equal(c.battle.teams.player[0].base.character_id,id);
  assert.equal(c.battle.skills.get('skill_000').cost,0);
});

test('invalid or incomplete actions cannot change state or consume RNG', () => {
  const a=start(),before=snapshot(a),legal=choose(a,'player',0);
  for(const selected of [{player:legal},{player:legal,enemy:{type:'move',moveId:'missing'}},{player:legal,enemy:{type:'wait'}},{player:{...legal,damage:9999},enemy:choose(a,'enemy',0)},{player:legal,enemy:{type:'skip'}}]) {
    assert.throws(()=>a.resolveTurn(selected));assert.equal(snapshot(a),before);assert.equal(a.history.length,0);
  }
});

test('normal switching uses the core and no client-supplied fighter stats', () => {
  const a=start(),result=a.resolveTurn({player:{type:'switch',index:2},enemy:{type:'move',moveId:'skill_000'}});
  assert.equal(a.battle.active.player,2);
  assert.ok(result.events.some(e=>e.type==='switch'&&e.side==='player'));
});

test('continueSwitch resumes a KO replacement and replays the suspended turn deterministically', () => {
  // Derive a genuine pending replacement using only formal skills and legal inputs.
  const a=start();let pending=false;
  for(let n=0;n<300&&!a.battle.winner;n++){
    step(a,n);
    if(a.battle.pendingSwitch){pending=true;break;}
  }
  assert.ok(pending,'formal legal-action replay must reach a replacement');
  const before=snapshot(a),{side,candidates}=a.battle.pendingSwitch;
  assert.throws(()=>a.continueSwitch(side==='player'?'enemy':'player',candidates[0]));
  assert.throws(()=>a.continueSwitch(side,99));
  assert.equal(snapshot(a),before);
  const b=adapter.replay(a.initial,a.history);
  assert.equal(snapshot(b),snapshot(a));
  assert.deepEqual(canonical(a.continueSwitch(side,candidates[0])),canonical(b.continueSwitch(side,candidates[0])));
  assert.equal(snapshot(a),snapshot(b));
});

test('replay rejects a different ruleset and reproduces full accepted input history', () => {
  const a=start();for(let n=0;n<24&&!a.battle.winner;n++)step(a,n);
  const b=adapter.replay(a.initial,a.history);
  assert.equal(snapshot(a),snapshot(b));
  assert.deepEqual(a.history,b.history);
  assert.throws(()=>adapter.replay({...a.initial,rulesetVersion:'different'},a.history),/Ruleset/);
});

test('server engine and data loading never modify formal CSV', () => {
  const names=['character','skill','passive','effect','battle_effect','power_rule','element','element_effectiveness','species','passive_type','form','animation'];
  const before=names.map(n=>readFileSync(new URL('../data/'+n+'.csv',import.meta.url),'utf8'));
  const a=start();for(let n=0;n<10&&!a.battle.winner;n++)step(a,n);
  assert.deepEqual(names.map(n=>readFileSync(new URL('../data/'+n+'.csv',import.meta.url),'utf8')),before);
});


test('same-speed ordering consumes only the seeded RNG and is replayable',()=>{const ids=roster.slice(0,3),a=adapter.createBattle({player:ids,enemy:ids,seed:34567}),b=adapter.createBattle({player:ids,enemy:ids,seed:34567});const actions={player:{type:'move',moveId:'skill_000'},enemy:{type:'move',moveId:'skill_000'}};assert.deepEqual(canonical(a.resolveTurn(actions)),canonical(b.resolveTurn(actions)));assert.ok(a.randomState().draws>0);assert.equal(snapshot(a),snapshot(b));assert.equal(snapshot(a),snapshot(adapter.replay(a.initial,a.history)));});

// The formal UI exposes a headless createMatch API: compare its actual manual
// battle path (including frame capture) to the Node bridge, not a copied formula.
test('formal manual UI and server adapter produce the same turn and replacement results', async () => {
  const vm = await import('node:vm');
  const context = vm.createContext({document:{addEventListener(){}}});
  for(const filename of ['data-validation.js','passive.js','battle-core.js','battle-ai.js','dialogue-manager.js','go-ui.js','app.js'])vm.runInContext(readFileSync(new URL('../'+filename,import.meta.url),'utf8'),context,{filename});
  const ui=vm.runInContext('geneOrderUI',context),server=start(), source=server.battle;
  const bases=[...source.teams.player,...source.teams.enemy].map(f=>f.base);
  const data={characters:bases,characterMap:new Map(bases.map(c=>[c.character_id,c])),elements:source.effectiveness,
    ...Object.fromEntries(['skills','effects','battleEffects','powerRules','effectiveness'].map(k=>[k,source[k]])),
    passives:new Map([...source.teams.player,...source.teams.enemy].filter(f=>f.passive).map(f=>[f.passive.passive_id,f.passive])),
    forms:new Map([...source.teams.player,...source.teams.enemy].flatMap(f=>f.formDefs.map(form=>[form.form_id,form])))};
  const team=Object.fromEntries(['player','enemy'].map(side=>[side,source.teams[side].map(f=>f.base.character_id)]));
  const roll=seededRandom(server.initial.seed),manual=ui.createMatch(data,{team,lead:{player:team.player[0],enemy:team.enemy[0]},mode:'manual'},{random:roll});
  assert.equal(snapshot(server),snapshot({battle:manual.battle,randomState:roll.inspect}));
  let replacements=0;
  for(let n=0;n<60&&!server.battle.winner;n++) {
    let a,b;
    if(server.battle.pendingSwitch){const {side,candidates}=server.battle.pendingSwitch;a=server.continueSwitch(side,candidates[0]);b=manual.resume(candidates[0]);replacements++;}
    else{const actions={player:choose(server,'player',n),enemy:choose(server,'enemy',n)};a=server.resolveTurn(actions);b=manual.resolve(actions);}
    const {frames,...result}=b;
    assert.ok(Array.isArray(frames));assert.deepEqual(canonical(a),canonical(result));
    assert.equal(snapshot(server),snapshot({battle:manual.battle,randomState:roll.inspect}));
  }
  assert.ok(replacements>0);
});

test('missing master files fail explicitly without MHB or browser fallback',()=>assert.throws(()=>loadBattleAdapter({root:new URL('../.cache/no-such-formal-masters/',import.meta.url).pathname}),/ENOENT/));
