# WORK PROGRESS — ARHUD EEG Web Experiment

최종 목표: GitHub Pages에서 실행되는 모니터 기반 AR-HUD 실험 도구를 구현한다. 참가자에게 실제 자극을 제시하고, 행동 응답과 로컬 동기화 marker를 기록하며, 모든 자료는 브라우저에서만 보존·다운로드한다.

## 확정 계약

- 조건: `CENTER`, `N-L`, `N-R`, `N-T`, `N-B`, `N-BR`
- 반복: 6조건 × 8회 = 48 trials
- 블록: 2 × 24 trials
- timing: fixation 1.0초 → task+cue 3.0초 → primary 1.2초 → cue 1.2초 → ITI 0.6–1.0초
- 응답: `F=SAME`, `J=DIFFERENT`, 방향키=화살표 방향
- calibration: eyes-open 30초, eyes-closed 30초, 0-back 60초, rest 30초, 2-back 60초
- EEG 연결: MeasureWiz 직접 연동을 가정하지 않는다. 웹 monotonic timestamp와 marker CSV를 저장하고 수동 TRIGGER 정렬을 pilot에서 검증한다.
- 개인정보: 익명 participant ID만 사용하고 네트워크 전송·저장소 업로드 기능을 만들지 않는다.

## 현재 상태

- [x] GitHub 저장소 초기 상태 확인: README와 LICENSE만 존재
- [x] 최종 Python 패키지의 조건·randomization·timing·CSV marker 계약 재확인
- [x] 정적 HTML/CSS 화면 및 실험자 단계 안내 구현
- [x] visual-degree geometry와 3×3 connector stimulus 구현
- [x] eyes-open/closed, 0-back/2-back calibration, pilot, 48-trial main 흐름 구현
- [x] 행동·marker·session·practice·schedule·partial 자료의 로컬 다운로드 및 체크포인트 구현
- [x] Node self-test: 48-trial 균형, seed 재현성, 좌표, connector, n-back, CSV 계약 통과
- [x] 실제 브라우저 전체 흐름 확인 및 GitHub Pages 배포 확인

## 생성·수정한 주요 파일

- `index.html`, `styles.css`: 실험자 단계 안내와 참가자 자극 화면
- `js/config.js`: 48-trial 확정 조건·시간·키·CSV 계약
- `js/randomization.js`: 균형 randomization, participant seed, pilot/n-back schedule
- `js/stimuli.js`: 시야각 좌표, 3×3 connector, cue, geometry·sync 화면
- `js/data.js`: 로컬 checkpoint와 CSV/JSON 다운로드
- `js/app.js`: preflight→연습→EEG 수동 동기화→calibration→본실험→저장 흐름
- `tests/self-test.mjs`: 장비 없는 순수 로직 자동검사

## 미확정/장비 확인 필요

- MeasureWiz native trigger와 웹 marker 사이 offset·drift·누락
- 브라우저 및 실제 모니터의 frame timing
- 실제 모니터 폭·시청 거리·전체화면 geometry
- 학교 연구 지침·동의 절차 및 protocol lock

## 다음 작업

1. 현재 UI·저장 구현을 GitHub에 체크포인트 커밋한다.
2. README와 구현 상태·실험 당일 사용 순서를 작성한다.
3. GitHub Pages 배포 설정을 추가하고 공개 주소를 확인한다.
4. [완료] 배포된 브라우저에서 48-trial QA 전체 흐름과 6종 다운로드 화면을 확인했다.
5. 실제 MeasureWiz pilot으로 trigger offset·drift·원본 CSV schema를 검증한다.

## 검증 기록

- 2026-09-15: `npm test` PASS. 48-trial/2-block/6-condition/SAME-DIFF/cue-direction/CSV 계약 검증.
- 2026-09-15: `node --check`로 `app.js`, `data.js`, `stimuli.js` 문법 PASS.
- 2026-09-15: 배포된 `web3`에서 전체 QA 완료. 48 main/pilot rows, 30 calibration rows, 386 markers, `COMPLETE`, 다운로드 6종 확인.
- 2026-09-15: QA 중 0-back/2-back 안내 overlay가 숫자 자극을 가리는 문제를 확인해 `web4`에서 안내를 지운 뒤 자극을 제시하도록 수정.
- 2026-09-15: GitHub Actions run #4 성공, 공개 Pages에서 `v2026.09.15-web4` 확인, 배포 화면의 100-seed 자동검사 PASS.
- 2026-09-18: 설명 화면이 빨리 넘어간다는 사용성 피드백을 반영해 모든 과제·calibration 안내에 “이해했습니다” 버튼/SPACE 확인 게이트를 추가함.
- 2026-09-18: 매 trial의 시작·응답·종료는 웹 marker로 자동 기록하고, MeasureWiz 수동 TRIGGER는 세션/블록 기준점에서만 누른다는 안내를 추가함.
- 원격 QA 환경에서는 전체화면 API가 거부되어 `FULLSCREEN_REQUEST_FAILED`가 기록됨. 실제 실험용 Chrome/Edge에서 전체화면과 geometry를 별도 확인해야 함.
