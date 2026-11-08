import test from 'node:test';
import assert from 'node:assert/strict';
import {createSchedule,createTrials,CONDITION_ORDER,seedFor,summarizeTrials,toCSV} from '../js/protocol.js';

test('six balanced rounds, reproducible schedule and stable trial constraints',()=>{
  const a=createSchedule(seedFor('P001:S01'),'MAIN'),b=createSchedule(seedFor('P001:S01'),'MAIN');
  assert.deepEqual(a,b);assert.equal(a.length,24);
  for(let round=1;round<=6;round++){
    const blocks=a.filter(x=>x.round===round);assert.equal(blocks.length,4);
    assert.deepEqual(blocks.map(x=>x.condition).sort(),CONDITION_ORDER.map(x=>x.id).sort());
    for(const block of blocks){
      assert.equal(block.trials.length,20);
      const math=block.trials.filter(t=>t.kind==='math'),status=block.trials.filter(t=>t.kind==='status');
      assert.equal(math.length,16);assert.equal(status.length,4);
      assert.equal(math.filter(t=>t.truth).length,8);assert.equal(status.filter(t=>t.truth).length,2);
      assert.deepEqual(status.map(t=>t.target).sort(),['A','B','C','D']);
      for(const t of math){assert.equal(t.a+t.b===t.shown,t.truth);assert.equal((t.a%10+t.b%10)>=10,block.difficulty==='hard');assert.ok(t.shown>=10&&t.shown<=99);}
      for(const t of status)assert.equal(t.states[t.target]==='주의',t.truth);
      for(let cycle=0;cycle<4;cycle++)assert.deepEqual(block.trials.slice(cycle*5,cycle*5+5).map(t=>t.kind),['math','math','math','math','status']);
    }
  }
  assert.equal(createSchedule(12,'PILOT').length,4);
  assert.equal(createSchedule(12,'QA').length,4);
});

test('unanswered trials count as errors and response median uses correct answers only',()=>{
  const trials=[{kind:'math',correct:true,response:'O',rt_ms:300,reveals:[]},{kind:'math',correct:true,response:'X',rt_ms:500,reveals:[]},{kind:'math',correct:false,response:'O',rt_ms:10,reveals:[]},{kind:'status',correct:false,response:null,rt_ms:null,reveals:[{},{}]}];
  const s=summarizeTrials(trials);assert.equal(s.math.accuracy,2/3);assert.equal(s.math.median_correct_rt_ms,400);assert.equal(s.status.unanswered,1);assert.equal(s.status.accuracy,0);assert.equal(s.reveal_count,2);
});

test('CSV preserves quotes, commas and Korean in a single field',()=>{
  const text=toCSV(['a','b'],[{a:'한글, 문장',b:'따옴표 "확인"'}]);
  assert.ok(text.startsWith('\ufeffa,b\r\n'));assert.ok(text.includes('"한글, 문장","따옴표 ""확인"""'));
});
