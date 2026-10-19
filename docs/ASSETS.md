# 외부 자산 · 라이선스 목록

게임에 들어간 외부 자산(음악, 효과음, 폰트, 라이브러리)과 라이선스를 정리한 문서예요.
게임 안에서는 **타이틀 화면 오른쪽 위 → 크레딧** 버튼에서 같은 내용을 볼 수 있어요.

마지막 확인: 2026-10-20 (각 출처 페이지와 `node_modules/*/package.json` 기준)

## 1. 오디오 (`public/assets/audio/`)

| 파일 | 쓰이는 곳 | 원제 · 저작자 | 출처 | 라이선스 | 표기 의무 |
|---|---|---|---|---|---|
| `bgm_normal.m4a` (91.8초) | 평상시 배경음악: 타이틀, 스테이지 선택, 플레이, 결과, 엔딩 (반복 재생) | "Bouncing Around in Pixel Town (Looping)" · Eric Matyas | https://soundimage.org/positive-upbeat/ | soundimage.org 자체 조건: 로열티 프리, 무료 | **필수.** 게임 안에 "Music by Eric Matyas, www.soundimage.org" 형태로 표기해야 해요 (영상 설명란·스토어 페이지만으로는 안 됨). 다른 작가 곡과 섞어 쓰면 곡 제목도 함께 적어요. 표기하지 않으려면 곡당 30달러 비표기 라이선스를 사야 해요. → 게임 크레딧에 곡 제목·작가·사이트 표기함 |
| `bgm_incident.m4a` (24.0초) | 장애가 하나라도 진행 중일 때 배경음악 (반복 재생) | "ピンチ - 8bit" (핀치) · Hupple | https://opentracks.com/en/bgm/detail/12977 (OpenTracks, 옛 DOVA-SYNDROME) | OpenTracks 라이선스 (https://opentracks.com/en/help/articles/license/): 상업·비상업 모두 무료, 게임 BGM 사용 허용 | 선택. 사이트 약관상 표기 의무 없음, 작곡가가 가능하면 "Hupple" 또는 페이지 주소 표기를 부탁함. → 게임 크레딧에 표기함 |
| `sfx_alarm.m4a` (1.7초) | 장애 발생 경보음 (장애가 터진 순간 + 3.5초 간격, 모두 4번) | "Short alarm" · yd | https://opengameart.org/content/short-alarm | CC0 1.0 (퍼블릭 도메인) | 없음. → 게임 크레딧에 표기함 |
| `sfx_win.m4a` (3.8초) | 장애를 해결해 개념 카드가 뜰 때, 스테이지 결과 화면이 뜰 때 | "Win Jingle" (fretless 버전) · Fupi | https://opengameart.org/content/win-jingle | CC0 1.0 (퍼블릭 도메인) | 없음 (작곡가가 게임 링크를 남겨 달라고 부탁함). → 게임 크레딧에 표기함 |
| `voice_animalese.wav` (3.9초) | 대화창 글자가 나올 때 한 글자마다 나는 '웅얼' 소리 | "animalese.wav" · Josh Simmons | https://github.com/Acedio/animalese.js | CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/) | **필수.** 저작자, 출처, 라이선스 링크, 변경 여부를 표기해야 해요. → 게임 크레딧에 저작자·출처·CC BY 4.0 링크와 "글자별로 잘라 음높이를 바꿔 재생"을 표기함 |

### 오디오 주의 사항

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

개발 도구 (배포 파일에는 들어가지 않음): `vite` 7.3.7 (MIT), `@vitejs/plugin-react` 5.2.0 (MIT), `vitest` 4.1.12 (MIT), `typescript` 5.9.3 (Apache-2.0), `@playwright/test` 1.64.1 (Apache-2.0), `sharp` 0.35.5 (Apache-2.0).

## 4. 팀 자체 제작

- **사자 캐릭터 그림**은 팀이 직접 만든 것이에요. 원본은 `art/`에 있고 `npm run sprites`(`scripts/prepare-sprites.mjs`)로 `public/assets/sprites/`, `public/assets/portraits/`의 게임용 이미지를 만들어요.
- 쿠사수·팀장님 초상화와 맵 타일·장비 그림은 외부 이미지 없이 코드로 그린 픽셀 아트예요 (`src/ui/Portrait.tsx`, `src/game/`).
