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
- [ ] 정적 HTML/CSS 화면 및 실험자 단계 안내
- [ ] visual-degree geometry와 3×3 connector stimulus
- [ ] calibration, pilot, 48-trial main 실행
- [ ] 행동·marker·session·partial 자료 다운로드
- [ ] 자동 self-test, 브라우저 시각검사 및 GitHub Pages 배포 확인

## 미확정/장비 확인 필요

- MeasureWiz native trigger와 웹 marker 사이 offset·drift·누락
- 브라우저 및 실제 모니터의 frame timing
- 실제 모니터 폭·시청 거리·전체화면 geometry
- 학교 연구 지침·동의 절차 및 protocol lock

## 다음 작업

1. 앱 골격과 설정 검증을 구현한다.
2. 순수 randomization/geometry 코어와 self-test를 구현한다.
3. 자극·calibration·저장·복구 흐름을 구현한다.
4. 자동검사 및 실제 렌더링을 점검한다.
5. 의미 있는 단위마다 커밋하고 Pages 상태를 확인한다.
