import {
  APP_VERSION,
  BEHAVIOR_COLUMNS,
  CALIBRATION,
  CONDITIONS,
  KEYS,
  MARKER_COLUMNS,
  STUDY_TITLE,
  TIMING_MS,
  validateIdentifier,
} from "./config.js?v=20260918-web6";
import {
  deriveParticipantSeed,
  generateMainTrials,
  generateNBackTrials,
  generatePilotTrials,
  validateMainSchedule,
} from "./randomization.js?v=20260918-web6";
import {
  SessionStore,
  discardIncompleteCheckpoint,
  downloadIncompleteCheckpoint,
  getIncompleteCheckpoint,
} from "./data.js?v=20260918-web6";
import {
  drawBlank,
  drawDigit,
  drawFixation,
  drawGeometry,
  drawResponsePrompt,
  drawSyncFlash,
  drawTrial,
} from "./stimuli.js?v=20260918-web6";

const QA_MODE = new URLSearchParams(location.search).get("qa") === "1";
const TIME_SCALE = QA_MODE ? 0.003 : 1;
const app = document.querySelector("#app");
const canvas = document.querySelector("#stimulusCanvas");
const experimentLayer = document.querySelector("#experimentLayer");
const experimentMessage = document.querySelector("#experimentMessage");
const experimentBadge = document.querySelector("#experimentBadge");
const pauseLayer = document.querySelector("#pauseLayer");
const progressWrap = document.querySelector("#progressWrap");
const progressBar = document.querySelector("#progressBar");
const progressLabel = document.querySelector("#progressLabel");
const progressValue = document.querySelector("#progressValue");
const statusDot = document.querySelector("#statusDot");
const statusText = document.querySelector("#statusText");
const toast = document.querySelector("#toast");

document.querySelector("#versionLabel").textContent = `v${APP_VERSION}`;
if (QA_MODE) {
  const banner = document.createElement("div");
  banner.className = "qa-banner";
  banner.textContent = "QA ONLY · 단축 시간 · 연구 결과 사용 금지";
  document.body.append(banner);
}

const state = {
  setup: null,
  monitor: null,
  store: null,
  schedule: [],
  seed: null,
  running: false,
  paused: false,
  pauseReason: null,
  resumeResolver: null,
  abortRequested: false,
  integrityFlags: new Set(),
  currentKeyCancel: null,
  cleanup: null,
  runLock: null,
};

function scaled(ms) {
  return Math.max(QA_MODE ? 8 : 0, ms * TIME_SCALE);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[char]);
}

function setStatus(text, kind = "idle") {
  statusText.textContent = text;
  statusDot.className = `status-dot ${kind}`;
}

function setProgress(label, current, total) {
  progressWrap.hidden = false;
  const percent = total ? Math.max(0, Math.min(100, current / total * 100)) : 0;
  progressLabel.textContent = label;
  progressValue.textContent = `${Math.round(percent)}%`;
  progressBar.style.width = `${percent}%`;
}

function hideProgress() {
  progressWrap.hidden = true;
}

let toastTimer = null;
function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("show");
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

function cleanScreen() {
  if (state.cleanup) state.cleanup();
  state.cleanup = null;
  app.innerHTML = "";
  window.scrollTo({ top: 0, behavior: "instant" });
}

function showExperiment(message = "", badge = "") {
  experimentLayer.hidden = false;
  experimentMessage.innerHTML = message;
  experimentBadge.textContent = badge;
}

function hideExperiment() {
  experimentLayer.hidden = true;
  experimentMessage.replaceChildren();
  experimentBadge.textContent = "";
}

function clearExperimentOverlay() {
  experimentMessage.replaceChildren();
  experimentBadge.textContent = "";
}

function acquireRunLock(label) {
  if (state.runLock) {
    state.store?.addEvent("DUPLICATE_RUN_BLOCKED", {
      requested_run: label,
      active_run: state.runLock,
    });
    showToast("이미 실험 단계가 진행 중입니다. 버튼을 다시 누르지 마세요.");
    return false;
  }
  state.runLock = label;
  return true;
}

function releaseRunLock(label = null) {
  if (label && state.runLock !== label) return;
  state.runLock = null;
}

function markButtonBusy(button, label) {
  if (!button || button.dataset.busy === "true") return false;
  button.dataset.busy = "true";
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  if (label) button.textContent = label;
  return true;
}

function messageHtml(title, body = "", timer = "") {
  return `<div class="message-inner"><h2>${escapeHtml(title)}</h2>${body ? `<p>${escapeHtml(body)}</p>` : ""}${timer ? `<div class="timer">${escapeHtml(timer)}</div>` : ""}</div>`;
}

function acknowledgementHtml(title, body = "", confirmLabel = "내용을 이해했습니다 · 계속") {
  return `<div class="message-inner acknowledgement-card"><h2>${escapeHtml(title)}</h2>${body ? `<p>${escapeHtml(body)}</p>` : ""}<button id="acknowledgeButton" class="button primary acknowledgement-button" type="button">${escapeHtml(confirmLabel)}</button><div class="acknowledgement-hint">버튼을 누르거나 SPACE 키를 누르면 다음 단계로 진행합니다.</div></div>`;
}

function sleep(ms) {
  if (QA_MODE) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, scaled(ms)));
}

function nextFrame(draw) {
  return new Promise((resolve) => requestAnimationFrame((timestamp) => {
    draw();
    resolve(timestamp);
  }));
}

function currentFlags() {
  return [...state.integrityFlags].join(";");
}

async function requestFullscreen() {
  if (document.fullscreenElement) return true;
  try {
    await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    return true;
  } catch (error) {
    state.integrityFlags.add("FULLSCREEN_REQUEST_FAILED");
    state.store?.addEvent("FULLSCREEN_REQUEST_FAILED", { message: String(error) });
    showToast("전체화면 전환에 실패했습니다. 브라우저 설정을 확인하세요.");
    return false;
  }
}

