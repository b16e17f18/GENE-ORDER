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







const swap=skills.get('skill_116'),gp=get('geneOrderPassives');
const snapshot=value=>JSON.stringify(value,(_,v)=>v instanceof Map?[...v]:v);
const values=(a,t)=>['phy_def','sp_def'].map(stat=>go.statValue(a,stat,{opponent:t}));
function match({move=swap,enemy,player,...rest}={}){return make({moves:[move,{...strike,cost:0}],player:player??[base({name:'自分',phy_def:173,sp_def:74,skillIds:[move.skill_id,'attack']}),base({character_id:'bench'})],enemy:enemy??[base({name:'相手',character_id:'foe',hp:2000,phy_def:80,sp_def:140,skillIds:['attack']})],...rest});}
const cast=(b,move=swap)=>go.resolveTurn(b,{player:use(move.skill_id),enemy:wait});
const single=target=>({...swap,skill_id:'single_'+target,effect_target1:target,effect2:'none',effect_chance2:0});
function modifier(f,stat,value){const p=gp.normalize({passive_id:'fixture',name:'補正',passive_type1:'conditional_stat_multiplier',target_id1:stat,value1:String(value),condition1:''},elements,statusIds,types);assert.equal(p.status,'implemented');f.passive=p;f.passiveEffects=p.effects;}

