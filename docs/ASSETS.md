# 외부 자산 · 라이선스 목록

게임에 들어간 외부 자산(음악, 효과음, 폰트, 라이브러리)과 라이선스를 정리한 문서예요.
게임 안에서는 **타이틀 화면 오른쪽 위 → 크레딧** 버튼에서 같은 내용을 볼 수 있어요.

마지막 확인: 2026-10-20 (각 출처 페이지와 `node_modules/*/package.json` 기준)

## 1. 오디오 (`public/assets/audio/`)

| 파일 | 쓰이는 곳 | 원제 · 저작자 | 출처 | 라이선스 | 표기 의무 |
|---|---|---|---|---|---|
| `bgm_lobby.m4a` (118.6초) | 로비 배경음악: 타이틀, 스테이지 선택, 엔딩(수료증) 화면 (끊김 없이 반복 재생) | "Snowland Town" · Matthew Pablo | https://opengameart.org/content/snowland-town (OpenGameArt.org) | CC BY 3.0 (http://creativecommons.org/licenses/by/3.0/) | **필수.** 저작자·곡 제목·출처·라이선스 링크를 표기해야 해요. 작곡가가 요청한 표기 형식: "Music by Matthew Pablo — www.matthewpablo.com" + 곡 제목. → 게임 크레딧에 "Snowland Town" — Music by Matthew Pablo — www.matthewpablo.com, OpenGameArt.org 링크, CC BY 3.0 링크를 표기함. 파일은 OpenGameArt에서 받은 묶음(Snowland Collection)의 `Snowland Loop.wav`(118.59초, 반복용 버전)를 길이·내용 그대로 AAC(m4a)로 변환만 한 것이고(2026-10-20 확인: 샘플 수 5,229,666개로 같음), 게임도 그대로 반복 재생해요 |
| `bgm_normal.m4a` (91.8초) | 스테이지 안 배경음악: 플레이 중, 스테이지 클리어 결과 창 (반복 재생) | "Bouncing Around in Pixel Town (Looping)" · Eric Matyas | https://soundimage.org/positive-upbeat/ | soundimage.org 자체 조건: 로열티 프리, 무료 | **필수.** 게임 안에 "Music by Eric Matyas, www.soundimage.org" 형태로 표기해야 해요 (영상 설명란·스토어 페이지만으로는 안 됨). 다른 작가 곡과 섞어 쓰면 곡 제목도 함께 적어요. 표기하지 않으려면 곡당 30달러 비표기 라이선스를 사야 해요. → 게임 크레딧에 곡 제목·작가·사이트 표기함 |
| `bgm_incident.m4a` (24.0초) | 장애가 하나라도 진행 중일 때 배경음악 (반복 재생) | "ピンチ - 8bit" (핀치) · Hupple | https://opentracks.com/en/bgm/detail/12977 (OpenTracks, 옛 DOVA-SYNDROME) | OpenTracks 라이선스 (https://opentracks.com/en/help/articles/license/): 상업·비상업 모두 무료, 게임 BGM 사용 허용 | 선택. 사이트 약관상 표기 의무 없음, 작곡가가 가능하면 "Hupple" 또는 페이지 주소 표기를 부탁함. → 게임 크레딧에 표기함 |
| `sfx_alarm.m4a` (1.7초) | 장애 발생 경보음 (장애가 터진 순간 + 3.5초 간격, 모두 4번) | "Short alarm" · yd | https://opengameart.org/content/short-alarm | CC0 1.0 (퍼블릭 도메인) | 없음. → 게임 크레딧에 표기함 |
| `sfx_win.m4a` (3.8초) | 장애를 해결해 개념 카드가 뜰 때, "Stage N 클리어!" 결과 창이 뜰 때, 마지막 엔딩(수료증) 화면이 뜰 때 | "Win Jingle" (fretless 버전) · Fupi | https://opengameart.org/content/win-jingle | CC0 1.0 (퍼블릭 도메인) | 없음 (작곡가가 게임 링크를 남겨 달라고 부탁함). → 게임 크레딧에 표기함 |
| `sfx_coin.m4a` (0.76초) | 목표를 하나 끝냈을 때, 처음 모은 개념 카드가 생겼을 때 (같은 순간의 여러 개는 한 번만) | "Coin Bling - Sound Effect" · Tung Lee Media | https://www.youtube.com/watch?v=3D_Wl3e7ddE (YouTube) | 저작자에게 사용 허락을 받음 (used with permission) — 공개 라이선스가 아니라 개별 허락 | 허락받은 사용이라는 것과 저작자를 밝혀 두는 것이 안전해요. → 게임 크레딧에 "Coin Bling - Sound Effect" by Tung Lee Media (YouTube 링크) — used with permission을 표기함. 파일은 영상 소리(1.23초)에서 앞의 무음 0.005초와 0.76초 뒤의 잔향 꼬리를 잘라낸 것이고, 게임은 잘린 끝이 '딸깍' 하지 않게 마지막 0.04초를 줄여서 끝내요 |
| `voice_animalese.wav` (3.9초) | 대화창 글자가 나올 때 한 글자마다 나는 '웅얼' 소리 | "animalese.wav" · Josh Simmons | https://github.com/Acedio/animalese.js | CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/) | **필수.** 저작자, 출처, 라이선스 링크, 변경 여부를 표기해야 해요. → 게임 크레딧에 저작자·출처·CC BY 4.0 링크와 "글자별로 잘라 음높이를 바꿔 재생"을 표기함 |