async function exitFullscreen() {
  if (!document.fullscreenElement) return;
  try { await document.exitFullscreen(); } catch { /* browser controls fullscreen */ }
}

function beep(frequency = 880, durationMs = 150) {
  if (QA_MODE) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const audio = new AudioContext();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.04, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + durationMs / 1000);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + durationMs / 1000);
    oscillator.addEventListener("ended", () => audio.close());
  } catch { /* audio is a convenience cue; marker logging remains primary */ }
}

function throwIfAborted() {
  if (state.abortRequested) throw new Error("RUN_ABORTED_BY_OPERATOR");
}

async function waitWhilePaused() {
  if (!state.paused) return;
  await new Promise((resolve) => { state.resumeResolver = resolve; });
  state.resumeResolver = null;
  throwIfAborted();
}

function requestPause(reason) {
  if (!state.running || state.paused) return;
  state.paused = true;
  state.pauseReason = reason;
  state.integrityFlags.add(reason);
  state.store?.emit("RUN_PAUSED", "RUN", "NONE", "operator", { reason });
  if (state.currentKeyCancel) state.currentKeyCancel();
  pauseLayer.hidden = false;
  setStatus("일시정지", "error");
}

async function resumeRun() {
  await requestFullscreen();
  pauseLayer.hidden = true;
  state.store?.emit("RUN_RESUMED", "RUN", "NONE", "operator", { reason: state.pauseReason });
  state.paused = false;
  state.pauseReason = null;
  setStatus("실험 진행 중", "running");
  state.resumeResolver?.();
}

document.querySelector("#resumeButton").addEventListener("click", resumeRun);
document.querySelector("#partialButton").addEventListener("click", () => {
  try { state.store?.download("session"); } catch (error) { showToast(error.message); }
});
document.querySelector("#stopButton").addEventListener("click", () => {
  if (!confirm("실험을 중단하고 현재까지의 자료를 보존할까요?")) return;
  state.abortRequested = true;
  state.store?.emit("RUN_ABORT_REQUESTED", "RUN", "NONE", "operator");
  state.paused = false;
  pauseLayer.hidden = true;
  state.resumeResolver?.();
});

document.addEventListener("fullscreenchange", () => {
  if (state.running && !document.fullscreenElement) requestPause("FULLSCREEN_EXIT");
});
document.addEventListener("visibilitychange", () => {
  if (state.running && document.hidden) requestPause("VISIBILITY_HIDDEN");
});
window.addEventListener("keydown", (event) => {
  if (state.running && event.key.toLowerCase() === KEYS.pause && !event.repeat) {
    event.preventDefault();
    requestPause("OPERATOR_PAUSE_KEY");
  }
});
window.addEventListener("beforeunload", (event) => {
  if (!state.running) return;
  state.store?.checkpoint();
  event.preventDefault();
  event.returnValue = "";
});

function collectKey(validKeys, durationMs, autoKey = null) {
  const start = performance.now();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (key, timestamp = performance.now()) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener("keydown", onKey, true);
      state.currentKeyCancel = null;
      resolve({ key, rtSeconds: key ? (timestamp - start) / 1000 : null });
    };
    const onKey = (event) => {
      if (event.repeat || !validKeys.includes(event.key)) return;
      event.preventDefault();
      finish(event.key, performance.now());
    };
    window.addEventListener("keydown", onKey, true);
    const timer = setTimeout(() => finish(null), scaled(durationMs));
    state.currentKeyCancel = () => finish(null);
    if (QA_MODE && autoKey) queueMicrotask(() => finish(autoKey));
  });
}

async function waitForSpace(
  title = "안내 확인",
  body = "",
  badge = "확인 버튼 또는 SPACE · P=일시정지",
  confirmLabel = "내용을 이해했습니다 · 계속",
) {
  while (true) {
    showExperiment(acknowledgementHtml(title, body, confirmLabel), badge);
    const button = document.querySelector("#acknowledgeButton");
    const started = performance.now();
    const result = await new Promise((resolve) => {
      let settled = false;
      let timer = null;
      const finish = (method) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        window.removeEventListener("keydown", onKey, true);
        button?.removeEventListener("click", onClick);
        state.currentKeyCancel = null;
        resolve({ method, rtSeconds: (performance.now() - started) / 1000 });
      };
      const onKey = (event) => {
        if (event.repeat || event.key !== " ") return;
        event.preventDefault();
        finish("space");
      };
      const onClick = () => finish("button");
      window.addEventListener("keydown", onKey, true);
      button?.addEventListener("click", onClick);
      timer = setTimeout(() => finish("timeout"), scaled(24 * 60 * 60 * 1000));
      state.currentKeyCancel = () => finish("cancelled");
      if (QA_MODE) queueMicrotask(() => finish("qa_auto"));
    });
    if (result.method === "cancelled" && state.paused) {
      await waitWhilePaused();
      continue;
    }
    if (["button", "space", "qa_auto"].includes(result.method)) {
      state.store?.addEvent("INSTRUCTION_ACKNOWLEDGED", {
        title,
        method: result.method,
        response_time_s: Number(result.rtSeconds.toFixed(6)),
      });
    }
    return result;
  }
}

async function countdownMessage(title, body, durationMs, eventPrefix = null) {
  const started = performance.now();
  if (eventPrefix) state.store?.emit(`${eventPrefix}_ONSET`, "RUN", "NONE", "operator");
  if (QA_MODE) {
    showExperiment(messageHtml(title, body, "QA"), "QA 단축 · 연구 결과 사용 금지");
    await Promise.resolve();
    if (eventPrefix) state.store?.emit(`${eventPrefix}_END`, "RUN", "NONE", "operator");
    return;
  }
  while (performance.now() - started < scaled(durationMs)) {
    await waitWhilePaused();
    const elapsedReal = (performance.now() - started) / TIME_SCALE;
    const remaining = Math.max(0, Math.ceil((durationMs - elapsedReal) / 1000));
    showExperiment(messageHtml(title, body, `${remaining}`), "P=일시정지");
    await sleep(Math.min(250, durationMs));
    throwIfAborted();
  }
  if (eventPrefix) state.store?.emit(`${eventPrefix}_END`, "RUN", "NONE", "operator");
}

