import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const ctx = vm.createContext({ document: { addEventListener() {} } });
for (const file of ['data-validation.js','passive.js','battle-core.js','battle-ai.js','bgm.js','dialogue-manager.js','app.js']) vm.runInContext(read(file), ctx, { filename: file });
const get = name => vm.runInContext(name, ctx);
const go = get('geneOrderBattle'), ai = get('geneOrderAI');
const rows = name => get('rowsFromCsv')(read('data/' + name + '.csv'));
const elements = get('masterIdLookup')(rows('element'), 'element_id');
const chart = new Map();
for (const r of rows('element_effectiveness')) { if (!chart.has(r.attack_element)) chart.set(r.attack_element,new Map()); chart.get(r.attack_element).set(r.defense_element,Number(r.multiplier)); }
const effects = new Map(rows('effect').map(r => [r.effect_id,get('normalizeEffect')(r)]));
const defenses = new Map(rows('battle_effect').map(r => [r.battle_effect_id,get('normalizeBattleEffect')(r)]));
const powerRules = new Map();
for(const row of rows('power_rule').map(get('normalizePowerRule'))) { if(!powerRules.has(row.power_rule_group))powerRules.set(row.power_rule_group,[]);powerRules.get(row.power_rule_group).push(row); }
const skills = new Map(rows('skill').filter(r => r.name).map(r => [r.skill_id,get('normalizeSkill')(r,elements)]));
const types = get('geneOrderPassives.readTypes')(rows('passive_type'));
const statusIds = get('geneOrderStatusIds')([...effects.values()]);
const passives = new Map(rows('passive').filter(r => r.name).map(r => [r.passive_id,get('geneOrderPassives.normalize')(r,elements,statusIds,types)]));
Object.assign(get('state'), { effects, battleEffects: defenses, skills, passives });
const strike = { skill_id: 'attack',name:'Attack',category:'attack',attack_type:'physical',element:'none',element2:null,power:80,cost:2,priority:0,hit_type:'normal' };
const wait = { type:'wait' }, use = id => ({ type:'move',moveId:id });
const base = (o={}) => ({ character_id:'test',name:'Test',hp:200,phy_atk:120,phy_def:100,sp_atk:160,sp_def:100,speed:120,regen_value:0,energy_charge:0,element_1:'none',element_2:null,skillIds:['attack'],...o });
function make({moves=[strike],player,enemy,random=()=>.99,...other}={}) {
  return go.createBattle({effects,battleEffects:defenses,passives,powerRules,skills:new Map(moves.map(m=>[m.skill_id,m])),effectiveness:chart,
    player:player??[base({skillIds:moves.map(m=>m.skill_id)})],enemy:enemy??[base({character_id:'target',name:'Target',hp:2000})],random,...other});
}
const active = (b,s='player') => go.activeFighter(b,s);
const attach = (fighter,id,turns=effects.get(id).turn,patch={}) => fighter.statuses.push({definition:{...effects.get(id),...patch},turns});
const round = b => go.resolveTurn(b,{player:wait,enemy:wait});
const statusMove = id => ({ ...strike,skill_id:'give-'+id,name:id,category:'status',power:0,cost:0,effect1:id,effect_target1:'enemy',effect_chance1:100 });

test('CSV declares five supported statuses and blank new columns retain neutral defaults',()=>{
  assert.deepEqual([...statusIds].sort(),['burn','frostbite','paralysis','poison','sleep']);
  assert.equal(go.effectKind(effects.get('paralysis')),'status');
  for(const id of ['burn','frostbite','poison']) assert.equal(go.effectKind(effects.get(id)),'status-damage');
  const old=get('normalizeEffect')({effect_id:'old',effect_group:'status',damage_type:'none',damage_value:0,turn:5});
  assert.equal(old.stat_modifier_multiplier,1); assert.equal(old.action_failure_chance,0); assert.equal(old.stat_modifier_target,'none');
  assert.equal(go.effectKind(old),'status');
});