### 오디오 주의 사항

- **`sfx_coin.m4a`는 개별 허락으로 쓰는 소리예요.** 공개 라이선스(CC 등)가 아니라 저작자(Tung Lee Media)에게 받은 허락이라, 허락받은 기록(메시지·메일 캡처 등)을 팀에서 보관해 두세요. 허락 범위를 벗어나는 사용(음원만 따로 배포 등)은 하지 않아요.
- **CC BY 3.0(`bgm_lobby.m4a`).** 표기를 빼거나 다른 사람이 만든 것처럼 보이게 하면 안 돼요. 지금 파일은 원본 `Snowland Loop.wav`를 형식만 바꾼 것이라(자르기·편곡 없음) "편집함" 표기는 필요 없어요 (CC BY 3.0은 다른 형식으로 바꾸는 데 필요한 기술적 변경을 허용해요). 나중에 곡을 자르거나 고쳐 넣으면 그때는 크레딧에 "편집함"을 함께 적어요.
- **음량 맞춤.** 세 배경음악은 원래 음량이 크게 달라요(측정한 통합 음량: 로비 −14.6 LUFS, 평상시 −18.0 LUFS, 장애 −6.0 LUFS). 게임은 곡마다 게인을 따로 줘서 셋 다 평상시 곡과 같은 크기로 들리게 해요 (`src/audio/logic.ts`의 `MUSIC_LUFS`·`loudnessGains`). 음악 파일을 바꾸면 이 숫자도 다시 재야 해요 — `npx vitest run tests/audio.test.ts`가 macOS에서 파일을 직접 재서 다르면 알려줘요.
- **곡 전환.** 로비 ↔ 스테이지, 장애 해결 후 평상시 곡으로 돌아갈 때는 2.8초 동안 equal-power 크로스페이드(가운데에서 소리가 꺼지지 않는 방식)로 부드럽게 바뀌고, 장애가 터질 때만 0.3초로 빠르게 바뀌어요. 로비 곡과 평상시 곡은 멈췄던 곳부터 이어서, 장애 곡은 처음부터 나와요.
- **효과음 겹침.** 목표 하나·새 카드처럼 같은 순간에 생긴 일은 코인 한 번으로 묶고, 새 카드가 나온 장애 해결은 코인 → 0.5초 뒤 징글 순서로 나와요. 징글이 아직 울리는 중에 다음 징글이 나오면(클리어 창에서 바로 '다음'을 눌러 수료증이 뜰 때 등) 앞 징글은 0.08초 만에 줄어들어 한 번에 하나만 들려요.
- **OpenTracks(`bgm_incident.m4a`) 금지 사항.** 약관 금지 사항 7번은 음원을 그 자체로 배포·판매하는 것("최종 사용자가 음원만 따로 쓸 수 있게 하는 모든 방식"), 8번은 "최종 사용자가 오디오 파일을 변환 없이 쉽게 접근·복제할 수 있는 상태로 쓰는 것"을 금지해요. 웹 게임은 브라우저가 음원 파일을 내려받기 때문에 8번에 걸린다고 볼 여지가 있어요. 심사에서 문제가 될 수 있다면 제출 전에 OpenTracks에 문의하거나 CC0 곡으로 바꾸는 것을 권장해요.
- **animalese 소리 재생 방식.** animalese.js 코드(MIT)는 복사하지 않았고, 재생 방식만 참고해 새로 만들었어요 (`src/audio/engine.ts`). 한 글자마다 그 글자 소리의 앞 0.075초를 재생 속도(=음높이)를 바꿔 틀어요. 한글은 초성으로(ㅇ이면 모음으로) 영어 알파벳에 대응시켜요 (`src/audio/logic.ts`).
- 음높이: animalese.js 데모의 슬라이더(Grump 0.2 ~ Isabelle 2.0, 가운데 1.1) 기준으로 나(사자) = 가운데에서 Isabelle 쪽으로 5% (1.19), 쿠사수·팀장님 = Grump 쪽으로 15% (0.83). 도움말(💡)에는 소리가 없어요.

