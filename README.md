# Shorts Blocker for YouTube

유튜브 숏츠(YouTube Shorts) 시청 중 원치 않는 채널을 블랙리스트에 등록하여 동영상을 자동으로 일시정지하고 안내 레이어를 표시해 주는 크롬 확장 프로그램입니다.

---

## 주요 기능

* 채널 블랙리스트 관리: 팝업 메뉴를 통해 원치 않는 유튜브 채널을 자유롭게 추가 및 삭제할 수 있습니다.
* 스마트 자동 일시정지: 블랙리스트에 등록된 채널의 숏츠 영상 진입 시 즉시 동영상을 일시정지합니다.
* 중앙 안내 오버레이: 차단된 영상 화면 중앙에 직관적인 경고 메시지를 표시합니다.
* 수동 재생 지원: 차단된 영상이라도 사용자가 화면을 직접 클릭하면 1회에 한해 계속 시청이 가능합니다.
* 한글 및 특수문자 채널 지원: 한글 아이디나 특수문자가 포함된 채널명도 정확하게 감지합니다.
* 채널 추천 안 함: 차단 안내 오버레이의 버튼으로 유튜브의 '채널 추천 안 함'을 바로 실행할 수 있습니다.
* 관리 페이지: 등록 채널이 많아지면 팝업에는 최근 항목만 표시되고, 전체 목록은 별도 관리 페이지에서 검색·정리합니다.
* 광고 자동 재생 막기(선택): 기본은 꺼져 있으며, 켜면 광고를 일시정지하고 안내를 표시합니다.
* 한국어/영어 UI: 브라우저 언어에 따라 자동으로 전환됩니다.

---

## 저장소 구조

```
src/            확장 본체 (이 폴더를 그대로 크롬에 로드합니다)
  _locales/       ko / en 문구
tools/          개발용 스크립트
  test/           회귀 테스트 (jsdom)
  deploy.sh       src/ 를 크롬 로드 경로로 복사
assets/icons/   아이콘 생성 스크립트와 시안
```

개발용 명령:

```bash
npm install                 # 최초 1회 (jsdom)
cp .env.sample .env         # 최초 1회, DEPLOY_TARGET 값을 채웁니다
npm test                    # 회귀 테스트 실행
npm run deploy              # src/ 를 DEPLOY_TARGET 으로 복사
npm run package             # 배포용 ZIP 을 dist/ 에 생성
```

`DEPLOY_TARGET` 은 크롬 '압축해제된 확장 프로그램 로드'로 지정한 폴더입니다.
`.env` 대신 환경변수나 인자로도 넘길 수 있습니다.

```bash
DEPLOY_TARGET=/path/to/extension npm run deploy
tools/deploy.sh /path/to/extension
```

배포 후에는 `chrome://extensions` 에서 확장을 새로고침하고,
**유튜브 페이지도 새로고침**해야 content script 가 교체됩니다.

---

## 설치 방법 (압축해제된 확장 프로그램 로드)

1. [Releases](https://github.com/backcho/youtube-shorts-blacklist/releases)에서
   `shorts-blocker-for-youtube-x.y.z.zip` 을 내려받아 원하는 폴더에 압축을 해제합니다.
2. 크롬 브라우저를 열고 주소창에 `chrome://extensions/`를 입력하여 이동합니다.
3. 우측 상단의 '개발자 모드' 스위치를 켜기(ON)로 변경합니다.
4. 좌측 상단의 '압축해제된 확장 프로그램 로드' 버튼을 클릭하고,
   압축을 해제한 폴더를 선택하면 설치가 완료됩니다.

> 저장소를 `git clone` 하거나 릴리스의 `Source code` ZIP 을 받은 경우에는
> 루트가 아니라 **`src` 폴더**를 선택하세요. `manifest.json` 이 그 안에 있습니다.

---

## 사용 방법

1. 유튜브 숏츠 페이지 접속 후 우측 상단의 확장 프로그램 아이콘을 클릭합니다.
2. '현재 채널 추가' 버튼을 누르거나, 채널명을 직접 입력하여 블랙리스트에 등록합니다.
3. 등록된 채널의 영상에 진입하면 영상이 자동으로 정지되며 화면 중앙에 차단 안내가 표시됩니다.
4. 차단 안내의 '채널 추천 안 함' 버튼을 누르면 유튜브 메뉴의 동일 기능을 실행합니다.
5. 등록 채널이 많아지면 팝업 하단의 '전체 관리'에서 검색·삭제할 수 있습니다.

---

## 변경 이력

[CHANGELOG.md](CHANGELOG.md)를 참고하세요.

---

## 고지

이 확장은 YouTube 및 Google과 무관한 비공식 프로젝트입니다.
YouTube는 Google LLC의 상표입니다.

확장의 UI는 브라우저 언어에 따라 한국어와 영어로 표시됩니다.
문구는 `src/_locales/{ko,en}/messages.json` 에 있습니다.

---

## 라이선스

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.