function renderHome() {
  cleanScreen();
  hideProgress();
  setStatus("준비 전", "idle");
  const incomplete = getIncompleteCheckpoint();
  app.innerHTML = `
    <section class="hero">
      <div class="hero-copy">
        <span class="eyebrow">Participant task & operator guide</span>
        <h1>화면 안내부터<br>자료 저장까지 한 번에</h1>
        <p class="lead">중앙 SAME/DIFF 과제와 주변 HUD 화살표 과제를 제시하고, 행동 응답과 EEG 정렬용 로컬 marker를 기록하는 모니터 기반 실험 실행기입니다.</p>
        <div class="tag-row"><span class="tag">6 CONDITIONS</span><span class="tag">48 TRIALS</span><span class="tag">2 BLOCKS</span><span class="tag">LOCAL-ONLY DATA</span></div>
      </div>
      <aside class="hero-aside">
        <div class="metric"><strong>48</strong><span>본실험 trials</span></div>
        <div class="metric"><strong>2.39°</strong><span>주변 cue 이심도</span></div>
        <div class="metric"><strong>0</strong><span>서버로 전송되는 참가자 자료</span></div>
      </aside>
    </section>
    ${incomplete ? `<section class="panel"><div class="notice danger"><strong>미완료 세션이 브라우저에 남아 있습니다.</strong><br>새 실험을 시작하기 전에 부분 자료를 내려받고 체크포인트를 정리하세요.</div><div class="button-row"><button id="downloadPartial" class="button secondary">부분 session JSON 다운로드</button><button id="discardPartial" class="button danger">다운로드 확인 후 체크포인트 삭제</button></div></section>` : ""}
    <section class="panel">
      <div class="panel-heading"><div><span class="eyebrow">01 · Session setup</span><h2>실험 세션 설정</h2><p>이름 대신 익명 ID를 입력합니다. 같은 ID와 session 조합은 이 브라우저에서 다시 완료할 수 없습니다.</p></div></div>
      ${QA_MODE ? `<div class="notice danger">QA 단축 모드입니다. 생성 자료는 <strong>DRY_RUN_QA</strong>이며 연구 결과로 사용할 수 없습니다.</div>` : ""}
      <form id="setupForm">
        <div class="mode-grid">
          <div class="mode-option"><input type="radio" name="mode" id="modeGeometry" value="geometry"><label for="modeGeometry"><strong>화면 위치 검증</strong><span>2.39° 위치와 5 cm 눈금을 먼저 확인</span></label></div>
          <div class="mode-option"><input type="radio" name="mode" id="modePilot" value="pilot" checked><label for="modePilot"><strong>6-trial 파일럿</strong><span>저장·키·위치·marker를 짧게 점검</span></label></div>
          <div class="mode-option"><input type="radio" name="mode" id="modeMain" value="main"><label for="modeMain"><strong>48-trial 본실험</strong><span>protocol lock 이후에만 사용</span></label></div>
        </div>
        <div class="form-grid">
          <div class="field"><label for="participant">익명 participant ID</label><input id="participant" name="participant" placeholder="예: P001" maxlength="40" autocomplete="off"><small>실명·학번·연락처 입력 금지 · 위치 검증만 할 때는 비워도 됨</small></div>
          <div class="field"><label for="session">Session ID</label><input id="session" name="session" value="S01" maxlength="40" required autocomplete="off"><small>재실행할 때는 새 ID 사용</small></div>
          <div class="field"><label for="monitorWidth">모니터 표시 영역 가로폭 (cm)</label><input id="monitorWidth" name="monitorWidth" type="number" value="53" min="20" max="100" step="0.1" required><small>베젤 제외, 자로 실측</small></div>
          <div class="field"><label for="distance">눈–모니터 거리 (cm)</label><input id="distance" name="distance" type="number" value="60" min="35" max="120" step="0.5" required><small>기본 계획값 60 cm</small></div>
          <div class="field"><label for="resolutionX">모니터 가로 해상도</label><input id="resolutionX" name="resolutionX" type="number" min="800" max="10000" value="${Math.round(screen.width * (window.devicePixelRatio || 1))}" required></div>
          <div class="field"><label for="resolutionY">모니터 세로 해상도</label><input id="resolutionY" name="resolutionY" type="number" min="600" max="10000" value="${Math.round(screen.height * (window.devicePixelRatio || 1))}" required></div>
        </div>
        <div class="notice" style="margin-top:20px">MeasureWiz와 직접 통신하지 않습니다. EEG 앱의 native TRIGGER와 이 사이트의 로컬 marker 정렬은 실제 파일럿에서 검증해야 합니다.</div>
        <div class="button-row"><button class="button primary" type="submit">환경 점검으로 이동</button><button id="selfTest" class="button secondary" type="button">48-trial 자동검사</button></div>
      </form>
    </section>`;

  if (incomplete) {
    document.querySelector("#downloadPartial").addEventListener("click", () => {
      try { downloadIncompleteCheckpoint(); showToast("부분 session JSON을 내려받았습니다."); } catch (error) { showToast(error.message); }
    });
    document.querySelector("#discardPartial").addEventListener("click", () => {
      if (!confirm("부분 자료를 내려받았는지 확인했나요? 삭제 후에는 브라우저에서 복구할 수 없습니다.")) return;
      discardIncompleteCheckpoint();
      renderHome();
    });
  }

  document.querySelector("#selfTest").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "검사 중…";
    try {
      for (let index = 0; index < 100; index += 1) {
        validateMainSchedule(await generateMainTrials(`QA${String(index).padStart(3, "0")}`, "SELFTEST"));
      }
      showToast("PASS · 100개 seed에서 48-trial 균형과 좌표를 확인했습니다.");
      button.textContent = "자동검사 PASS";
    } catch (error) {
      button.textContent = "자동검사 FAIL";
      showToast(error.message);
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector("#setupForm").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const form = new FormData(event.currentTarget);
      const mode = form.get("mode");
      const participant = mode === "geometry" && !String(form.get("participant")).trim()
        ? "GEOMETRY" : validateIdentifier(form.get("participant"), "participant ID");
      const session = mode === "geometry" && !String(form.get("session")).trim()
        ? "CHECK" : validateIdentifier(form.get("session"), "session ID");
      const widthCm = Number(form.get("monitorWidth"));
      const distanceCm = Number(form.get("distance"));
      const resolution = [Number(form.get("resolutionX")), Number(form.get("resolutionY"))];
      if (![widthCm, distanceCm, ...resolution].every(Number.isFinite)) throw new Error("모니터 설정값을 확인하세요.");
      state.setup = { participant, session, mode, widthCm, distanceCm, resolution };
      renderPreparation();
    } catch (error) { showToast(error.message); }
  });
}

