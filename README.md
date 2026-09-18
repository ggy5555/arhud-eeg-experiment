# AR-HUD × EEG 실험 실행기

**연구 제목:** EEG 및 작업 수행 분석을 통한 개인 맞춤형 시각 보조정보 배치 알고리즘 설계 및 검증: AR 작업보조 HUD 적용을 위한 모니터 기반 시뮬레이션 연구

이 저장소는 실제 AR/HMD 제품을 직접 검증하는 앱이 아니다. 일반 모니터에서 AR 작업보조 HUD의 정보 배치를 단순화해 모사하고, 중앙 과제·HUD 화살표 과제의 행동 응답과 EEG 정렬용 시간 marker를 기록하는 **controlled simulation / proof-of-concept 실험 도구**다.

> 상태: 소프트웨어 구현 및 순수 로직 검사는 완료했다. 실제 참가자 본실험 전에는 반드시 실제 모니터 geometry, MeasureWiz 원본 CSV, 수동 TRIGGER 동기화, 학교 연구 지침을 pilot으로 검증해야 한다.

## 실행

- 공개 실험 페이지: <https://ggy5555.github.io/arhud-eeg-experiment/>
- 설치 없이 Chrome/Edge에서 열 수 있다.
- 로컬 실행이 필요하면 저장소 폴더에서 `python -m http.server 8000`을 실행하고 `http://localhost:8000`을 연다.

사이트가 순서대로 `세션 설정 → 환경 점검 → 응답키 점검 → 연습 → EEG 녹화·동기화 → calibration → 본실험 → 파일 다운로드`를 안내한다. 과제·보정 설명 화면은 자동으로 넘어가지 않으며, 참가자 또는 실험자가 **“이해했습니다” 버튼이나 SPACE**로 확인해야 다음 단계가 시작된다.

## 최종 고정 프로토콜

| 항목 | 값 |
|---|---|
| 위치 조건 | `CENTER`, `N-L`, `N-R`, `N-T`, `N-B`, `N-BR` |
| 위치 | CENTER 0°, 나머지 2.39° |
| 반복 | 6조건 × 8회 = 48 trials |
| 블록 | 2 blocks × 24 trials; 조건별 block당 4회 |
| trial | fixation 1.0 s → task+cue 3.0 s → primary ≤1.2 s → cue ≤1.2 s → ITI 0.6–1.0 s |
| block 휴식 | 60 s |
| 중앙 응답 | `F`=SAME, `J`=DIFFERENT |
| cue 응답 | 방향키 `↑ ↓ ← →` |
| calibration | eyes open 30 s, eyes closed 30 s, 0-back 60 s, rest 30 s, 2-back 60 s |

Randomization은 참가자 ID와 session ID로부터 재현 가능한 seed를 만든다. 각 조건은 block마다 정확히 4회, 전체 8회 등장한다. SAME/DIFFERENT는 전체 24/24이고 각 조건 안에서 4/4다. 각 cue 방향은 각 위치에서 2회씩 등장하며, cue 위치와 화살표가 뜻하는 방향은 독립적이다. 같은 위치가 3회 연속 나오지 않는다.

## 실험 전 권장 순서

1. **화면 위치 검증**에서 모니터 가로폭과 눈–화면 거리를 입력한다.
2. 표시된 5 cm 눈금을 실물 자로 확인하고, 2.39° 위치가 화면 안에 들어오는지 확인한다.
3. **6-trial 파일럿**으로 키, 자극, 로컬 저장, marker, MeasureWiz TRIGGER 정렬을 검사한다.
4. MeasureWiz에서는 스트레스 패러다임이 아니라 `생체신호 측정 → EEG → 녹화 시작`을 사용한다.
5. EEG 파일과 사이트에 같은 익명 participant/session 식별자를 사용한다.
6. pilot의 EEG CSV와 marker CSV로 TRIGGER offset·drift·누락 여부를 분석한다.
7. 담당 교사 확인과 protocol lock 후에만 **48-trial 본실험**을 실행한다.

## EEG 동기화의 범위

사이트는 MeasureWiz와 직접 통신하거나 장비 파일에 hardware marker를 삽입하지 않는다. 동기화 화면에서 흰색 플래시와 안내가 나타나면 실험자가 MeasureWiz 앱의 `TRIGGER`를 누르고 화면의 **“TRIGGER를 눌렀습니다”** 버튼 또는 `SPACE`로 확인한다. 사이트는 같은 순간의 `SYNC_TRIGGER_REQUEST`와 확인 시각을 marker CSV에 남긴다.

