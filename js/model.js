import {summarizeTrials} from './protocol.js';

const mean = a => a.reduce((x,y)=>x+y,0)/a.length;
const median = a => {const v=[...a].sort((x,y)=>x-y),i=Math.floor(v.length/2);return v.length?(v.length%2?v[i]:(v[i-1]+v[i])/2):0;};
const clip = x => Math.min(10,Math.max(0,x));
const FEATURE_NAMES=['difficulty','layout','interaction','math_accuracy','math_rt','status_accuracy','status_rt'];

function observation(block,feature) {
  if(block.status!=='complete'||(block.flags?.length??0)>0||!Array.isArray(block.trials)||block.trials.length!==20||!Number.isFinite(block.rating)||block.rating<0||block.rating>10||!Number.isFinite(feature?.log_theta_alpha))return null;
  const m=summarizeTrials(block.trials),d=block.difficulty==='hard'?1:0,l=block.layout==='detailed'?1:0;
  if(m.math.presented!==16||m.status.presented!==4)return null;
  return {index:block.index,round:block.round,condition:block.condition,rating:block.rating,
    values:[d,l,d*l,m.math.accuracy,m.math.median_correct_rt_ms,m.status.accuracy,m.status.median_correct_rt_ms],
    eeg:feature.log_theta_alpha};
}
export function buildObservations(blocks,features) {
  return blocks.map(block=>observation(block,features[String(block.index)])).filter(Boolean);
}
export function enoughTraining(rows) {
  const counts=Object.fromEntries(['easy_compact','easy_detailed','hard_compact','hard_detailed'].map(key=>[key,0]));
  for(const r of rows)if(Object.hasOwn(counts,r.condition))counts[r.condition]++;
  return {ok:rows.length>=16&&Object.values(counts).every(x=>x>=3),total:rows.length,counts};
}
function solve(a,b) {
  const n=b.length,m=a.map((row,i)=>[...row,b[i]]);
  for(let c=0;c<n;c++){
    let best=c;for(let r=c+1;r<n;r++)if(Math.abs(m[r][c])>Math.abs(m[best][c]))best=r;
    if(Math.abs(m[best][c])<1e-12)throw new Error('회귀 행렬을 계산할 수 없습니다.');
    [m[c],m[best]]=[m[best],m[c]];const pivot=m[c][c];
    for(let j=c;j<=n;j++)m[c][j]/=pivot;
    for(let r=0;r<n;r++)if(r!==c){const factor=m[r][c];for(let j=c;j<=n;j++)m[r][j]-=factor*m[c][j];}
  }
  return m.map(row=>row[n]);
}
function vector(row,useEEG){return useEEG?[...row.values,row.eeg]:[...row.values];}

/** Train-only imputation and normalization; output values are on the 0–10 scale. */
export function fitRidge(rows,useEEG,lambda=1) {
  if(!rows.length||!Number.isFinite(lambda)||lambda<=0)throw new Error('학습 자료 또는 규제값이 잘못되었습니다.');
  const raw=rows.map(row=>vector(row,useEEG)),p=raw[0].length;
  const impute=Array.from({length:p},(_,j)=>median(raw.map(x=>x[j]).filter(Number.isFinite)));
  const clean=raw.map(row=>row.map((v,j)=>Number.isFinite(v)?v:impute[j]));
  const centers=Array.from({length:p},(_,j)=>mean(clean.map(x=>x[j])));
  const scales=Array.from({length:p},(_,j)=>{
    const sd=Math.sqrt(mean(clean.map(x=>(x[j]-centers[j])**2)));return sd>1e-12?sd:1;
  });
  const X=clean.map(row=>[1,...row.map((v,j)=>(v-centers[j])/scales[j])]);
  const A=Array.from({length:p+1},()=>new Array(p+1).fill(0)),b=new Array(p+1).fill(0);
  for(let i=0;i<rows.length;i++)for(let j=0;j<=p;j++){
    b[j]+=X[i][j]*rows[i].rating;
    for(let k=0;k<=p;k++)A[j][k]+=X[i][j]*X[i][k];
  }
  for(let j=1;j<=p;j++)A[j][j]+=lambda;
  const coefficients=solve(A,b);
  return {useEEG,lambda,features:useEEG?[...FEATURE_NAMES,'log_theta_alpha']:FEATURE_NAMES,
    impute,centers,scales,coefficients,training_count:rows.length};
}
export function predict(model,row) {
  const v=vector(row,model.useEEG).map((x,j)=>Number.isFinite(x)?x:model.impute[j]);
  return clip(model.coefficients[0]+v.reduce((sum,x,j)=>sum+model.coefficients[j+1]*(x-model.centers[j])/model.scales[j],0));
}

export function groupedCrossValidation(blocks,features) {
  const rows=buildObservations(blocks,features);
  const rounds=[...new Set(rows.map(x=>x.round))].sort((a,b)=>a-b), predictions=[],skipped=[];
  for(const round of rounds) {
    const train=rows.filter(x=>x.round!==round),test=rows.filter(x=>x.round===round),gate=enoughTraining(train);
    if(!gate.ok){skipped.push({round,reason:'학습 유효 블록 16개 이상 및 네 조건 각 3개 이상 필요',...gate});continue;}
    const modelA=fitRidge(train,false),modelB=fitRidge(train,true),constant=mean(train.map(x=>x.rating));
    for(const row of test)predictions.push({index:row.index,round,condition:row.condition,actual:row.rating,
      baseline:clip(constant),model_a:predict(modelA,row),model_b:predict(modelB,row)});
  }
  if(!predictions.length)return {eligible_blocks:rows.length,predictions,skipped,mae:null};
  const error=key=>mean(predictions.map(row=>Math.abs(row[key]-row.actual)));
  const mae={baseline:error('baseline'),model_a:error('model_a'),model_b:error('model_b')};
  return {eligible_blocks:rows.length,predictions,skipped,mae,delta_a_minus_b:mae.model_a-mae.model_b};
}

/** Optional demonstration: fit only on records chronologically before the selected source block. */
export function recommendFromPast(blocks,features,sourceIndex,policy,threshold=7) {
  if(!['behavior','eeg','self_report'].includes(policy)||!Number.isFinite(threshold)||threshold<0||threshold>10)
    throw new Error('정책 또는 기준 점수를 확인해 주세요.');
  const rows=buildObservations(blocks,features).sort((a,b)=>a.index-b.index),source=rows.find(r=>r.index===sourceIndex);
  if(!source)throw new Error('선택한 블록의 행동·자기보고·유효 EEG가 모두 필요합니다.');
  const train=rows.filter(r=>r.index<sourceIndex),gate=enoughTraining(train);
  if(!gate.ok)throw new Error(`선택 블록 이전의 유효 학습 블록이 부족합니다: ${gate.total}개, 네 조건 각 3개 이상 필요.`);
  const model=policy==='self_report'?null:fitRidge(train,policy==='eeg');
  const score=policy==='self_report'?source.rating:predict(model,source);
  return {source_index:sourceIndex,policy,threshold,estimated_effort:score,
    layout:score>=threshold?'compact':'detailed',training_count:train.length,training_indices:train.map(r=>r.index),model};
}