test('poison keeps current CSV magnitude/duration, MHB rounding and no stat or failure multiplier',()=>{
  const b=make({player:[base({hp:403})]}); const f=active(b);attach(f,'poison');
  const expected=go.statValue(f,'phy_atk');
  const tick=Math.max(1,Math.round(f.maxHp*effects.get('poison').damage_value/100)),duration=effects.get('poison').turn;
  for(let i=0;i<duration&&!f.fainted;i++){const before=f.hp,e=round(b).events.filter(e=>e.type==='residual');assert.equal(e.length,1);assert.equal(e[0].damage,Math.min(before,tick));assert.equal(go.statValue(f,'phy_atk'),expected);}
  assert.equal(f.hp,Math.max(0,403-tick*duration)); assert.equal(f.statuses.length,0); assert.equal(go.actionFailureChance(f),0); if(!b.winner)assert.equal(round(b).events.some(e=>e.type==='residual'),false);else assert.ok(go.checkAction(b,'player',wait));
});
for(const [id,stat,normal,half] of [['burn','phy_atk',120,60],['frostbite','sp_atk',160,80]]) {
  test(id+' uses CSV damage/duration, halves only its CSV stat and restores automatically',()=>{
    const b=make({player:[base({hp:403})]});const f=active(b);attach(f,id);
    assert.equal(go.statValue(f,stat),half);assert.equal(f.stages[stat],0);
    assert.equal(go.statValue(f,id==='burn'?'sp_atk':'phy_atk'),id==='burn'?160:120);
    const tick=Math.max(1,Math.round(f.maxHp*effects.get(id).damage_value/100)),duration=effects.get(id).turn;
    for(let i=0;i<duration;i++){const before=f.hp,events=round(b).events;assert.equal(events.find(e=>e.type==='residual').damage,Math.min(before,tick));if(i<duration-1)assert.equal(go.statValue(f,stat),half);}
    assert.equal(f.hp,Math.max(0,403-tick*duration));assert.equal(go.statValue(f,stat),normal);assert.equal(f.statuses.length,0);
  });
}

test('paralysis halves speed for five turns without HP damage, damage text or wait failures',()=>{
  let rolls=0;const b=make({random:()=>{rolls++;return 0;}});const f=active(b);attach(f,'paralysis');
  assert.equal(go.effectiveSpeed(b,'player'),60);assert.equal(go.actionFailureChance(f),25);
  for(let i=0;i<5;i++){const e=round(b).events;assert.equal(e.some(e=>['residual','action-failed'].includes(e.type)),false);}
  assert.equal(rolls,0);assert.equal(f.hp,200);assert.equal(go.effectiveSpeed(b,'player'),120);assert.equal(go.actionFailureChance(f),0);
});
for(const [roll,blocked] of [[0,true],[.249999,true],[.25,false],[.99,false]]) {
  test('paralysis action boundary '+roll+' rolls once before EN and effect use',()=>{
    let rolls=0;const b=make({random:()=>{rolls++;return roll;}});const f=active(b);go.changeEnergy(f,3);attach(f,'paralysis');
    const e=go.resolveTurn(b,{player:use('attack'),enemy:wait}).events;
    assert.equal(rolls,1);assert.equal(e.some(e=>e.type==='action-failed'),blocked);assert.equal(e.some(e=>e.type==='move'&&e.side==='player'),!blocked);
    assert.equal(f.energy,blocked?4:2);assert.equal(f.statuses[0].turns,4);
    if(blocked) assert.equal(active(b,'enemy').hp,2000);
  });
}

test('action failure precedes passive HP cost, next-power consumption, move counters',()=>{
  const move={...strike,priority:1}; const b=make({moves:[move],player:[base({passive_id:'passive_020'})],random:()=>0});const f=active(b);go.changeEnergy(f,3);attach(f,'paralysis');
  f.nextElementPower.set('none',defenses.get('next_none_power_150'));
  const uses=JSON.stringify([...f.passiveState.uses]), counters=JSON.stringify([...f.moveUses]);
  const events=go.resolveTurn(b,{player:use('attack'),enemy:wait}).events;
  assert.equal(f.hp,200);assert.equal(f.energy,4);assert.equal(f.nextElementPower.size,1);
  assert.equal(JSON.stringify([...f.passiveState.uses]),uses);assert.equal(JSON.stringify([...f.moveUses]),counters);
  assert.equal(events.some(e=>['next-power-used','passive','move'].includes(e.type)),false);
});

test('normal switch is never paralyzed, retains status and pauses turns on the bench',()=>{
  let rolls=0;const b=make({player:[base(),base({character_id:'bench',name:'Bench'})],random:()=>{rolls++;return 0;}});const outgoing=active(b);attach(outgoing,'paralysis');
  const events=go.resolveTurn(b,{player:{type:'switch',index:1},enemy:wait}).events;
  assert.equal(events.some(e=>e.type==='switch'),true);assert.equal(events.some(e=>e.type==='action-failed'),false);assert.equal(rolls,0);
  assert.equal(outgoing.statuses[0].turns,5);round(b);assert.equal(outgoing.statuses[0].turns,5);
  go.resolveTurn(b,{player:{type:'switch',index:0},enemy:wait});assert.equal(outgoing.statuses[0].turns,4);assert.equal(go.effectiveSpeed(b,'player'),60);
});

