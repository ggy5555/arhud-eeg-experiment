import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMeasureWizCSV,mergeEEG,extractBandFeature} from '../js/eeg.js';

test('MeasureWiz metadata, sample order and markers are preserved',()=>{
  const file=parseMeasureWizCSV('#RecordType,EEG\r\n#Frequency,512\r\nVoltage(µV),Time,State,Quality\r\n10,3,,100\r\n20,2,trigger point,0\r\n30,1,,100\r\n','a.csv');
  assert.equal(file.frequency,512);assert.deepEqual([...file.samples],[10,20,30]);
  assert.deepEqual(file.markers.map(m=>m.sample),[1]);assert.equal(file.quality[1],0);
  const joined=mergeEEG([file,file]);assert.equal(joined.samples.length,6);assert.deepEqual(joined.markers.map(m=>m.sample),[1,4]);
  assert.throws(()=>mergeEEG([file,{...file,frequency:500}]),/주파수/);
});

function makeSignal(theta,alpha){
  const fs=512,n=fs*60+1,samples=new Float64Array(n),quality=new Float64Array(n);quality.fill(100);
  for(let i=0;i<n;i++)samples[i]=theta*Math.sin(2*Math.PI*6*i/fs)+alpha*Math.sin(2*Math.PI*10*i/fs);
  return {frequency:fs,samples,quality,markers:[{sample:0},{sample:n-1}]};
}
test('Welch power tracks known synthetic sine amplitudes and needs unique valid time',()=>{
  const highTheta=extractBandFeature(makeSignal(20,5),1,2,{thresholdUv:100});
  const highAlpha=extractBandFeature(makeSignal(5,20),1,2,{thresholdUv:100});
  assert.ok(highTheta.theta_power/highTheta.alpha_power>10);
  assert.ok(highAlpha.theta_power/highAlpha.alpha_power<.1);
  assert.ok(highTheta.valid_seconds>=30);assert.ok(highTheta.valid_windows>0);
  const bad=makeSignal(20,5);bad.quality.fill(0);
  assert.throws(()=>extractBandFeature(bad,1,2),/유효 EEG/);
});
test('one trigger or incompatible duration cannot produce a block feature',()=>{
  const one=makeSignal(20,5);one.markers.pop();assert.throws(()=>extractBandFeature(one,1,2),/트리거/);
  const bad=makeSignal(20,5);bad.markers[1].sample=512*40;assert.throws(()=>extractBandFeature(bad,1,2),/60초/);
});
