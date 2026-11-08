/** Local-only MeasureWiz CSV inspection and exploratory per-block spectral features. */

function parseRows(text) {
  const rows=[]; let row=[], field='', quoted=false;
  text=String(text).replace(/^\ufeff/,'');
  for(let i=0;i<text.length;i++) {
    const ch=text[i];
    if(quoted) {
      if(ch==='"' && text[i+1]==='"') { field+='"'; i++; }
      else if(ch==='"') quoted=false;
      else field+=ch;
    } else if(ch==='"' && field==='') quoted=true;
    else if(ch===',') { row.push(field); field=''; }
    else if(ch==='\n' || ch==='\r') {
      if(ch==='\r' && text[i+1]==='\n') i++;
      row.push(field); field=''; rows.push(row); row=[];
    } else field+=ch;
  }
  if(quoted) throw new Error('CSV 따옴표가 닫히지 않았습니다.');
  if(field!=='' || row.length) {row.push(field);rows.push(row);}
  return rows;
}
const numeric = value => {
  const x=String(value??'').trim();
  if(!x) return NaN;
  const n=Number(x); return Number.isFinite(n)?n:NaN;
};

export function parseMeasureWizCSV(text, filename='EEG.csv') {
  const rows=parseRows(text);let frequency=null, header=null, signalIndex=-1, stateIndex=-1, qualityIndex=-1;
  const samples=[], quality=[], markers=[];let malformed=0;
  for(const row of rows) {
    if(!row.some(v=>String(v).trim())) continue;
    const first=String(row[0]??'').trim();
    if(first.toLowerCase()==='#frequency') {frequency=numeric(row[1]);continue;}
    if(first.startsWith('#')) continue;
    if(!header) {
      const normalized=row.map(x=>String(x).trim().toLowerCase());
      signalIndex=normalized.findIndex(x=>/^voltage\s*\(/.test(x) || x==='voltage');
      if(signalIndex<0) continue;
      header=normalized;stateIndex=normalized.indexOf('state');qualityIndex=normalized.indexOf('quality');continue;
    }
    const value=numeric(row[signalIndex]);
    if(!Number.isFinite(value)) malformed++;
    const index=samples.length;
    samples.push(value);quality.push(qualityIndex>=0?numeric(row[qualityIndex]):NaN);
    const state=stateIndex>=0?String(row[stateIndex]??'').trim():'';
    if(/(^|\W)trigger[\s_-]*point(\W|$)/i.test(state)) markers.push({sample:index,state});
  }
  if(!header) throw new Error(`${filename}: Voltage 열을 찾지 못했습니다.`);
  if(!Number.isFinite(frequency)||frequency<=0) throw new Error(`${filename}: #Frequency 값을 확인할 수 없습니다.`);
  if(!samples.length) throw new Error(`${filename}: EEG 표본이 없습니다.`);
  return {filename,frequency,samples:Float64Array.from(samples),quality:Float64Array.from(quality),markers,malformed,hasQuality:qualityIndex>=0};
}

export function mergeEEG(files) {
  if(!files.length) throw new Error('EEG CSV 파일을 선택해 주세요.');
  const frequency=files[0].frequency;
  if(files.some(f=>f.frequency!==frequency)) throw new Error('파일마다 표본 주파수가 달라 연결할 수 없습니다.');
  const total=files.reduce((n,f)=>n+f.samples.length,0);
  const samples=new Float64Array(total),quality=new Float64Array(total),markers=[],parts=[];
  let at=0;
  for(const file of files) {
    samples.set(file.samples,at);quality.set(file.quality,at);
    for(const mark of file.markers) markers.push({sample:at+mark.sample,file:file.filename,file_sample:mark.sample});
    parts.push({filename:file.filename,start:at,count:file.samples.length,malformed:file.malformed,hasQuality:file.hasQuality});
    at+=file.samples.length;
  }
  return {frequency,samples,quality,markers,parts};
}

function biquad(input,fs,cutoff,type,q) {
  const w=2*Math.PI*cutoff/fs, c=Math.cos(w), alpha=Math.sin(w)/(2*q);
  const b0=(type==='high'?(1+c):(1-c))/2;
  const b1=type==='high'?-(1+c):(1-c);
  const b2=b0, a0=1+alpha, a1=-2*c, a2=1-alpha;
  const out=new Float64Array(input.length);let x1=0,x2=0,y1=0,y2=0;
  for(let i=0;i<input.length;i++) {
    const x=input[i],y=(b0*x+b1*x1+b2*x2-a1*y1-a2*y2)/a0;
    out[i]=y;x2=x1;x1=x;y2=y1;y1=y;
  }
  return out;
}
function filterBlock(data,fs) {
  const mean=data.reduce((a,b)=>a+b,0)/data.length;
  let output=Float64Array.from(data,x=>x-mean);
  for(const [type,cutoff] of [['high',1],['low',40]]) {
    for(const q of [.541196100146197,1.306562964876377]) {
      output=biquad(output,fs,cutoff,type,q);
      output.reverse();output=biquad(output,fs,cutoff,type,q);output.reverse();
    }
  }
  return output;
}
function fft(real,imag) {
  const n=real.length;
  for(let i=1,j=0;i<n;i++) {
    let bit=n>>1;for(;j&bit;bit>>=1) j^=bit;j^=bit;
    if(i<j){[real[i],real[j]]=[real[j],real[i]];[imag[i],imag[j]]=[imag[j],imag[i]];}
  }
  for(let len=2;len<=n;len<<=1) {
    const angle=-2*Math.PI/len,wr0=Math.cos(angle),wi0=Math.sin(angle);
    for(let i=0;i<n;i+=len) {
      let wr=1,wi=0;
      for(let j=0;j<len/2;j++) {
        const u=i+j,v=u+len/2,tr=wr*real[v]-wi*imag[v],ti=wr*imag[v]+wi*real[v];
        real[v]=real[u]-tr;imag[v]=imag[u]-ti;real[u]+=tr;imag[u]+=ti;
        const next=wr*wr0-wi*wi0;wi=wr*wi0+wi*wr0;wr=next;
      }
    }
  }
}
function uniqueCoverage(intervals) {
  if(!intervals.length)return 0;
  let total=0,[a,b]=intervals[0];
  for(const [x,y] of intervals.slice(1)) {
    if(x<=b)b=Math.max(b,y);else{total+=b-a;a=x;b=y;}
  }
  return total+b-a;
}

/** Window thresholds are pilot candidates, never a validation of neural origin. */
export function extractBandFeature(eeg,startOrdinal,endOrdinal,{trimSeconds=5,thresholdUv=150,minValidSeconds=30,maxMarkerMismatchSeconds=4}={}) {
  const fs=eeg.frequency;
  if(fs!==512) throw new Error(`현재 분석은 512Hz 파일만 지원합니다. 파일: ${fs}Hz`);
  if(!Number.isInteger(startOrdinal)||!Number.isInteger(endOrdinal)||startOrdinal<1||endOrdinal>eeg.markers.length||startOrdinal>=endOrdinal)
    throw new Error('시작·종료 트리거 번호를 순서대로 확인해 주세요.');
  const start=eeg.markers[startOrdinal-1].sample,end=eeg.markers[endOrdinal-1].sample;
  const markerDuration=(end-start)/fs;
  if(Math.abs(markerDuration-60)>maxMarkerMismatchSeconds)
    throw new Error(`트리거 간 ${markerDuration.toFixed(1)}초: 60초 블록과 차이가 커서 분석하지 않았습니다.`);
  if(!Number.isFinite(thresholdUv)||thresholdUv<=0)throw new Error('잡음 제외 기준을 확인해 주세요.');
  const from=start+Math.round(trimSeconds*fs),to=end-Math.round(trimSeconds*fs);
  const raw=eeg.samples.slice(from,to),quality=eeg.quality.slice(from,to);
  if(raw.length<minValidSeconds*fs) throw new Error('경계 제외 후 EEG가 30초보다 짧습니다.');
  if(raw.some(x=>!Number.isFinite(x))) throw new Error('구간에 읽을 수 없는 EEG 표본이 있어 분석하지 않았습니다.');
  const filtered=filterBlock(raw,fs),N=fs*4,step=N/2;
  const hann=Float64Array.from({length:N},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/(N-1)));
  const norm=fs*hann.reduce((sum,x)=>sum+x*x,0),df=fs/N;
  let theta=0,alpha=0,valid=0,rejected=0,unknownQualityWindows=0;
  const intervals=[];
  for(let fromWindow=0;fromWindow+N<=raw.length;fromWindow+=step) {
    let mean=0;for(let j=0;j<N;j++)mean+=raw[fromWindow+j];mean/=N;
    let maxAbs=0,badQuality=false,unknown=false;
    for(let j=0;j<N;j++) {
      maxAbs=Math.max(maxAbs,Math.abs(raw[fromWindow+j]-mean));
      const q=quality[fromWindow+j]; if(q===0)badQuality=true;if(!Number.isFinite(q))unknown=true;
    }
    if(unknown)unknownQualityWindows++;
    if(maxAbs>thresholdUv||badQuality){rejected++;continue;}
    let fmean=0;for(let j=0;j<N;j++)fmean+=filtered[fromWindow+j];fmean/=N;
    const re=new Float64Array(N),im=new Float64Array(N);
    for(let j=0;j<N;j++)re[j]=(filtered[fromWindow+j]-fmean)*hann[j];
    fft(re,im);
    let tp=0,ap=0;
    for(let k=1;k<=N/2;k++) {
      const hz=k*df;if(hz>12)break;
      const power=(re[k]*re[k]+im[k]*im[k])*(k===N/2?1:2)/norm*df;
      if(hz>=4&&hz<8)tp+=power;
      if(hz>=8&&hz<=12)ap+=power;
    }
    theta+=tp;alpha+=ap;valid++;intervals.push([fromWindow,fromWindow+N]);
  }
  const validSeconds=uniqueCoverage(intervals)/fs;
  if(validSeconds<minValidSeconds||!valid) throw new Error(`유효 EEG ${validSeconds.toFixed(1)}초: 최소 ${minValidSeconds}초가 필요합니다.`);
  theta/=valid;alpha/=valid;
  if(!Number.isFinite(theta)||!Number.isFinite(alpha)||theta<=0||alpha<=1e-12)
    throw new Error('대역 파워가 0이거나 비정상적이어서 비율을 계산하지 않았습니다.');
  return {theta_power:theta,alpha_power:alpha,log_theta_alpha:Math.log(theta/alpha),
    marker_start:startOrdinal,marker_end:endOrdinal,marker_duration_s:markerDuration,
    core_duration_s:raw.length/fs,valid_seconds:validSeconds,valid_windows:valid,rejected_windows:rejected,
    unknown_quality_windows:unknownQualityWindows,threshold_uv:thresholdUv,trim_seconds:trimSeconds,
    note:'표본 연속성과 두 트리거의 PC 시간차는 별도 파일럿에서 확인해야 함'};
}