MeasureWiz의 수동 `TRIGGER`를 48개 문제마다 누르지 않는다. 사이트가 각 trial의 `TASK_ONSET`, `PRIMARY_RESPONSE`, `CUE_RESPONSE`, `TRIAL_END`를 자동 기록한다. 수동 TRIGGER는 세션 시작, 본실험 시작, 2블록 시작, 세션 종료에만 사용하여 두 시간축의 offset과 drift를 추정한다.

따라서 이 방식의 정확도는 아직 확정되지 않았다. 실제 pilot에서 MeasureWiz CSV의 trigger 표현, 사이트 marker와의 offset, 기록 중 drift를 확인한 뒤 분석 adapter를 확정해야 한다. 장비 sampling rate·channel name·reference·filter·artifact threshold는 이 웹사이트가 추측하거나 설정하지 않는다.

## 저장되는 파일

모든 파일은 서버 전송 없이 **현재 브라우저에서 로컬 다운로드**된다.

| 파일 | 내용 |
|---|---|
| `*_main_behavior.csv` | 본실험 또는 pilot의 trial별 조건·정답·응답·정확도·반응시간 |
| `*_markers.csv` | 자극·응답·trial 종료·수동 동기화의 브라우저 monotonic timestamp |
| `*_calibration_behavior.csv` | 0-back·2-back의 trial별 행동 기록 |
| `*_practice_behavior.csv` | 본자료와 분리된 6회 연습 기록 |
| `*_schedule.csv` | seed와 실제 제시 순서 |
| `*_session.json` | 설정·상태·행동·marker·이상사항을 합친 복구용 기록 |

정상 본실험의 `data_origin`은 `EMPIRICAL`, pilot은 `PILOT`, 연습은 `PRACTICE`다. `?qa=1` 단축 검사용 자료는 `DRY_RUN_QA`로 저장되므로 연구 결과에 사용하면 안 된다.

## 데이터 보존과 개인정보

- 이름·학번·연락처 대신 익명 ID만 입력한다.
- 참가자 CSV와 EEG 원자료를 이 공개 저장소에 올리지 않는다.
- 실험 종료 직후 6개 사이트 출력 파일과 MeasureWiz 원본 CSV를 같은 참가자 폴더에 백업한다.
- 원본 파일을 직접 수정하거나 결과가 이상하다는 이유로 삭제하지 않는다.
- 중단·전체화면 이탈·탭 전환은 session과 `integrity_flags`에 기록된다.
- 미완료 세션은 브라우저 `localStorage`에 체크포인트로 남으며, 새 세션 전에 부분 JSON을 내려받아야 한다.

## 자동검사

Node.js가 설치된 환경에서 다음을 실행한다.

```bash
npm test
```

검사는 48-trial 수, 2×24 block, 조건·SAME/DIFF·cue 방향 균형, 3회 연속 금지, seed 재현성, 2.39° geometry, connector SAME/DIFF, n-back, CSV header 계약을 확인한다.

## 주요 파일

- `js/config.js`: 고정 조건·시간·응답키·CSV 열
- `js/randomization.js`: seed와 trial schedule
- `js/stimuli.js`: 시야각 좌표와 화면 자극
- `js/data.js`: 체크포인트와 CSV/JSON 내보내기
- `js/app.js`: 전체 실험 진행 흐름
- `tests/self-test.mjs`: 장비 없이 가능한 자동검사
- `IMPLEMENTATION_STATUS.md`: 완료/검증/장비 확인/미완료 구분

## 본실험 전에 남은 필수 확인

- [ ] 학교 연구 지침, 참가 동의·중단 절차, 익명 ID 규칙 확정
- [ ] 실제 실험용 컴퓨터에서 Chrome/Edge 전체 흐름 실행
- [ ] 실제 모니터 폭·해상도·60 cm 시청 거리 geometry 확인
- [ ] MeasureWiz raw CSV schema와 TRIGGER 값 확인
- [ ] block 시작·끝에서 offset과 drift가 허용 가능한지 검증
- [ ] 분석 코드가 웹 marker와 MeasureWiz raw CSV를 정확히 결합하는지 검증
- [ ] pilot 기록 후 설정을 잠그고 본실험 시작

현재 실제 참가자 결과, EEG 대역 파워, p-value, 효과크기, reward 또는 UCB 추천 결과는 포함되어 있지 않다.