function renderPreparation() {
  cleanScreen();
  const { mode, participant, session, widthCm, distanceCm, resolution } = state.setup;
  setStatus("환경 점검", "ready");
  setProgress("환경 점검", 1, 7);
  const geometryOnly = mode === "geometry";
  const items = geometryOnly ? [
    ["monitor", `모니터 표시 영역 가로폭 ${widthCm} cm를 실측함`],
    ["zoom", "브라우저 확대/축소를 100%로 설정함"],
    ["distance", `눈–화면 거리 ${distanceCm} cm를 유지할 수 있음`],
  ] : [
    ["anonymous", `익명 ID ${participant} / ${session}을 EEG 파일명에도 사용함`],
    ["consent", "[학교 연구 지침 및 동의 절차 확인]을 완료함"],
    ["hardware", "MeasureWiz 전극·배터리·Bluetooth 연결을 확인함"],
    ["signal", "EEG raw 파형과 앱의 연결 상태를 확인함"],
    ["display", `모니터 ${widthCm} cm · 거리 ${distanceCm} cm · ${resolution.join("×")}를 확인함`],
    ["privacy", "공개 GitHub 저장소에 참가자 CSV·EEG 원자료를 올리지 않기로 확인함"],
  ];
  app.innerHTML = `
    <section class="panel">
      <span class="eyebrow">02 · Preflight</span><h2>${geometryOnly ? "화면 geometry 점검" : "실험 시작 전 확인"}</h2>
      <p>모든 항목을 실제로 확인해야 다음 단계로 이동할 수 있습니다.</p>
      <div class="summary-grid"><div class="summary-item"><strong>${escapeHtml(participant)}</strong><span>participant</span></div><div class="summary-item"><strong>${escapeHtml(session)}</strong><span>session</span></div><div class="summary-item"><strong>${widthCm} cm</strong><span>monitor width</span></div><div class="summary-item"><strong>${distanceCm} cm</strong><span>viewing distance</span></div></div>
      <div class="checklist">${items.map(([id, label]) => `<label class="check-item"><input type="checkbox" data-required id="check-${id}"><span>${escapeHtml(label)}</span></label>`).join("")}</div>
      ${mode === "main" && !QA_MODE ? `<div class="field"><label for="protocolLock">본실험 protocol lock 확인</label><input id="protocolLock" placeholder="LOCKED를 정확히 입력"><small>pilot·동기화 검증·담당 교사 확인 전에는 본실험을 시작하지 않습니다.</small></div>` : ""}
      <div class="button-row"><button id="preflightNext" class="button primary" disabled>${geometryOnly ? "전체화면 위치 검증" : "응답키 점검"}</button><button id="backHome" class="button ghost">설정으로 돌아가기</button></div>
    </section>`;
  const update = () => {
    const checked = [...document.querySelectorAll("[data-required]")].every((box) => box.checked);
    const locked = mode !== "main" || QA_MODE || document.querySelector("#protocolLock")?.value === "LOCKED";
    document.querySelector("#preflightNext").disabled = !(checked && locked);
  };
  app.querySelectorAll("input").forEach((input) => input.addEventListener("input", update));
  document.querySelector("#backHome").addEventListener("click", renderHome);
  document.querySelector("#preflightNext").addEventListener("click", async (event) => {
    if (!markButtonBusy(event.currentTarget, geometryOnly ? "위치 검증 여는 중…" : "응답키 점검 여는 중…")) return;
    state.monitor = { widthCm, distanceCm, resolution, viewportWidthPx: window.innerWidth };
    if (geometryOnly) return runGeometryCheck();
    try {
      const dataOrigin = QA_MODE ? "DRY_RUN_QA" : mode === "main" ? "EMPIRICAL" : "PILOT";
      const meta = { participant, session, mode, dataOrigin, monitor: state.monitor, qaMode: QA_MODE, studyTitle: STUDY_TITLE };
      state.store = new SessionStore(meta);
      state.seed = await deriveParticipantSeed(participant, session);
      state.schedule = mode === "main"
        ? await generateMainTrials(participant, session, state.seed)
        : await generatePilotTrials(participant, session, state.seed);
      state.store.setSchedule(state.schedule);
      state.store.emit("RUN_START", `${participant}_${session}_RUN`, "NONE", "setup", { mode, dataOrigin });
      renderKeyCheck();
    } catch (error) { showToast(error.message); }
  });
}

