export const STUDY_TITLE =
  "EEG 및 작업 수행 분석을 통한 개인 맞춤형 시각 보조정보 배치 알고리즘 설계 및 검증: AR 작업보조 HUD 적용을 위한 모니터 기반 시뮬레이션 연구";

export const APP_VERSION = "2026.09.18-web6";
export const MASTER_SEED = 260904;

export const CONDITIONS = ["CENTER", "N-L", "N-R", "N-T", "N-B", "N-BR"];
export const CUE_DIRECTIONS = ["UP", "DOWN", "LEFT", "RIGHT"];
export const ARROWS = { UP: "↑", DOWN: "↓", LEFT: "←", RIGHT: "→" };
export const POSITION_DIRECTIONS = {
  CENTER: "CENTER",
  "N-L": "L",
  "N-R": "R",
  "N-T": "T",
  "N-B": "B",
  "N-BR": "BR",
};

const R = 2.39;
const D = R / Math.sqrt(2);
export const POSITION_DEG = {
  CENTER: [0, 0],
  "N-L": [-R, 0],
  "N-R": [R, 0],
  "N-T": [0, R],
  "N-B": [0, -R],
  "N-BR": [D, -D],
};

export const TIMING_MS = {
  fixation: 1000,
  taskAndCue: 3000,
  primaryResponse: 1200,
  cueResponse: 1200,
  itiMin: 600,
  itiMax: 1000,
  blockBreak: 60_000,
};

export const CALIBRATION = {
  eyesOpenMs: 30_000,
  eyesClosedMs: 30_000,
  nbackTaskMs: 60_000,
  nbackTrialMs: 4000,
  nbackStimulusMs: 1000,
  restMs: 30_000,
  trialsPerNBack: 15,
};

export const KEYS = {
  primarySame: "f",
  primaryDifferent: "j",
  cue: { ArrowUp: "UP", ArrowDown: "DOWN", ArrowLeft: "LEFT", ArrowRight: "RIGHT" },
  pause: "p",
};

export const BEHAVIOR_COLUMNS = [
  "participant", "session", "block", "block_trial", "trial", "trial_id",
  "condition", "eccentricity", "direction", "cue_direction", "primary_same",
  "primary_response", "primary_correct", "primary_rt_s", "cue_response",
  "cue_correct", "cue_rt_s", "stimulus_onset", "phase", "seed",
  "stimulus_seed", "data_origin", "integrity_flags",
];

export const MARKER_COLUMNS = [
  "onset_seconds", "event_name", "trial_id", "condition", "phase", "payload",
  "local_monotonic_seconds", "local_utc", "lsl_timestamp_seconds", "lsl_sent",
  "clock_domain",
];

export const CALIBRATION_BEHAVIOR_COLUMNS = [
  "participant", "session", "trial", "trial_id", "phase", "nback_level",
  "digit", "is_target", "response", "correct", "rt_s", "stimulus_onset",
  "seed", "data_origin", "integrity_flags",
];

export function eccentricityFor(condition) {
  if (condition === "CENTER") return 0;
  if (condition.startsWith("N-")) return R;
  throw new Error(`Unknown condition: ${condition}`);
}

export function validateIdentifier(value, label = "identifier") {
  const text = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(text)) {
    throw new Error(`${label}는 영문·숫자·_·-만 사용하여 1~40자로 입력하세요.`);
  }
  return text;
}