## 2. 폰트

모두 SIL Open Font License 1.1이에요. 게임 안 사용·웹 폰트 포함 배포가 자유롭고 표기 의무는 없어요. 폰트 파일만 따로 판매하는 것은 금지예요.

| 폰트 | 쓰이는 곳 | 저작자 | 패키지 (버전) | 라이선스 |
|---|---|---|---|---|
| Galmuri11 | 제목, 버튼 등 픽셀 글꼴 | quiple (이민서) | `galmuri` 2.40.3 · https://galmuri.quiple.dev | SIL OFL 1.1 |
| Noto Sans KR | 본문 | Google | `@fontsource/noto-sans-kr` 5.3.1 | SIL OFL 1.1 |
| Nanum Gothic Coding (나눔고딕코딩) | 터미널 | Naver | `@fontsource/nanum-gothic-coding` 5.3.0 | SIL OFL 1.1 |

## 3. 주요 라이브러리 (npm)

배포되는 게임에 포함되는 라이브러리예요. 모두 MIT 라이선스이고, 빌드 결과물에 포함될 때 저작권 고지를 지우지 않으면 돼요.

| 패키지 | 버전 | 용도 | 라이선스 |
|---|---|---|---|
| `phaser` | 3.90.0 | 2D 게임 엔진 (데이터센터 맵) | MIT |
| `react`, `react-dom` | 19.3.1 | 화면(UI) | MIT |
| `zustand` | 5.0.15 | 게임 상태 관리 | MIT |
| `@xterm/xterm`, `@xterm/addon-fit` | 5.5.0, 0.10.0 | 게임 속 터미널 | MIT |
| `recharts` | 2.15.4 | 관제 대시보드 그래프 | MIT |

개발 도구 (배포 파일에는 들어가지 않음): `vite` 7.3.7 (MIT), `@vitejs/plugin-react` 5.2.0 (MIT), `vitest` 4.1.12 (MIT), `typescript` 5.9.3 (Apache-2.0), `@playwright/test` 1.64.1 (Apache-2.0).

## 4. 팀 자체 제작

- **사자 캐릭터**는 팀이 직접 만든 32×32 픽셀 스프라이트예요. 원본 시트 · 메타데이터 · 생성 스크립트(Python Pillow)는 `art/lion_sprite/`에 있고, 게임은 `public/assets/sprites/lion.png`와 먼지 효과 시트(`dust_*.png`)를 그대로 써요.
- 대화 초상화(사자 · 쿠사수 · 팀장님 · 안내), 맵 타일 · 장비 그림, 타이틀 배경은 외부 이미지 없이 코드로 그린 픽셀 아트예요 (`src/game/art/`).
