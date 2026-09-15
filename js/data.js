import {
  APP_VERSION,
  BEHAVIOR_COLUMNS,
  CALIBRATION_BEHAVIOR_COLUMNS,
  MARKER_COLUMNS,
} from "./config.js?v=20260915-web3";

const CHECKPOINT_KEY = "arhud-eeg-incomplete-session-v1";
const COMPLETED_KEY = "arhud-eeg-completed-session-ids-v1";

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function rowsToCsv(rows, columns) {
  const lines = [columns.map(csvCell).join(",")];
  for (const row of rows) lines.push(columns.map((column) => csvCell(row[column])).join(","));
  return `\ufeff${lines.join("\r\n")}\r\n`;
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function getIncompleteCheckpoint() {
  try {
    const raw = localStorage.getItem(CHECKPOINT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function downloadIncompleteCheckpoint() {
  const checkpoint = getIncompleteCheckpoint();
  if (!checkpoint) throw new Error("저장된 미완료 세션이 없습니다.");
  const base = `${checkpoint.meta?.participant || "UNKNOWN"}_${checkpoint.meta?.session || "UNKNOWN"}_PARTIAL`;
  downloadBlob(`${base}_session.json`, `${JSON.stringify(checkpoint, null, 2)}\n`, "application/json;charset=utf-8");
}

export function discardIncompleteCheckpoint() {
  localStorage.removeItem(CHECKPOINT_KEY);
}

function completedIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(COMPLETED_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

export class SessionStore {
  static assertNew(meta) {
    const key = `${meta.participant}|${meta.session}|${meta.mode}`;
    if (completedIds().has(key)) {
      throw new Error("이 브라우저에서 같은 participant/session/mode가 이미 완료되었습니다. 새 session ID를 사용하세요.");
    }
    const incomplete = getIncompleteCheckpoint();
    if (incomplete && incomplete.meta) {
      throw new Error("미완료 세션이 남아 있습니다. 먼저 부분 자료를 내려받고 삭제하세요.");
    }
  }

  constructor(meta) {
    SessionStore.assertNew(meta);
    this.meta = {
      ...meta,
      appVersion: APP_VERSION,
      startedUtc: new Date().toISOString(),
      clockDomain: "BROWSER_PERFORMANCE_NOW",
      userAgent: navigator.userAgent,
      language: navigator.language,
      screen: {
        width: screen.width,
        height: screen.height,
        availWidth: screen.availWidth,
        availHeight: screen.availHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
      },
    };
    this.zeroPerformanceMs = performance.now();
    this.schedule = [];
    this.behavior = [];
    this.calibrationBehavior = [];
    this.practiceBehavior = [];
    this.markers = [];
    this.events = [];
    this.status = "IN_PROGRESS";
    this.checkpoint();
  }

  relativeSeconds(now = performance.now()) {
    return (now - this.zeroPerformanceMs) / 1000;
  }

  emit(eventName, trialId = "RUN", condition = "NONE", phase = "setup", payload = {}) {
    const now = performance.now();
    const row = {
      onset_seconds: this.relativeSeconds(now).toFixed(6),
      event_name: eventName,
      trial_id: trialId,
      condition,
      phase,
      payload: JSON.stringify(payload),
      local_monotonic_seconds: (now / 1000).toFixed(6),
      local_utc: new Date().toISOString(),
      lsl_timestamp_seconds: "",
      lsl_sent: 0,
      clock_domain: "BROWSER_PERFORMANCE_NOW",
    };
    this.markers.push(row);
    this.checkpoint();
    return Number(row.onset_seconds);
  }

  addEvent(type, details = {}) {
    this.events.push({ onset_seconds: this.relativeSeconds().toFixed(6), utc: new Date().toISOString(), type, details });
    this.checkpoint();
  }

  setSchedule(schedule) {
    this.schedule = schedule.map((trial) => ({ ...trial }));
    this.checkpoint();
  }

  addBehavior(row, kind = "main") {
    if (kind === "calibration") this.calibrationBehavior.push(row);
    else if (kind === "practice") this.practiceBehavior.push(row);
    else this.behavior.push(row);
    this.checkpoint();
  }

  snapshot() {
    return {
      meta: this.meta,
      status: this.status,
      zeroPerformanceMs: this.zeroPerformanceMs,
      schedule: this.schedule,
      behavior: this.behavior,
      calibrationBehavior: this.calibrationBehavior,
      practiceBehavior: this.practiceBehavior,
      markers: this.markers,
      events: this.events,
      savedUtc: new Date().toISOString(),
    };
  }

  checkpoint() {
    localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(this.snapshot()));
  }

  complete(status = "COMPLETE") {
    this.status = status;
    this.meta.finishedUtc = new Date().toISOString();
    const ids = completedIds();
    if (status === "COMPLETE") {
      ids.add(`${this.meta.participant}|${this.meta.session}|${this.meta.mode}`);
      localStorage.setItem(COMPLETED_KEY, JSON.stringify([...ids]));
    }
    this.checkpoint();
  }

  clearCheckpoint() {
    localStorage.removeItem(CHECKPOINT_KEY);
  }

  baseName() {
    return `${this.meta.participant}_${this.meta.session}_${this.meta.dataOrigin}`;
  }

  scheduleRows() {
    return this.schedule.map((trial) => ({
      participant: trial.participant,
      session: trial.session,
      block: trial.block,
      block_trial: trial.blockTrial,
      trial: trial.trial,
      trial_id: trial.trialId,
      condition: trial.condition,
      eccentricity: trial.eccentricity,
      direction: trial.direction,
      cue_direction: trial.cueDirection,
      primary_same: Number(trial.primarySame),
      iti_s: (trial.itiMs / 1000).toFixed(6),
      seed: trial.seed,
      stimulus_seed: trial.stimulusSeed,
      phase: trial.phase,
    }));
  }

  fileDefinitions() {
    const base = this.baseName();
    const scheduleColumns = [
      "participant", "session", "block", "block_trial", "trial", "trial_id", "condition",
      "eccentricity", "direction", "cue_direction", "primary_same", "iti_s", "seed",
      "stimulus_seed", "phase",
    ];
    return [
      {
        id: "session",
        name: `${base}_session.json`,
        content: `${JSON.stringify(this.snapshot(), null, 2)}\n`,
        type: "application/json;charset=utf-8",
        description: "설정·진행 상태·모든 기록을 함께 보존하는 복구용 묶음",
      },
      {
        id: "main",
        name: `${base}_main_behavior.csv`,
        content: rowsToCsv(this.behavior, BEHAVIOR_COLUMNS),
        type: "text/csv;charset=utf-8",
        description: "본실험 또는 pilot의 trial별 행동 자료",
      },
      {
        id: "markers",
        name: `${base}_markers.csv`,
        content: rowsToCsv(this.markers, MARKER_COLUMNS),
        type: "text/csv;charset=utf-8",
        description: "EEG 정렬에 사용할 로컬 monotonic marker 기록",
      },
      {
        id: "calibration",
        name: `${base}_calibration_behavior.csv`,
        content: rowsToCsv(this.calibrationBehavior, CALIBRATION_BEHAVIOR_COLUMNS),
        type: "text/csv;charset=utf-8",
        description: "0-back·2-back calibration 행동 자료",
      },
      {
        id: "practice",
        name: `${base}_practice_behavior.csv`,
        content: rowsToCsv(this.practiceBehavior, BEHAVIOR_COLUMNS),
        type: "text/csv;charset=utf-8",
        description: "본실험과 분리된 연습 자료",
      },
      {
        id: "schedule",
        name: `${base}_schedule.csv`,
        content: rowsToCsv(this.scheduleRows(), scheduleColumns),
        type: "text/csv;charset=utf-8",
        description: "seed와 실제 제시 순서를 보존하는 schedule",
      },
    ];
  }

  download(id) {
    const file = this.fileDefinitions().find((candidate) => candidate.id === id);
    if (!file) throw new Error(`알 수 없는 파일: ${id}`);
    downloadBlob(file.name, file.content, file.type);
  }

  downloadAll() {
    for (const file of this.fileDefinitions()) downloadBlob(file.name, file.content, file.type);
  }
}