for(const id of ['poison','burn','paralysis','frostbite']) test(id+' reapplication refreshes the same instance without stacking and uses the same bench rules',()=>{
  const move=statusMove(id);const b=make({moves:[move],enemy:[base({hp:2000}),base({name:'Bench',hp:2000})]});const f=active(b,'enemy');
  go.resolveTurn(b,{player:use(move.skill_id),enemy:wait}); assert.equal(f.statuses.length,1); assert.equal(f.statuses[0].turns,effects.get(id).turn-1);
  round(b);assert.equal(f.statuses[0].turns,effects.get(id).turn-2);
  go.resolveTurn(b,{player:use(move.skill_id),enemy:wait});assert.equal(f.statuses.length,1);assert.equal(f.statuses[0].turns,effects.get(id).turn-1);
  go.resolveTurn(b,{player:wait,enemy:{type:'switch',index:1}});assert.equal(f.statuses[0].turns,effects.get(id).turn-1);round(b);assert.equal(f.statuses[0].turns,effects.get(id).turn-1);
  go.resolveTurn(b,{player:wait,enemy:{type:'switch',index:0}});assert.equal(f.statuses[0].turns,effects.get(id).turn-2);
});

test('coexisting statuses keep separate durations, modifiers and damage amounts',()=>{
  const b=make();const f=active(b);for(const id of ['poison','burn','paralysis','frostbite'])attach(f,id);
  assert.deepEqual(['phy_atk','sp_atk','speed'].map(s=>go.statValue(f,s)),[60,80,60]);
  const e=round(b).events;assert.equal(e.filter(e=>e.type==='residual').length,3);assert.equal(f.hp,200-['poison','burn','frostbite'].reduce((n,id)=>n+Math.round(200*effects.get(id).damage_value/100),0));assert.equal(f.statuses.length,4);
  f.statuses=[];assert.deepEqual(['phy_atk','sp_atk','speed'].map(s=>go.statValue(f,s)),[120,160,120]);
});

test('rank, conditional passive, status and field multipliers combine without rewriting ranks or base stats',()=>{
  const b=make({player:[base({phy_atk:101,passive_id:'passive_017'})]});const f=active(b);f.hp=100;attach(f,'burn');go.changeStage(f,'phy_atk',1);
  assert.equal(go.effectiveStat(f,'phy_atk',{fieldMultiplier:1.5}).value,136);
  assert.equal(f.base.phy_atk,101);assert.equal(f.stages.phy_atk,1);f.statuses=[];
  assert.equal(go.statValue(f,'phy_atk'),181);
  const metabolism=make({player:[base({passive_id:'passive_019'})]});attach(active(metabolism),'paralysis');
  assert.equal(go.statValue(active(metabolism),'phy_def'),150);assert.equal(go.effectiveSpeed(metabolism,'player'),60);
});

test('a status can be configured to modify defense without new JavaScript or rank debuffs',()=>{
  const b=make();const f=active(b,'enemy');attach(f,'paralysis',5,{stat_modifier_target:'phy_def',stat_modifier_multiplier:.5,action_failure_chance:0});
  assert.equal(go.previewDamage(b,'player',strike).defense,50);assert.equal(f.stages.phy_def,0);
});

test('a newly inflicted status can prevent the later action in the same turn',()=>{
  const move={...statusMove('paralysis'),priority:1};const b=make({moves:[strike,move],random:()=>0});go.changeEnergy(active(b,'enemy'),3);
  const events=go.resolveTurn(b,{player:use(move.skill_id),enemy:use('attack')}).events;
  assert.ok(events.some(e=>e.type==='status-applied'));assert.ok(events.some(e=>e.type==='action-failed'&&e.side==='enemy'));assert.equal(active(b,'enemy').energy,4);
});

test('failure while charging preserves reservations, costs and finalized power',()=>{
  const move=skills.get('skill_054');const b=make({moves:[move],random:()=>.99});const f=active(b);go.changeEnergy(f,6);attach(f,'paralysis');
  const first=go.resolveTurn(b,{player:use(move.skill_id),enemy:wait});assert.ok(first.events.some(e=>e.type==='charge'));
  const pending=f.pending,energy=f.energy; b.random=()=>0;
  const second=go.resolveTurn(b,{player:use(move.skill_id),enemy:wait});assert.ok(second.events.some(e=>e.type==='action-failed'));assert.equal(f.pending,pending);assert.equal(f.energy,energy);
  b.random=()=>.99;const third=go.resolveTurn(b,{player:use(move.skill_id),enemy:wait});assert.equal(third.events.find(e=>e.type==='move').power,pending.power);assert.equal(f.pending,null);assert.equal(f.energy,energy);
});