test('official skill116 uses independent internal swaps and retains element/EN/priority',()=>{assert.equal(go.effectKind(effects.get('swap_defense_stats')),'stat-swap');assert.equal(go.effectKind(effects.get('swap_defenses')),'stat-exchange');assert.equal(swap.effect1,'swap_defense_stats');assert.equal(swap.effect2,'swap_defense_stats');assert.equal(swap.effect_target1,'enemy');assert.equal(swap.effect_target2,'self');assert.equal(swap.effect_chance1,100);assert.equal(swap.effect_chance2,100);assert.equal(swap.element,'light');assert.equal(swap.cost,0);assert.equal(swap.priority,1);assert.equal(go.moveAvailability(swap,{effects,battleEffects:defenses}).issues.length,0);});
test('173/74 -> 74/173 and 80/140 -> 140/80, without individual-to-individual transfer',()=>{const b=match(),a=active(b),t=active(b,'enemy'),before=snapshot([a.base,t.base,a.stages,t.stages]),hp=[a.hp,t.hp],en=[a.energy,t.energy];const out=cast(b);assert.deepEqual(values(a,t),[74,173]);assert.deepEqual(values(t,a),[140,80]);assert.deepEqual([a.hp,t.hp],hp);assert.deepEqual([a.energy,t.energy],en);assert.equal(snapshot([a.base,t.base,a.stages,t.stages]),before);const ev=out.events.filter(e=>e.type==='stat-swapped');assert.equal(ev.length,2);assert.equal(out.events.some(e=>e.type==='stat-exchanged'),false);for(const e of ev){assert.equal(e.source,e.actor);assert.equal(get('describeGeneOrderEvent')(e),e.actor+'の物理防御と特殊防御が入れ替わった！');}});
for(const target of ['self','enemy'])test('one slot swaps only the selected individual: '+target,()=>{const m=single(target),b=match({move:m});cast(b,m);assert.deepEqual(values(active(b),active(b,'enemy')),target==='self'?[74,173]:[173,74]);assert.deepEqual(values(active(b,'enemy'),active(b)),target==='enemy'?[140,80]:[80,140]);});
test('existing ranks, passive and status are included once; later changes remain dynamic',()=>{const b=match(),a=active(b);a.base={...a.base,phy_def:100,sp_def:80};a.stages.phy_def=2;a.stages.sp_def=-2;modifier(a,'pd',1.5);a.statuses.push({definition:{effect_id:'fixture',effect_group:'status',stat_modifier_target:'phy_def',stat_modifier_multiplier:.5},turns:4});assert.deepEqual(values(a,active(b,'enemy')),[150,40]);cast(b);assert.deepEqual(values(a,active(b,'enemy')),[40,150]);assert.equal(a.stages.phy_def,2);assert.equal(a.stages.sp_def,-2);a.statuses=[];assert.equal(go.statValue(a,'phy_def'),80);a.stages.sp_def=0;assert.equal(go.statValue(a,'sp_def'),300);});
test('a second use swaps the current values back when modifiers have not changed',()=>{const b=match();cast(b);cast(b);assert.deepEqual(values(active(b),active(b,'enemy')),[173,74]);assert.deepEqual(values(active(b,'enemy'),active(b)),[80,140]);});
test('duplicate slots for the same recipient do not undo the swap within one use',()=>{const m={...swap,effect_target1:'self',effect_target2:'self'},b=match({move:m});cast(b,m);assert.deepEqual(values(active(b),active(b,'enemy')),[74,173]);assert.deepEqual(values(active(b,'enemy'),active(b)),[80,140]);});
test('independent self/enemy order does not change live values or AI score',()=>{const reverse={...swap,effect1:swap.effect2,effect_target1:'self',effect2:swap.effect1,effect_target2:'enemy'},a=match(),b=match({move:reverse});const score=x=>ai.evaluate(ai.observe(x,'player',{revealFixedMoves:true})).find(c=>c.action.moveId===swap.skill_id).score;assert.equal(score(a),score(b));cast(a);cast(b,reverse);for(const side of ['player','enemy'])assert.deepEqual(values(active(a,side),active(a,side==='player'?'enemy':'player')),values(active(b,side),active(b,side==='player'?'enemy':'player')));});
test('slot chances are independent and do not consume RNG at 0/100 percent',()=>{let n=0;const m={...swap,effect_chance1:0},b=match({move:m,random:()=>{n++;return .9;}});cast(b,m);assert.equal(n,0);assert.deepEqual(values(active(b),active(b,'enemy')),[74,173]);assert.deepEqual(values(active(b,'enemy'),active(b)),[80,140]);});
test('normal switch removes only that individual temporary swap',()=>{const b=match(),a=active(b),t=active(b,'enemy');cast(b);go.resolveTurn(b,{player:{type:'switch',index:1},enemy:wait});assert.equal(a.statExchange,null);assert.deepEqual(values(a,t),[173,74]);assert.deepEqual(values(t,a),[140,80]);assert.equal(active(b).statExchange,undefined);});
test('Power Relay does not transfer the internal swap',()=>{const relay=[...skills.values()].find(m=>go.moveEffects(m).some(e=>go.battleEffectKind(defenses.get(e.id))==='relay')),m={...relay,cost:0},b=match(),a=active(b);b.skills.set(m.skill_id,m);a.base={...a.base,skillIds:[swap.skill_id,m.skill_id]};cast(b);a.stages.phy_atk=2;go.resolveTurn(b,{player:{...use(m.skill_id),switchIndex:1},enemy:wait});assert.equal(a.statExchange,null);assert.equal(active(b).statExchange,undefined);assert.equal(active(b).stages.phy_atk,2);});
test('fainting clears the swap and leaves the other individual swap intact',()=>{const b=match(),a=active(b),t=active(b,'enemy');cast(b);a.hp=1;t.energy=7;go.resolveTurn(b,{player:wait,enemy:use('attack')});assert.equal(a.fainted,true);assert.equal(a.statExchange,null);assert.deepEqual(values(t,active(b)),[140,80]);});
test('field clearing does not remove the individual swap',()=>{const m={...single('enemy'),skill_id:'clear',effect1:'clear_field'},b=match();b.skills.set(m.skill_id,m);active(b).base={...active(b).base,skillIds:[swap.skill_id,m.skill_id]};cast(b);cast(b,m);assert.deepEqual(values(active(b,'enemy'),active(b)),[140,80]);});
test('generic pair definitions reject HP, duplicates, extra stats and lasting turns',()=>{const e=effects.get('swap_defense_stats');for(const patch of [{target_stat:'hp|phy_def'},{target_stat:'phy_def|phy_def'},{target_stat:'phy_def'},{target_stat:'phy_atk|phy_def|sp_def'},{turn:3}])assert.equal(go.effectKind({...e,...patch}),null);assert.equal(go.effectKind({...e,target_stat:'phy_atk|sp_atk'}),'stat-swap');assert.ok(go.moveAvailability({...swap,category:'attack',power:20,attack_type:'physical'},{effects,battleEffects:defenses}).issues.length);});
test('AI uses the internal swap predictor without mutating state or battle RNG',()=>{let n=0;const b=match({random:()=>{n++;return .9;}}),before=snapshot(b),old=go.previewStatSwap,seen=[];go.previewStatSwap=(...args)=>{const p=old(...args);seen.push(p);return p;};try{const r=ai.choose(ai.observe(b,'player',{revealFixedMoves:true}),{random:()=>.4});assert.ok(r.candidates.some(c=>c.action.moveId===swap.skill_id));assert.ok(seen.length>=2);assert.equal(r.candidates.every(c=>Number.isFinite(c.score)),true);}finally{go.previewStatSwap=old;}assert.equal(n,0);assert.equal(snapshot(b),before);assert.ok(seen.some(p=>values(p.defender,p.actor).join(',')==='140,80'));assert.ok(seen.some(p=>values(p.actor,p.defender).join(',')==='74,173'));});
for(const attack_type of ['physical','special'])test('post-swap AI observation, preview and live damage agree: '+attack_type,()=>{const hit={...strike,cost:0,attack_type},b=match();b.skills.set(hit.skill_id,hit);cast(b);const obs=ai.observe(b,'enemy',{revealFixedMoves:true});assert.equal(go.previewDamage(obs,'enemy',hit).actualDamage,go.previewDamage(b,'enemy',hit).actualDamage);const p=go.previewDamage(b,'enemy',hit);const out=go.resolveTurn(b,{player:wait,enemy:use(hit.skill_id)});assert.equal(out.events.find(e=>e.type==='move'&&e.side==='enemy').actualDamage,p.actualDamage);});


test('generic PA-SA pair swaps within the target and leaves defenses alone',()=>{const e={...effects.get('swap_defense_stats'),effect_id:'fixture_pair',target_stat:'phy_atk|sp_atk'},m={...single('self'),effect1:e.effect_id},b=match({move:m}),a=active(b);b.effects=new Map(b.effects).set(e.effect_id,e);const before=values(a,active(b,'enemy'));cast(b,m);assert.equal(go.statValue(a,'phy_atk'),160);assert.equal(go.statValue(a,'sp_atk'),120);assert.deepEqual(values(a,active(b,'enemy')),before);});
test('enemy status-move immunity prevents only the enemy swap',()=>{const b=match(),t=active(b,'enemy'),p=gp.normalize({passive_id:'block',name:'block',passive_type1:'hostile_status_move_immunity',target_id1:'none',value1:'1'},elements,statusIds,types);assert.equal(p.status,'implemented');t.passive=p;t.passiveEffects=p.effects;cast(b);assert.deepEqual(values(active(b),t),[74,173]);assert.deepEqual(values(t,active(b)),[80,140]);});
