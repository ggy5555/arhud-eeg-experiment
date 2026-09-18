import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
globalThis.crypto ??= webcrypto;

import {
  BEHAVIOR_COLUMNS,
  CONDITIONS,
  MARKER_COLUMNS,
  POSITION_DEG,
  TIMING_MS,
} from "../js/config.js";
import {
  deriveParticipantSeed,
  generateMainTrials,
  generateNBackTrials,
  generatePilotTrials,
  validateMainSchedule,
} from "../js/randomization.js";
import { connectorPair, degreesToCssPixels } from "../js/stimuli.js";
import { rowsToCsv } from "../js/data.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const first = await generateMainTrials("QA001", "S01");
const repeated = await generateMainTrials("QA001", "S01");
const other = await generateMainTrials("QA002", "S01");
assert(JSON.stringify(first) === JSON.stringify(repeated), "schedule is not reproducible");
assert(JSON.stringify(first) !== JSON.stringify(other), "participants share identical schedule");
assert(validateMainSchedule(first), "main schedule validation failed");
assert(first.length === 48, "main trial count is not 48");
assert(new Set(first.map((trial) => trial.seed)).size === 1, "seed not saved per trial");

for (const condition of CONDITIONS) {
  const [x, y] = POSITION_DEG[condition];
  const radius = Math.hypot(x, y);
  assert(condition === "CENTER" ? radius === 0 : Math.abs(radius - 2.39) < 1e-10,
    `${condition} geometry is invalid`);
}

const pilot = await generatePilotTrials("QA001", "P01");
assert(pilot.length === 6 && new Set(pilot.map((trial) => trial.condition)).size === 6,
  "pilot coverage failed");

for (const level of [0, 2]) {
  const nback = generateNBackTrials(level, await deriveParticipantSeed("QA001", `N${level}`));
  assert(nback.length === 15, `${level}-back does not contain 15 trials`);
  if (level === 2) {
    nback.forEach((trial, index) => {
      if (index >= 2) assert(trial.isTarget === (trial.digit === nback[index - 2].digit), "2-back target mismatch");
    });
  }
}

for (const same of [true, false]) {
  const pair = connectorPair(123456, same);
  assert(pair.left.length === 10 && pair.right.length === 10, "connector edge count invalid");
  assert((JSON.stringify(pair.left) === JSON.stringify(pair.right)) === same, "connector SAME/DIFF invalid");
}

const px = degreesToCssPixels(2.39, { widthCm: 53, distanceCm: 60, viewportWidthPx: 1920 });
assert(px > 0 && Number.isFinite(px), "visual-degree conversion failed");
assert(TIMING_MS.fixation === 1000 && TIMING_MS.taskAndCue === 3000,
  "locked timing changed");

const behaviorCsv = rowsToCsv([{ participant: "P001", session: "S01" }], BEHAVIOR_COLUMNS);
assert(behaviorCsv.startsWith(`\ufeff${BEHAVIOR_COLUMNS.join(",")}\r\n`),
  "behavior CSV header mismatch");
assert(behaviorCsv.trimEnd().split("\r\n").length === 2, "behavior CSV row count mismatch");
const markerCsv = rowsToCsv([{
  onset_seconds: "1.000000",
  event_name: "TASK_ONSET",
  trial_id: "P001_S01_B01_T001",
  condition: "CENTER",
  phase: "main",
}], MARKER_COLUMNS);
assert(markerCsv.includes("TASK_ONSET"), "marker CSV data missing");
assert(markerCsv.includes(MARKER_COLUMNS.join(",")), "marker CSV header mismatch");

const appSource = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
assert(appSource.includes('id="acknowledgeButton"'), "instruction acknowledgement button missing");
assert(appSource.includes("INSTRUCTION_ACKNOWLEDGED"), "instruction acknowledgement event missing");
assert(appSource.includes("매 문제마다 누르지 않습니다"), "manual TRIGGER guidance missing");
assert(styleSource.includes(".experiment-message .acknowledgement-button"), "acknowledgement button style missing");
assert(styleSource.includes("pointer-events: auto"), "acknowledgement button is not clickable");

console.log("PASS: 48-trial randomization, geometry, connector, calibration, acknowledgement and CSV contracts");