test('preview and AI share conditional damage, speed and execution chance without mutation or battle RNG use',()=>{
  let calls=0;const b=make({random:()=>{calls++;return .99;}});const f=active(b);go.changeEnergy(f,3);attach(f,'paralysis');attach(f,'burn');
  const before=JSON.stringify(b);const p=go.previewDamage(b,'player',strike);const observed=ai.observe(b,'player',{revealFixedMoves:true});const choices=ai.evaluate(observed);
  assert.equal(p.attack,60);assert.equal(p.executionChance,.75);assert.equal(p.expectedDamage,p.actualDamage*.75);assert.equal(go.effectiveSpeed(b,'player'),60);
  const candidate=choices.find(c=>c.move?.skill_id==='attack');assert.equal(candidate.forecast.executionChance,.75);assert.equal(candidate.expectedDamage,p.expectedDamage);
  assert.equal(JSON.stringify(b),before);assert.equal(calls,0);
  const events=go.resolveTurn(b,{player:use('attack'),enemy:wait}).events;
  assert.equal(events.find(e=>e.type==='move'&&e.side==='player').damage,p.damage);assert.equal(calls,1);
});

test('AI values paralysis without residual HP damage and lowers expected attack pressure under paralysis',()=>{
  const para=statusMove('paralysis');const b=make({moves:[strike,para]});go.changeEnergy(active(b),3);
  const score=()=>ai.evaluate(ai.observe(b,'player',{revealFixedMoves:true}));
  const normal=score().find(c=>c.move?.skill_id==='attack');
  assert.ok(score().find(c=>c.move?.skill_id===para.skill_id).score>0);
  attach(active(b),'paralysis');const changed=score().find(c=>c.move?.skill_id==='attack');
  assert.equal(changed.expectedDamage,normal.expectedDamage*.75);assert.ok(changed.score<normal.score);
});

test('a new CSV failure chance combines independently and no RNG is consumed by stat queries',()=>{
  const b=make();const f=active(b);attach(f,'paralysis');attach(f,'frostbite',5,{action_failure_chance:50});
  assert.equal(go.actionFailureChance(f),62.5);assert.equal(go.residualDamage(f,effects.get('paralysis')),0);
  for(const chance of [20,33.3,0,100]) assert.equal(go.actionFailureChance({...f,statuses:[{definition:{...effects.get('paralysis'),action_failure_chance:chance},turns:5}]}),chance);
  const zero={...effects.get('paralysis'),action_failure_chance:0};f.statuses=[{definition:zero,turns:5}];b.random=()=>{throw Error('RNG must not run');};go.changeEnergy(f,3);
  assert.ok(go.resolveTurn(b,{player:use('attack'),enemy:wait}).events.some(e=>e.type==='move'));
});

test('failed action text uses CSV status names and clearly reports no EN expense',()=>{
  const text=get('describeGeneOrderEvent')({type:'action-failed',actor:'Test',move:'Attack',statuses:['麻痺'],chance:25});
  assert.match(text,/麻痺/);assert.match(text,/EN消費なし/);
});

test('paralysis prevents special-switch selection and decoy HP costs before any request is yielded',()=>{
  for(const id of ['skill_041','skill_042']) {
    const move=skills.get(id);const b=make({moves:[move],player:[base({skillIds:[id]}),base({name:'Bench'})],manualSwitches:true,random:()=>0});const f=active(b);go.changeEnergy(f,6);attach(f,'paralysis');
    const turn=go.resolveTurn(b,{player:use(id),enemy:wait});
    assert.equal(turn.pendingSwitch,null);assert.equal(f.hp,200);assert.equal(f.energy,7);assert.equal(f.decoy,null);
    assert.equal(turn.events.some(e=>e.type==='action-failed'),true);assert.equal(b.active.player,0);
  }
});

test('failed common dodge does not roll evasion or activate a dodge-action passive',()=>{
  let calls=0;const move=skills.get('skill_000');const b=make({moves:[move],player:[base({passive_id:'passive_021',skillIds:[]})],random:()=>{calls++;return 0;}});attach(active(b),'paralysis');
  const turn=go.resolveTurn(b,{player:use(move.skill_id),enemy:wait});
  assert.equal(calls,1);assert.equal(turn.events.some(e=>['dodge-attempt','passive'].includes(e.type)),false);
  assert.equal(active(b).stages.phy_def,0);
});

test('AI/public speed prediction and actual action ordering both use the status speed multiplier',()=>{
  const move={...strike,cost:0};const b=make({moves:[move],player:[base({speed:120})],enemy:[base({speed:100,hp:2000})],random:()=>.99});attach(active(b),'paralysis');
  const board=ai.observe(b,'player',{revealFixedMoves:true});assert.equal(go.effectiveSpeed(board,'player'),60);assert.equal(go.effectiveSpeed(board,'enemy'),100);
  const turn=go.resolveTurn(b,{player:use('attack'),enemy:use('attack')});
  assert.deepEqual(Array.from(turn.events.filter(e=>e.type==='move'),e=>e.side),['enemy','player']);
});
