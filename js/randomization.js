import {
  CONDITIONS,
  CUE_DIRECTIONS,
  MASTER_SEED,
  POSITION_DEG,
  POSITION_DIRECTIONS,
  TIMING_MS,
  eccentricityFor,
  validateIdentifier,
} from "./config.js?v=20260915-web4";

export function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;
    let result = Math.imul(value ^ (value >>> 15), 1 | value);
    result = (result + Math.imul(result ^ (result >>> 7), 61 | result)) ^ result;
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function uint32(rng) {
  return Math.floor(rng() * 4294967296) >>> 0;
}

function shuffle(items, rng) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

export async function deriveParticipantSeed(participant, session, masterSeed = MASTER_SEED) {
  participant = validateIdentifier(participant, "participant ID");
  session = validateIdentifier(session, "session ID");
  const material = new TextEncoder().encode(`${Number(masterSeed)}|${participant}|${session}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", material));
  return new DataView(digest.buffer).getUint32(0, false);
}

function containsTriple(labels) {
  return labels.some((label, index) =>
    index >= 2 && label === labels[index - 1] && label === labels[index - 2]);
}

function shuffleBlock(rows, previous, rng) {
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const candidate = shuffle(rows, rng);
    if (!containsTriple([...previous.slice(-2), ...candidate.map((row) => row.condition)])) {
      return candidate;
    }
  }
  throw new Error("같은 위치 3회 연속을 피하는 순서를 만들지 못했습니다.");
}

export async function generateMainTrials(participant, session, participantSeed = null) {
  participant = validateIdentifier(participant, "participant ID");
  session = validateIdentifier(session, "session ID");
  const seed = participantSeed ?? await deriveParticipantSeed(participant, session);
  const rng = mulberry32(seed);
  const arrowOrder = shuffle(CUE_DIRECTIONS, rng);
  const prepared = [];

  for (let blockIndex = 0; blockIndex < 2; blockIndex += 1) {
    const block = [];
    CONDITIONS.forEach((condition, conditionIndex) => {
      for (let repetition = 0; repetition < 4; repetition += 1) {
        block.push({
          condition,
          cueDirection: arrowOrder[(conditionIndex + repetition) % 4],
          primarySame: (conditionIndex + blockIndex + repetition) % 2 === 0,
          itiMs: TIMING_MS.itiMin + rng() * (TIMING_MS.itiMax - TIMING_MS.itiMin),
          stimulusSeed: uint32(rng),
        });
      }
    });
    prepared.push(block);
  }

  const trials = [];
  const priorConditions = [];
  for (let blockIndex = 0; blockIndex < 2; blockIndex += 1) {
    const ordered = shuffleBlock(prepared[blockIndex], priorConditions, rng);
    ordered.forEach((row, localIndex) => {
      const trialNumber = trials.length + 1;
      trials.push({
        participant,
        session,
        block: blockIndex + 1,
        blockTrial: localIndex + 1,
        trial: trialNumber,
        trialId: `${participant}_${session}_B${String(blockIndex + 1).padStart(2, "0")}_T${String(trialNumber).padStart(3, "0")}`,
        condition: row.condition,
        eccentricity: eccentricityFor(row.condition),
        direction: POSITION_DIRECTIONS[row.condition],
        cueDirection: row.cueDirection,
        primarySame: row.primarySame,
        itiMs: row.itiMs,
        seed,
        stimulusSeed: row.stimulusSeed,
        phase: "main",
      });
    });
    priorConditions.push(...ordered.map((row) => row.condition));
  }
  validateMainSchedule(trials);
  return trials;
}

export async function generatePilotTrials(participant, session, participantSeed = null) {
  participant = validateIdentifier(participant, "participant ID");
  session = validateIdentifier(session, "session ID");
  const seed = participantSeed ?? await deriveParticipantSeed(participant, session);
  const rng = mulberry32((seed ^ 0x50494c4f) >>> 0);
  const cues = shuffle([...CUE_DIRECTIONS, ...shuffle(CUE_DIRECTIONS, rng).slice(0, 2)], rng);
  const same = shuffle([true, true, true, false, false, false], rng);
  const conditions = shuffle(CONDITIONS, rng);
  const trials = conditions.map((condition, index) => ({
    participant,
    session,
    block: 1,
    blockTrial: index + 1,
    trial: index + 1,
    trialId: `${participant}_${session}_PILOT_T${String(index + 1).padStart(3, "0")}`,
    condition,
    eccentricity: eccentricityFor(condition),
    direction: POSITION_DIRECTIONS[condition],
    cueDirection: cues[index],
    primarySame: same[index],
    itiMs: TIMING_MS.itiMin + rng() * (TIMING_MS.itiMax - TIMING_MS.itiMin),
    seed,
    stimulusSeed: uint32(rng),
    phase: "main",
  }));
  validatePilotSchedule(trials);
  return trials;
}

export function generateNBackTrials(level, seed) {
  if (![0, 2].includes(level)) throw new Error("n-back level은 0 또는 2여야 합니다.");
  const rng = mulberry32((seed ^ (level === 0 ? 0x0bac0000 : 0x2bac0000)) >>> 0);
  const digits = [];
  const rows = [];
  for (let index = 0; index < 15; index += 1) {
    let isTarget = level === 0 ? rng() < 0.3 : index >= 2 && rng() < 0.3;
    let digit;
    if (level === 0) {
      digit = isTarget ? 0 : 1 + Math.floor(rng() * 9);
    } else if (isTarget) {
      digit = digits[index - 2];
    } else {
      const forbidden = index >= 2 ? digits[index - 2] : null;
      do digit = Math.floor(rng() * 10); while (digit === forbidden);
    }
    digits.push(digit);
    rows.push({ index: index + 1, digit, isTarget });
  }
  return rows;
}

export function validateMainSchedule(trials) {
  const errors = [];
  if (trials.length !== 48) errors.push(`48 trials가 아님: ${trials.length}`);
  if (new Set(trials.map((trial) => trial.trialId)).size !== trials.length) errors.push("trial ID 중복");
  if (containsTriple(trials.map((trial) => trial.condition))) errors.push("같은 위치 3회 연속");
  if (trials.filter((trial) => trial.primarySame).length !== 24) errors.push("SAME/DIFFERENT 전체 불균형");
  for (const block of [1, 2]) {
    const rows = trials.filter((trial) => trial.block === block);
    if (rows.length !== 24) errors.push(`block ${block}가 24 trials가 아님`);
    for (const condition of CONDITIONS) {
      if (rows.filter((trial) => trial.condition === condition).length !== 4) {
        errors.push(`block ${block}/${condition} 반복 불일치`);
      }
    }
    if (rows.filter((trial) => trial.primarySame).length !== 12) errors.push(`block ${block} 정답 불균형`);
  }
  for (const condition of CONDITIONS) {
    const rows = trials.filter((trial) => trial.condition === condition);
    if (rows.length !== 8 || rows.filter((trial) => trial.primarySame).length !== 4) {
      errors.push(`${condition} 반복 또는 정답 불균형`);
    }
    for (const direction of CUE_DIRECTIONS) {
      const subset = rows.filter((trial) => trial.cueDirection === direction);
      if (subset.length !== 2 || subset.filter((trial) => trial.primarySame).length !== 1) {
        errors.push(`${condition}/${direction} 균형 불일치`);
      }
    }
    for (const trial of rows) {
      const [x, y] = POSITION_DEG[condition];
      if (condition !== "CENTER" && Math.abs(Math.hypot(x, y) - 2.39) > 1e-10) {
        errors.push(`${condition} 이심도 불일치`);
      }
    }
  }
  if (errors.length) throw new Error([...new Set(errors)].join("; "));
  return true;
}

export function validatePilotSchedule(trials) {
  if (trials.length !== 6) throw new Error("pilot은 6 trials여야 합니다.");
  if (new Set(trials.map((trial) => trial.condition)).size !== 6) throw new Error("pilot 위치 중복");
  for (const direction of CUE_DIRECTIONS) {
    if (!trials.some((trial) => trial.cueDirection === direction)) throw new Error(`pilot ${direction} 누락`);
  }
  return true;
}