async function runGeometryCheck() {
  await requestFullscreen();
  state.monitor.viewportWidthPx = window.innerWidth;
  drawGeometry(canvas, state.monitor);
  await waitForSpace(
    "위치·길이 검증",
    "점 여섯 개의 위치와 왼쪽 아래 5 cm 눈금을 실제로 확인하세요.",
    "CENTER 0° · N 2.39°",
    "위치와 5 cm 눈금을 확인했습니다",
  );
  hideExperiment();
  await exitFullscreen();
  cleanScreen();
  app.innerHTML = `<section class="panel"><span class="eyebrow">Geometry validation</span><h2>화면 위치 확인 완료</h2><div class="notice">이 확인은 자동 측정이 아닙니다. 실제 모니터에서 5 cm 눈금과 위치가 맞는지 실험자가 확인한 기록을 decision log에 남기세요.</div><div class="button-row"><button id="geometryHome" class="button primary">처음 화면으로</button></div></section>`;
  document.querySelector("#geometryHome").addEventListener("click", renderHome);
}

function renderKeyCheck() {
  cleanScreen();
  setProgress("응답키 점검", 2, 7);
  setStatus("응답키 확인", "ready");
  const needed = new Set(["f", "j", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
  const labels = [
    ["f", "F", "SAME"], ["j", "J", "DIFFERENT"], ["ArrowUp", "↑", "위"],
    ["ArrowDown", "↓", "아래"], ["ArrowLeft", "←", "왼쪽"], ["ArrowRight", "→", "오른쪽"],
  ];
  app.innerHTML = `<section class="panel"><span class="eyebrow">03 · Response check</span><h2>참가자가 응답키를 직접 눌러 확인</h2><p>아래 여섯 키를 모두 한 번씩 누르세요. 본실험 중에는 마우스를 사용하지 않습니다.</p><div class="key-grid">${labels.map(([key, face, text]) => `<div class="key-card" data-key="${key}"><kbd>${face}</kbd><span>${text}</span></div>`).join("")}</div><div id="keyNotice" class="notice">남은 키: 6개</div><div class="button-row"><button id="keyNext" class="button primary" disabled>연습 과제 시작</button><button id="keyBack" class="button ghost">환경 점검으로</button></div></section>`;
  const handler = (event) => {
    if (!needed.has(event.key)) return;
    event.preventDefault();
    needed.delete(event.key);
    document.querySelector(`[data-key="${event.key}"]`)?.classList.add("checked");
    document.querySelector("#keyNotice").textContent = needed.size ? `남은 키: ${needed.size}개` : "PASS · 모든 응답키가 작동합니다.";
    document.querySelector("#keyNotice").className = needed.size ? "notice" : "notice success";
    document.querySelector("#keyNext").disabled = needed.size > 0;
  };
  window.addEventListener("keydown", handler);
  state.cleanup = () => window.removeEventListener("keydown", handler);
  document.querySelector("#keyBack").addEventListener("click", () => {
    state.store?.complete("CANCELLED_BEFORE_RUN");
    renderCompletion("시작 전 취소됨");
  });
  document.querySelector("#keyNext").addEventListener("click", runPracticeIntro);
  if (QA_MODE) {
    for (const key of labels.map((item) => item[0])) window.dispatchEvent(new KeyboardEvent("keydown", { key }));
  }
}

function runPracticeIntro() {
  cleanScreen();
  setProgress("연습", 3, 7);
  app.innerHTML = `<section class="panel"><span class="eyebrow">04 · Practice</span><h2>6회 연습 후 EEG 준비로 이동</h2><p>중앙의 두 연결 패턴이 같으면 F, 다르면 J를 누릅니다. 다음 화면에서는 방금 본 화살표 방향을 방향키로 응답합니다.</p><div class="notice">연습 자료는 <strong>PRACTICE</strong>로 분리되며 본실험·통계 자료에 포함되지 않습니다.</div><div class="button-row"><button id="practiceStart" class="button primary">설명을 이해했습니다 · 전체화면 연습 시작</button></div></section>`;
  document.querySelector("#practiceStart").addEventListener("click", (event) => {
    if (!markButtonBusy(event.currentTarget, "연습 화면 여는 중…")) return;
    runPractice();
  });
}

async function runPractice() {
  if (!acquireRunLock("practice")) return;
  state.running = true;
  state.abortRequested = false;
  await requestFullscreen();
  state.monitor.viewportWidthPx = window.innerWidth;
  try {
    const trials = await generatePilotTrials(state.setup.participant, state.setup.session, (state.seed ^ 0x50524143) >>> 0);
    for (const [index, trial] of trials.entries()) {
      setProgress(`연습 ${index + 1}/6`, index, 6);
      const row = await runTaskTrial({ ...trial, trialId: `${state.setup.participant}_${state.setup.session}_PRACTICE_T${String(index + 1).padStart(3, "0")}` }, { kind: "practice", feedback: true });
      state.store.addBehavior(row, "practice");
      throwIfAborted();
    }
    state.running = false;
    releaseRunLock("practice");
    hideExperiment();
    await exitFullscreen();
    renderEegPreparation();
  } catch (error) { await handleRunError(error); }
}

function renderEegPreparation() {
  cleanScreen();
  setProgress("EEG 준비", 4, 7);
  setStatus("EEG 준비", "ready");
  const name = `${state.setup.participant}_${state.setup.session}`;
  app.innerHTML = `<section class="panel"><span class="eyebrow">05 · EEG recording</span><h2>MeasureWiz 녹화 준비</h2><div class="notice danger">앱의 ‘스트레스 측정 패러다임’이 아니라 <strong>생체신호 측정 → EEG → 녹화 시작</strong>을 사용합니다. 장비별 조작은 공식 매뉴얼을 따르세요.</div><div class="checklist"><label class="check-item"><input type="checkbox" data-eeg><span>전극과 연결 상태를 확인함<small>확정 부착안: SIG 이마 왼편 / REF 귀 뒤 뼈 / GND 이마 중앙</small></span></label><label class="check-item"><input type="checkbox" data-eeg><span>Raw EEG 파형과 신호 상태를 확인함</span></label><label class="check-item"><input type="checkbox" data-eeg><span>EEG 녹화를 시작함</span></label><label class="check-item"><input type="checkbox" data-eeg><span>EEG 파일 식별자를 <strong>${escapeHtml(name)}</strong>와 맞춤</span></label></div><div class="notice">버튼을 누르면 10초 안정화 후 동기화 화면이 나타납니다. <strong>MeasureWiz의 TRIGGER는 매 문제마다 누르지 않습니다.</strong> 사이트에 “지금 TRIGGER”가 표시될 때만 앱의 TRIGGER를 한 번 누르세요.</div><div class="notice success">각 문제의 시작·중앙 응답·화살표 응답·종료 시점은 사이트가 marker CSV에 자동으로 기록합니다. 수동 TRIGGER는 세션 시작·본실험 시작·2블록 시작·세션 종료의 시간축 정렬 지점으로 사용합니다.</div><div class="button-row"><button id="syncStart" class="button primary" disabled>10초 안정화·동기화 시작</button><button id="eegCancel" class="button danger">세션 중단</button></div></section>`;
  const boxes = [...document.querySelectorAll("[data-eeg]")];
  const update = () => { document.querySelector("#syncStart").disabled = !boxes.every((box) => box.checked); };
  boxes.forEach((box) => box.addEventListener("change", update));
  document.querySelector("#syncStart").addEventListener("click", (event) => {
    if (!markButtonBusy(event.currentTarget, "실험 화면 여는 중…")) return;
    beginRecordedSession();
  });
  document.querySelector("#eegCancel").addEventListener("click", async () => {
    state.store.complete("ABORTED_BEFORE_EEG_TASK");
    renderCompletion("실험 시작 전 중단됨");
  });
}

async function runSyncPrompt(label, stabilizeMs = 10_000) {
  await requestFullscreen();
  state.monitor.viewportWidthPx = window.innerWidth;
  await countdownMessage("움직이지 말고 화면을 편하게 보세요", `${label} 동기화 전 안정화`, stabilizeMs, `SYNC_${label}_STABILIZE`);
  await nextFrame(() => drawSyncFlash(canvas));
  const onset = state.store.emit("SYNC_TRIGGER_REQUEST", `SYNC_${label}`, "NONE", "synchronization", { label });
  beep(1100, 180);
  await sleep(180);
  drawBlank(canvas);
  await waitForSpace(
    "지금 TRIGGER",
    "MeasureWiz 앱에서 TRIGGER를 한 번 누르세요. 매 trial마다 누르는 것이 아니라, 이 안내 화면이 나타날 때만 누릅니다.",
    `${label} · web onset ${onset.toFixed(3)} s`,
    "TRIGGER를 눌렀습니다",
  );
  state.store.emit("SYNC_TRIGGER_CONFIRMED", `SYNC_${label}`, "NONE", "synchronization", { label, requestOnset: onset });
  await sleep(250);
}

async function beginRecordedSession() {
  if (!acquireRunLock("recorded_session")) return;
  state.running = true;
  state.abortRequested = false;
  setStatus("EEG recording 진행", "running");
  try {
    await runSyncPrompt("SESSION_START");
    await runCalibration();
    await runSyncPrompt("MAIN_START", 3000);
    await waitForSpace(
      state.setup.mode === "main" ? "본실험 1블록 시작 전 확인" : "6-trial 파일럿 시작 전 확인",
      "중앙 과제는 F/J, 화살표 과제는 방향키로 응답합니다. trial 시작·응답·끝 marker는 사이트가 자동 저장하므로 MeasureWiz TRIGGER를 매 문제마다 누르지 마세요.",
      "과제 규칙 확인",
      state.setup.mode === "main" ? "이해했습니다 · 1블록 시작" : "이해했습니다 · 파일럿 시작",
    );
    await runScheduledTrials();
    await runSyncPrompt("SESSION_END", 1000);
    state.store.emit("RUN_END", `${state.setup.participant}_${state.setup.session}_RUN`, "NONE", "operator", { status: "COMPLETE" });
    state.store.complete("COMPLETE");
    state.running = false;
    releaseRunLock("recorded_session");
    hideExperiment();
    await exitFullscreen();
    renderCompletion("실험 완료");
  } catch (error) { await handleRunError(error); }
}

async function timedCalibrationPhase(title, body, durationMs, startEvent, endEvent) {
  await waitForSpace(
    title,
    `${body} 설명을 이해하고 준비가 되면 아래 버튼을 누르세요.`,
    "EEG calibration · 확인 버튼 또는 SPACE · P=일시정지",
    "설명을 이해했습니다 · 시작",
  );
  await countdownMessage("3초 뒤 시작", title, 3000);
  drawFixation(canvas);
  clearExperimentOverlay();
  state.store.emit(startEvent, `CAL_${startEvent}`, "NONE", "calibration_qc");
  await sleep(durationMs);
  await waitWhilePaused();
  state.store.emit(endEvent, `CAL_${startEvent}`, "NONE", "calibration_qc");
  beep();
}

async function runCalibration() {
  setProgress("Calibration", 5, 7);
  await timedCalibrationPhase("눈 뜸 30초", "중앙 +를 보고 움직임과 눈 깜빡임을 줄이세요.", CALIBRATION.eyesOpenMs, "QC_EYES_OPEN_ONSET", "QC_EYES_OPEN_END");

  await waitForSpace(
    "눈 감음 30초",
    "시작 신호 뒤 눈을 감고, 종료음이 들리면 다시 뜨세요. 설명을 이해하고 준비가 되면 아래 버튼을 누르세요.",
    "EEG calibration · 확인 버튼 또는 SPACE · P=일시정지",
    "설명을 이해했습니다 · 시작",
  );
  await countdownMessage("3초 뒤 눈을 감으세요", "종료음이 들릴 때까지 유지", 3000);
  drawBlank(canvas);
  clearExperimentOverlay();
  beep(660, 120);
  state.store.emit("QC_EYES_CLOSED_ONSET", "CAL_EYES_CLOSED", "NONE", "calibration_qc");
  await sleep(CALIBRATION.eyesClosedMs);
  await waitWhilePaused();
  state.store.emit("QC_EYES_CLOSED_END", "CAL_EYES_CLOSED", "NONE", "calibration_qc");
  beep(990, 220);

  await runNBack(0);
  showExperiment(messageHtml("휴식 30초", "편안히 쉬되 전극은 건드리지 마세요."), "Calibration rest");
  state.store.emit("CALIBRATION_REST_ONSET", "CAL_REST", "NONE", "calibration_rest");
  await sleep(CALIBRATION.restMs);
  state.store.emit("CALIBRATION_REST_END", "CAL_REST", "NONE", "calibration_rest");
  await runNBack(2);
}

async function runNBack(level) {
  const phase = level === 0 ? "calibration_low" : "calibration_high";
  const title = level === 0 ? "0-back · 숫자가 0이면 F" : "2-back · 두 칸 전 숫자와 같으면 F";
  const body = level === 0
    ? "숫자가 0이면 F(SAME), 아니면 J(DIFFERENT)를 누르세요."
    : "현재 숫자가 두 칸 전 숫자와 같으면 F(SAME), 다르면 J(DIFFERENT)를 누르세요.";
  await waitForSpace(
    title,
    `${body} 규칙을 이해했으면 아래 버튼을 누르세요.`,
    "15 trials · 60초 · P=일시정지",
    "규칙을 이해했습니다 · 시작",
  );
  clearExperimentOverlay();
  const trials = generateNBackTrials(level, state.seed);
  for (const trial of trials) {
    throwIfAborted();
    await waitWhilePaused();
    const trialId = `${state.setup.participant}_${state.setup.session}_${level}BACK_T${String(trial.index).padStart(3, "0")}`;
    const start = await nextFrame(() => drawDigit(canvas, trial.digit));
    const onset = state.store.emit("TASK_ONSET", trialId, "NONE", phase, { digit: trial.digit, level });
    const valid = ["f", "j"];
    const expectedKey = trial.isTarget ? "f" : "j";
    const responsePromise = collectKey(valid, CALIBRATION.nbackTrialMs, expectedKey);
    await sleep(CALIBRATION.nbackStimulusMs);
    drawBlank(canvas);
    const response = await responsePromise;
    state.store.emit("NBACK_RESPONSE", trialId, "NONE", phase, { response: response.key, rt_s: response.rtSeconds });
    const elapsed = (performance.now() - start) / TIME_SCALE;
    if (elapsed < CALIBRATION.nbackTrialMs) await sleep(CALIBRATION.nbackTrialMs - elapsed);
    state.store.emit("TRIAL_END", trialId, "NONE", phase);
    state.store.addBehavior({
      participant: state.setup.participant,
      session: state.setup.session,
      trial: trial.index,
      trial_id: trialId,
      phase,
      nback_level: level,
      digit: trial.digit,
      is_target: Number(trial.isTarget),
      response: response.key === "f" ? "SAME" : response.key === "j" ? "DIFFERENT" : "",
      correct: response.key ? Number(response.key === expectedKey) : 0,
      rt_s: response.rtSeconds?.toFixed(6) ?? "",
      stimulus_onset: onset.toFixed(6),
      seed: state.seed,
      data_origin: state.store.meta.dataOrigin,
      integrity_flags: currentFlags(),
    }, "calibration");
  }
}

async function runScheduledTrials() {
  const total = state.schedule.length;
  for (const [index, trial] of state.schedule.entries()) {
    throwIfAborted();
    await waitWhilePaused();
    setProgress(`${state.setup.mode === "main" ? "본실험" : "파일럿"} ${index + 1}/${total}`, index, total);
    const row = await runTaskTrial(trial, { kind: "main", feedback: false });
    state.store.addBehavior(row, "main");

    if (state.setup.mode === "main" && trial.block === 1 && trial.blockTrial === 24) {
      state.store.emit("BLOCK_BREAK_ONSET", "BLOCK_01_BREAK", "NONE", "main", { block: 1 });
      await countdownMessage("블록 휴식", "움직임을 줄이고 전극·EEG recording 상태를 확인하세요.", TIMING_MS.blockBreak);
      state.store.emit("BLOCK_BREAK_END", "BLOCK_01_BREAK", "NONE", "main", { block: 1 });
      await runSyncPrompt("BLOCK2_START", 3000);
      await waitForSpace(
        "2블록 시작 전 확인",
        "참가자 상태와 EEG recording을 확인하세요. 다음 trial들의 시작·끝 marker는 사이트가 자동으로 저장합니다.",
        "Block 2 · 확인 버튼 또는 SPACE",
        "확인했습니다 · 2블록 시작",
      );
    }
  }
  setProgress("자료 마무리", total, total);
}

async function runTaskTrial(trial, { kind, feedback }) {
  const practice = kind === "practice";
  const prefix = practice ? "PRACTICE_" : "";
  const dataOrigin = practice ? "PRACTICE" : state.store.meta.dataOrigin;
  const flagsBefore = currentFlags();
  state.store.emit(`${prefix}FIXATION_ONSET`, trial.trialId, trial.condition, practice ? "practice" : "main");
  clearExperimentOverlay();
  drawFixation(canvas);
  await sleep(TIMING_MS.fixation);
  await waitWhilePaused();

  await nextFrame(() => drawTrial(canvas, trial, state.monitor));
  const onset = state.store.emit(`${prefix}TASK_ONSET`, trial.trialId, trial.condition, practice ? "practice" : "main", {
    cue_direction: trial.cueDirection,
    stimulus_seed: trial.stimulusSeed,
  });
  await sleep(TIMING_MS.taskAndCue);
  await waitWhilePaused();

  drawResponsePrompt(canvas, "중앙 패턴 판단", "F = SAME · J = DIFFERENT");
  const expectedPrimaryKey = trial.primarySame ? "f" : "j";
  const primary = await collectKey(["f", "j"], TIMING_MS.primaryResponse, expectedPrimaryKey);
  await waitWhilePaused();
  const primaryResponse = primary.key === "f" ? "SAME" : primary.key === "j" ? "DIFFERENT" : "";
  state.store.emit(`${prefix}PRIMARY_RESPONSE`, trial.trialId, trial.condition, practice ? "practice" : "main", {
    response: primaryResponse,
    rt_s: primary.rtSeconds,
    timed_out: !primary.key,
  });

  drawResponsePrompt(canvas, "화살표 방향 판단", "↑ · ↓ · ← · → 방향키");
  const expectedCueKey = Object.entries(KEYS.cue).find(([, direction]) => direction === trial.cueDirection)[0];
  const cue = await collectKey(Object.keys(KEYS.cue), TIMING_MS.cueResponse, expectedCueKey);
  await waitWhilePaused();
  const cueResponse = cue.key ? KEYS.cue[cue.key] : "";
  state.store.emit(`${prefix}CUE_RESPONSE`, trial.trialId, trial.condition, practice ? "practice" : "main", {
    response: cueResponse,
    rt_s: cue.rtSeconds,
    timed_out: !cue.key,
  });

  drawBlank(canvas);
  await sleep(trial.itiMs);
  state.store.emit(`${prefix}TRIAL_END`, trial.trialId, trial.condition, practice ? "practice" : "main");
  const row = {
    participant: state.setup.participant,
    session: state.setup.session,
    block: trial.block,
    block_trial: trial.blockTrial,
    trial: trial.trial,
    trial_id: trial.trialId,
    condition: trial.condition,
    eccentricity: trial.eccentricity,
    direction: trial.direction,
    cue_direction: trial.cueDirection,
    primary_same: Number(trial.primarySame),
    primary_response: primaryResponse,
    primary_correct: Number(primaryResponse === (trial.primarySame ? "SAME" : "DIFFERENT")),
    primary_rt_s: primary.rtSeconds?.toFixed(6) ?? "",
    cue_response: cueResponse,
    cue_correct: Number(cueResponse === trial.cueDirection),
    cue_rt_s: cue.rtSeconds?.toFixed(6) ?? "",
    stimulus_onset: onset.toFixed(6),
    phase: practice ? "practice" : "main",
    seed: trial.seed,
    stimulus_seed: trial.stimulusSeed,
    data_origin: dataOrigin,
    integrity_flags: [flagsBefore, currentFlags()].filter(Boolean).join(";") || "",
  };
  if (feedback) {
    const ok = row.primary_correct && row.cue_correct;
    drawBlank(canvas);
    clearExperimentOverlay();
    showExperiment(messageHtml(ok ? "정답" : "응답 확인", `중앙: ${trial.primarySame ? "SAME" : "DIFFERENT"} · 화살표: ${trial.cueDirection}`), "연습 자료 · 본실험 제외");
    await sleep(700);
    clearExperimentOverlay();
    drawBlank(canvas);
  }
  return row;
}

async function handleRunError(error) {
  state.running = false;
  releaseRunLock();
  state.store?.emit("RUN_ERROR", "RUN", "NONE", "operator", { message: String(error?.message || error) });
  state.store?.complete(error?.message === "RUN_ABORTED_BY_OPERATOR" ? "ABORTED" : "ERROR");
  hideExperiment();
  pauseLayer.hidden = true;
  await exitFullscreen();
  renderCompletion(error?.message === "RUN_ABORTED_BY_OPERATOR" ? "실험 중단됨" : "오류로 종료됨", error);
}

function renderCompletion(title, error = null) {
  cleanScreen();
  hideProgress();
  setStatus(title, error ? "error" : "ready");
  const store = state.store;
  if (!store) return renderHome();
  const files = store.fileDefinitions();
  app.innerHTML = `<section class="panel"><span class="eyebrow">Final · Local export</span><h2>${escapeHtml(title)}</h2>${error ? `<div class="notice danger">${escapeHtml(error.message || String(error))}</div>` : `<div class="notice success">수집된 자료는 아직 이 브라우저 안에만 있습니다. 아래 파일을 모두 내려받은 뒤 EEG CSV와 함께 백업하세요.</div>`}<div class="summary-grid"><div class="summary-item"><strong>${store.behavior.length}</strong><span>main/pilot rows</span></div><div class="summary-item"><strong>${store.calibrationBehavior.length}</strong><span>calibration rows</span></div><div class="summary-item"><strong>${store.markers.length}</strong><span>markers</span></div><div class="summary-item"><strong>${store.status}</strong><span>run status</span></div></div><div class="download-grid">${files.map((file) => `<div class="download-card"><h3>${escapeHtml(file.name)}</h3><p>${escapeHtml(file.description)}</p><button class="button secondary" data-download="${file.id}">다운로드</button></div>`).join("")}</div><div class="notice">필수 확인: main/pilot 행동 CSV, marker CSV, session JSON, calibration CSV, schedule CSV와 MeasureWiz 원본 CSV의 participant/session이 일치해야 합니다.</div><div class="button-row"><button id="downloadAll" class="button primary">6개 파일 모두 다운로드</button><button id="finishSession" class="button success">다운로드 확인·체크포인트 정리</button></div></section>`;
  document.querySelectorAll("[data-download]").forEach((button) => button.addEventListener("click", () => store.download(button.dataset.download)));
  document.querySelector("#downloadAll").addEventListener("click", () => { store.downloadAll(); showToast("브라우저가 여러 다운로드를 차단하면 각 파일 버튼을 눌러주세요."); });
  document.querySelector("#finishSession").addEventListener("click", () => {
    if (!confirm("필수 파일과 MeasureWiz 원본 CSV를 모두 확인했나요? 브라우저 체크포인트를 정리합니다.")) return;
    store.clearCheckpoint();
    state.store = null;
    renderHome();
  });
}

renderHome();
