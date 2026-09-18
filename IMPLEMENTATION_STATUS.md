# IMPLEMENTATION STATUS

기준일: 2026-09-15  
대상: `arhud-eeg-experiment` 웹 실험 실행기

## ✅ 구현 완료

- 익명 participant/session 입력과 완료 ID 충돌 검사
- 모니터 가로폭·해상도·시청 거리 입력
- visual-degree 기반 `CENTER`, `N-L`, `N-R`, `N-T`, `N-B`, `N-BR` 좌표
- 5 cm 눈금과 2.39° 위치를 확인하는 geometry validation mode
- 중앙의 두 3×3 connector pattern SAME/DIFFERENT 과제
- 위치와 독립적으로 randomize되는 네 방향 화살표 cue
- 6조건×8회=48 trials, 2 blocks×24 trials
- 조건·SAME/DIFF·cue 방향 균형과 같은 위치 3회 연속 금지
- F/J/방향키 사전 점검과 6회 연습
- 과제·calibration 설명을 읽은 뒤 “이해했습니다” 버튼 또는 SPACE로 진행하는 수동 확인 게이트
- eyes-open, eyes-closed, 0-back, rest, 2-back calibration 화면
- 세션 시작·본실험 시작·block2 시작·세션 종료의 수동 TRIGGER 동기화 안내
- 매 trial의 시작·응답·종료는 웹 marker로 자동 저장하고 수동 TRIGGER는 매 trial마다 누르지 않는다는 안내
- 행동·calibration·practice·schedule CSV, marker CSV, session JSON 로컬 저장
- `EMPIRICAL`/`PILOT`/`PRACTICE`/`DRY_RUN_QA` 분리
- 중단·예외·전체화면 이탈 시 체크포인트 및 부분 자료 보존
- 공개 저장소로 참가자 자료를 전송하는 코드 없음

## 🧪 실제 실행 확인

- `npm test`: PASS
- `node --check js/app.js`: PASS
- `node --check js/data.js`: PASS
- `node --check js/stimuli.js`: PASS
- 자동검사 범위: 48 trials, 2×24 blocks, 조건/정답/cue 균형, seed 재현성, 3연속 금지, 위치 반지름, connector, n-back, CSV header

배포된 `web3`에서 브라우저 전체 QA를 완료했다. 종료 화면에서 48 main/pilot rows, 30 calibration rows, 386 markers, `COMPLETE`, 6종 다운로드 항목을 확인했다. QA 중 0-back/2-back 안내 overlay가 숫자 자극을 가리는 문제를 발견하여 `web4`에서 수정했다. GitHub Actions run #4가 성공했고, 공개 `web4` 화면에서 100개 seed 자동검사 PASS를 재확인했다.

원격 QA 브라우저에서는 전체화면 API가 허용되지 않아 `FULLSCREEN_REQUEST_FAILED`가 기록되었다. **실제 실험용 컴퓨터의 Chrome/Edge에서 geometry, 전체화면, 응답키, 6-trial pilot을 직접 확인하는 절차는 여전히 필수**다.

## ⚠️ 장비 확인 후 필요

- MeasureWiz 원본 EEG CSV의 정확한 column, sampling interval, trigger 표현 확인
- 앱 `TRIGGER`와 웹 `SYNC_TRIGGER_REQUEST` 사이의 offset 측정
- 기록 길이에 따른 clock drift와 trigger 누락 확인
- 실제 sampling rate, channel name, reference, filter/notch, artifact 기준 확정
- SIG/REF/GND 부착 및 신호 품질 절차를 공식 매뉴얼·담당자와 최종 확인
- 웹 marker/행동 CSV와 기존 EEG 전처리 pipeline을 잇는 adapter 검증

## ⬜ 아직 미완료

- 학교 연구 지침과 참가 동의 문서의 승인
- 실제 pilot 참가자 자료를 이용한 end-to-end 분석 검증
- MeasureWiz CSV adapter의 확정
- 실제 EEG 전처리·Theta/Alpha/Beta 분석 결과
- reward 계산 결과와 UCB 개인 맞춤 위치 추천 검증
- 실제 참가자 수, 정확도, RT, EEG 값, 통계량, p-value, 효과크기

## 실제 pilot 시작 순서

1. GitHub Pages 주소를 Chrome/Edge에서 연다.
2. `화면 위치 검증`으로 5 cm 눈금과 2.39° 위치를 확인한다.
3. 학교 연구 지침·동의·익명 ID 규칙을 확인한다.
4. MeasureWiz를 연결하고 raw EEG가 기록되는지 확인한다.
5. 사이트에서 `6-trial 파일럿`을 선택하고 다른 session ID를 사용한다.
6. 안내에 따라 MeasureWiz EEG 녹화와 수동 TRIGGER를 진행한다.
7. 종료 화면의 6개 파일과 MeasureWiz 원본 CSV를 모두 백업한다.
8. trigger offset·drift·누락과 CSV schema를 확인한다.
9. 문제가 없을 때 설정을 `LOCKED`하고 48-trial 본실험으로 넘어간다.

본실험은 위의 장비·동기화·윤리 확인이 끝나기 전까지 시작하지 않는다.
