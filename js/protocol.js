/** The pre-pilot candidate protocol; values must be rechecked before real use. */
export const PROTOCOL_VERSION = 'workload-hud-pilot-2026-11-09';
export const CONDITION_ORDER = [
  { id: 'easy_compact', difficulty: 'easy', layout: 'compact', label: '쉬운 과제 · 간결 화면' },
  { id: 'easy_detailed', difficulty: 'easy', layout: 'detailed', label: '쉬운 과제 · 상세 화면' },
  { id: 'hard_compact', difficulty: 'hard', layout: 'compact', label: '어려운 과제 · 간결 화면' },
  { id: 'hard_detailed', difficulty: 'hard', layout: 'detailed', label: '어려운 과제 · 상세 화면' },
];
export const STATUS_NAMES = ['A', 'B', 'C', 'D'];
export const TRIAL_MS = 3000;
export const REVEAL_MS = 1500;

export function seedFor(input) {
  let h = 2166136261;
  for (const char of String(input)) { h ^= char.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function rngFor(seed) {
  let x = seed >>> 0;
  return () => {
    x += 0x6D2B79F5;
    let t = x;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export function shuffle(values, rng) {
  const a = [...values];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const pickInt = (rng, low, high) => low + Math.floor(rng() * (high - low + 1));

function makeMath(rng, difficulty, delta, used) {
  for (let attempt = 0; attempt < 5000; attempt++) {
    const a = pickInt(rng, 10, 89);
    const b = pickInt(rng, 10, 89);
    const sum = a + b;
    const carry = (a % 10) + (b % 10) >= 10;
    const shown = sum + delta;
    const key = `${a}+${b}`;
    if (sum > 99 || shown < 10 || shown > 99 || carry !== (difficulty === 'hard') || used.has(key)) continue;
    used.add(key);
    return { kind: 'math', a, b, shown, truth: delta === 0, carry, delta };
  }
  throw new Error('산수 문항을 만들지 못했습니다.');
}

export function createTrials(condition, seed) {
  const rng = rngFor(seed);
  const deltas = shuffle([0,0,0,0,0,0,0,0,-1,-1,1,1,-10,-10,10,10], rng);
  const answers = shuffle([true, true, false, false], rng);
  const targets = shuffle(STATUS_NAMES, rng);
  const used = new Set();
  const trials = [];
  for (let cycle = 0; cycle < 4; cycle++) {
    const states = Object.fromEntries(STATUS_NAMES.map(name => [name, rng() < .5 ? '주의' : '정상']));
    const target = targets[cycle];
    states[target] = answers[cycle] ? '주의' : '정상';
    for (let n = 0; n < 4; n++) {
      trials.push({ ...makeMath(rng, condition.difficulty, deltas[cycle * 4 + n], used), cycle, states });
    }
    trials.push({ kind:'status', target, truth: answers[cycle], cycle, states });
  }
  return trials;
}

export function createSchedule(seed, mode = 'MAIN') {
  if (!['MAIN','PILOT','QA'].includes(mode)) throw new Error('실험 유형이 올바르지 않습니다.');
  const rounds = mode === 'MAIN' ? 6 : 1;
  const rng = rngFor(seed);
  const schedule = [];
  for (let round = 1; round <= rounds; round++) {
    const conditions = shuffle(CONDITION_ORDER, rng);
    for (let place = 0; place < conditions.length; place++) {
      const condition = conditions[place];
      const index = schedule.length + 1;
      schedule.push({
        index, round, condition: condition.id, difficulty: condition.difficulty,
        layout: condition.layout, label: condition.label,
        trials: createTrials(condition, seedFor(`${seed}:${round}:${condition.id}`)),
      });
    }
  }
  return schedule;
}

export function retryTrials(plan, seed, attempt) {
  return createTrials(plan, seedFor(`${seed}:${plan.index}:${attempt}:retry`));
}
export function median(numbers) {
  const a = numbers.filter(Number.isFinite).sort((x,y) => x-y);
  if (!a.length) return null;
  const i = Math.floor(a.length / 2);
  return a.length % 2 ? a[i] : (a[i-1] + a[i]) / 2;
}
export function summarizeTrials(trials) {
  const subset = kind => trials.filter(x => x.kind === kind);
  const correct = ts => ts.filter(x => x.correct === true);
  const summarize = ts => ({
    presented: ts.length,
    correct: correct(ts).length,
    unanswered: ts.filter(x => x.response === null || x.response === undefined).length,
    accuracy: ts.length ? correct(ts).length / ts.length : null,
    median_correct_rt_ms: median(correct(ts).map(x => x.rt_ms)),
  });
  return { math: summarize(subset('math')), status: summarize(subset('status')),
    reveal_count: trials.reduce((n,t) => n + (t.reveals?.length || 0), 0) };
}
export function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"','""')}"` : text;
}
export function toCSV(columns, rows) {
  return '\ufeff' + [columns.map(csvEscape).join(','), ...rows.map(row => columns.map(c => csvEscape(row[c])).join(','))].join('\r\n') + '\r\n';
}
