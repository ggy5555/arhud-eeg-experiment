import test from 'node:test';
import assert from 'node:assert/strict';
import {createSchedule} from '../js/protocol.js';
import {groupedCrossValidation,recommendFromPast} from '../js/model.js';

function mockData(){
  const schedule=createSchedule(123,'MAIN'),features={},blocks=schedule.map((p,i)=>{
    const trials=p.trials.map((t,k)=>({...t,response:k%6===0?null:(t.truth?'O':'X'),correct:k%6!==0,rt_ms:k%6===0?null:300+i*5+k,reveals:[]}));
    features[String(p.index)]={log_theta_alpha:Math.sin(i/3)};
    return {index:p.index,round:p.round,condition:p.condition,difficulty:p.difficulty,layout:p.layout,status:'complete',flags:[],trials,rating:2+(i%7)};
  });return {blocks,features};
}
test('round-held-out evaluation compares models on identical valid blocks',()=>{
  const {blocks,features}=mockData(),r=groupedCrossValidation(blocks,features);
  assert.equal(r.eligible_blocks,24);assert.equal(r.predictions.length,24);assert.equal(r.skipped.length,0);
  assert.ok(Number.isFinite(r.mae.model_a)&&Number.isFinite(r.mae.model_b));
  for(const p of r.predictions)for(const k of ['baseline','model_a','model_b'])assert.ok(p[k]>=0&&p[k]<=10);
  const changed=structuredClone(blocks);for(const b of changed)if(b.round===2)b.rating=10;
  const r2=groupedCrossValidation(changed,features);
  for(const p of r.predictions.filter(x=>x.round===2)){
    const q=r2.predictions.find(x=>x.index===p.index);assert.equal(p.model_a,q.model_a);assert.equal(p.model_b,q.model_b);
  }
});
test('no valid EEG or interrupted blocks are silently used; tiny data do not fit a model',()=>{
  const {blocks,features}=mockData();delete features['1'];blocks[1].status='interrupted';blocks[2].flags=['탭 비활성화'];
  const r=groupedCrossValidation(blocks.slice(0,8),features);assert.equal(r.predictions.length,0);assert.equal(r.mae,null);
  assert.throws(()=>recommendFromPast(blocks,features,4,'eeg',7),/부족/);
});
test('next-screen demonstration trains strictly before its selected source block',()=>{
  const {blocks,features}=mockData(),r=recommendFromPast(blocks,features,24,'eeg',7);
  assert.equal(r.training_count,23);assert.ok(r.training_indices.every(i=>i<24));assert.ok(['compact','detailed'].includes(r.layout));
  assert.throws(()=>recommendFromPast(blocks,features,24,'eeg',11),/기준/);
});
