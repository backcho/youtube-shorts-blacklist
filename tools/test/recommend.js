// '채널 추천 안 함' 버튼 동작 검증
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { makeI18n } = require('./helpers');

// 확장은 shared.js 를 content.js 보다 먼저 주입한다. 테스트도 동일하게 맞춘다.
function loadContentScript(targetPath) {
  const p = require('path');
  const shared = fs.readFileSync(p.join(__dirname, '..', '..', 'src', 'shared.js'), 'utf8');
  const content = fs.readFileSync(targetPath, 'utf8');
  return shared + '\n' + content;
}

const SRC = loadContentScript(process.argv[2] || path.join(__dirname, '..', '..', 'src', 'content.js'));

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// menuItems: '⋮' 클릭 시 DOM에 붙일 메뉴 항목 텍스트 (null 이면 메뉴가 열리지 않음)
function makeEnv({ menuItems, moreButton = 'real', blockAds = false, blacklist = ['@blocked'] }) {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>',
    { url: 'https://www.youtube.com/shorts/blk001', runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window, doc = win.document;
  Object.defineProperty(win, 'innerHeight', { value: 800, configurable: true });
  win.chrome = {
    storage: { local: { get: (k, cb) => cb({ blacklist, blockAds }), set: (o, cb) => cb && cb() },
               onChanged: { addListener: () => {} } },
    runtime: { onMessage: { addListener: () => {} } },
    i18n: makeI18n(process.env.TEST_LOCALE || 'ko'),
  };

  const reel = doc.createElement('ytd-reel-video-renderer');
  reel.setAttribute('is-active', '');
  const video = doc.createElement('video');
  let paused = false;
  Object.defineProperty(video, 'paused', { get: () => paused, configurable: true });
  Object.defineProperty(video, 'readyState', { get: () => 4, configurable: true });
  video.pause = () => { paused = true; };
  video.play = () => { paused = false; return Promise.resolve(); };
  reel.appendChild(video);

  const bar = doc.createElement('div');
  bar.className = 'ytReelChannelBarViewModelChannelName';
  const a = doc.createElement('a'); a.setAttribute('href', '/@blocked');
  bar.appendChild(a); reel.appendChild(bar);

  const clicked = [];
  if (moreButton) {
    // 실제 관측 구조:
    //   ytd-menu-renderer.style-scope.ytd-shorts-player-controls
    //     > yt-button-shape > button[aria-label="추가 작업"]  (id 없음)
    const more = doc.createElement('button');
    let mount = reel;
    if (moreButton === 'real') {
      // ytd-shorts-player-controls > #right-controls > #menu-button > ytd-menu-renderer
      const controls = doc.createElement('ytd-shorts-player-controls');
      const right = doc.createElement('div');
      right.id = 'right-controls';
      const menuButton = doc.createElement('div');
      menuButton.id = 'menu-button';
      controls.appendChild(right);
      right.appendChild(menuButton);
      reel.appendChild(controls);

      const menu = doc.createElement('ytd-menu-renderer');
      menu.className = 'style-scope ytd-shorts-player-controls';
      const shape = doc.createElement('yt-button-shape');
      shape.id = 'button-shape';
      shape.className = 'style-scope ytd-menu-renderer';
      menu.appendChild(shape);
      menuButton.appendChild(menu);
      mount = shape;
      more.setAttribute('aria-label', '추가 작업');
    } else if (moreButton === 'label-only') {
      // 구조가 바뀌고 라벨만 남은 경우 (폴백 경로)
      more.setAttribute('aria-label', '추가 작업');
    } else if (moreButton === 'english') {
      more.setAttribute('aria-label', 'More actions');
    }
    more.addEventListener('click', () => {
      clicked.push('⋮');
      if (!menuItems) return;
      // 유튜브처럼 비동기로 메뉴를 렌더한다
      win.setTimeout(() => {
        // 실제 구조: 드롭다운 최상위는 tp-yt-iron-dropdown
        const menu = doc.createElement('tp-yt-iron-dropdown');
        menu.id = 'menu';
        menu.getBoundingClientRect = () => ({ top: 100, left: 100, width: 260, height: 300,
                                              bottom: 400, right: 360 });
        menuItems.forEach((text) => {
          const item = doc.createElement('yt-list-item-view-model');
          item.textContent = text;
          item.addEventListener('click', () => clicked.push(text));
          menu.appendChild(item);
        });
        doc.body.appendChild(menu);
      }, 120);
    });
    mount.appendChild(more);
  }

  reel.getBoundingClientRect = () => ({ top: 0, bottom: 800, height: 800, width: 400, left: 0, right: 400 });
  doc.getElementById('app').appendChild(reel);
  win.eval(SRC);

  return {
    win, doc, reel, clicked,
    isPaused: () => paused,
    actionBtn: () => reel.querySelector('.blacklist-overlay-action'),
    overlayBg: () => {
      const o = reel.querySelector('.blacklist-overlay');
      return o ? o.style.backgroundColor : null;
    },
    overlayVisible: () => {
      const o = reel.querySelector('.blacklist-overlay');
      return !!o && o.style.display !== 'none';
    },
    overlayMsg: () => {
      const m = reel.querySelector('.blacklist-overlay-message');
      const o = reel.querySelector('.blacklist-overlay');
      return o && o.style.display !== 'none' && m ? m.textContent : null;
    },
  };
}

// 실제 관측된 메뉴 구성 ('신고'가 바로 옆에 있다)
const REAL_MENU = ['설명', '재생목록에 저장', '자막꺼짐', '전체 화면', '채널 추천 안함', '신고', '의견 보내기'];

(async () => {
  // 정상 동작
  {
    const e = makeEnv({ menuItems: REAL_MENU });
    await sleep(40);
    check('R1 차단 오버레이에 버튼 노출', !!e.actionBtn() && e.actionBtn().style.display !== 'none');
    check('R2 버튼 기본 라벨', e.actionBtn().textContent === '채널 추천 안 함');

    e.actionBtn().dispatchEvent(new e.win.MouseEvent('click', { bubbles: true }));
    await sleep(400);
    check('R3 ⋮ 메뉴를 열었다', e.clicked.includes('⋮'));
    check('R4 채널 추천 안함 항목을 클릭', e.clicked.includes('채널 추천 안함'));
    check('R5 신고는 절대 클릭하지 않음', !e.clicked.includes('신고'));
    check('R6 처리 완료 표시', e.actionBtn().textContent === '추천 안 함 처리됨');
  }

  // 버튼 클릭이 '수동 재생'으로 오인되지 않아야 한다
  {
    const e = makeEnv({ menuItems: REAL_MENU });
    await sleep(40);
    check('R7 차단으로 정지된 상태', e.isPaused() === true);
    e.actionBtn().dispatchEvent(new e.win.MouseEvent('click', { bubbles: true }));
    await sleep(400);
    check('R8 버튼을 눌러도 영상이 재생되지 않음', e.isPaused() === true);
  }

  // 문구가 바뀐 경우: 자동 클릭하지 않고 사용자에게 넘긴다
  {
    const e = makeEnv({ menuItems: ['설명', '전체 화면', '이 채널 그만 보기', '신고'] });
    await sleep(40);
    e.actionBtn().dispatchEvent(new e.win.MouseEvent('click', { bubbles: true }));
    await sleep(2600);
    check('R9 모르는 문구는 클릭하지 않음',
          !e.clicked.includes('이 채널 그만 보기') && !e.clicked.includes('신고'));
    check('R10 메뉴는 열어둔 채 사용자에게 안내', e.clicked.includes('⋮') &&
          e.actionBtn().textContent === '메뉴에서 선택하세요');
    check('R11 재시도할 수 있도록 버튼 활성', e.actionBtn().disabled === false);
  }

  // 영어 UI
  {
    const e = makeEnv({ menuItems: ['Description', 'Full screen', "Don't recommend channel", 'Report'] });
    await sleep(40);
    e.actionBtn().dispatchEvent(new e.win.MouseEvent('click', { bubbles: true }));
    await sleep(400);
    check('R12 영어 UI에서도 동작', e.clicked.includes("Don't recommend channel") && !e.clicked.includes('Report'));
  }

  // ⋮ 버튼을 못 찾는 경우
  {
    const e = makeEnv({ menuItems: REAL_MENU, moreButton: false });
    await sleep(40);
    e.actionBtn().dispatchEvent(new e.win.MouseEvent('click', { bubbles: true }));
    await sleep(200);
    check('R13 ⋮ 를 못 찾으면 안내 표시', e.actionBtn().textContent === '메뉴를 찾지 못했습니다');
  }

  // 구조가 바뀌어도 aria-label 폴백으로 동작해야 한다
  {
    const e = makeEnv({ menuItems: REAL_MENU, moreButton: 'label-only' });
    await sleep(40);
    e.actionBtn().dispatchEvent(new e.win.MouseEvent('click', { bubbles: true }));
    await sleep(400);
    check('R13b 라벨 폴백(추가 작업)으로도 동작', e.clicked.includes('채널 추천 안함'));
  }
  {
    const e = makeEnv({ menuItems: ['Description', "Don't recommend channel", 'Report'],
                        moreButton: 'english' });
    await sleep(40);
    e.actionBtn().dispatchEvent(new e.win.MouseEvent('click', { bubbles: true }));
    await sleep(400);
    check('R13c 영어 라벨(More actions) 폴백',
          e.clicked.includes("Don't recommend channel") && !e.clicked.includes('Report'));
  }

  // 광고 구간에는 '채널 추천 안 함' 버튼이 보이면 안 된다
  {
    // 광고 옵션 꺼짐(기본): 오버레이 자체가 사라진다
    const e = makeEnv({ menuItems: REAL_MENU });
    await sleep(40);
    check('R14 차단 상태에서 오버레이 표시', e.overlayVisible() === true);
    e.reel.appendChild(e.doc.createElement('ytd-ad-slot-renderer'));
    e.win.checkAndHandleVideo();
    await sleep(40);
    check('R15 광고 구간에서 오버레이 숨김', e.overlayVisible() === false);
  }
  {
    // 광고 옵션 켜짐: 광고 안내는 뜨되 액션 버튼은 숨겨야 한다
    const e = makeEnv({ menuItems: REAL_MENU, blockAds: true });
    await sleep(40);
    e.reel.appendChild(e.doc.createElement('ytd-ad-slot-renderer'));
    e.win.checkAndHandleVideo();
    await sleep(40);
    const btn = e.actionBtn();
    check('R16 광고 안내는 표시', /광고/.test(e.overlayMsg() || ''));
    check('R17 광고에는 액션 버튼 숨김', !btn || btn.style.display === 'none');
  }

  // 오버레이 색상: 광고와 블랙리스트를 구분한다
  {
    const e = makeEnv({ menuItems: REAL_MENU });
    await sleep(40);
    check('C1 블랙리스트 오버레이는 오렌지', e.overlayBg() === 'rgba(230, 126, 34, 0.94)');
  }
  {
    const e = makeEnv({ menuItems: REAL_MENU, blockAds: true, blacklist: [] });
    await sleep(40);
    e.reel.appendChild(e.doc.createElement('ytd-ad-slot-renderer'));
    e.win.checkAndHandleVideo();
    await sleep(40);
    check('C2 광고 오버레이는 웜 레드', e.overlayBg() === 'rgba(217, 48, 37, 0.94)');
  }

  // 새 저장 형식(객체 배열)도 차단에 쓰인다
  {
    const e = makeEnv({ menuItems: REAL_MENU, blacklist: [{ name: '@blocked', addedAt: Date.now() }] });
    await sleep(40);
    check('C3 객체 형식 블랙리스트로 차단', e.isPaused() === true);
  }
  {
    const e = makeEnv({ menuItems: REAL_MENU, blacklist: ['@blocked'] });
    await sleep(40);
    check('C4 구 문자열 형식도 그대로 차단', e.isPaused() === true);
  }

  // 닫힌 메뉴(댓글 정렬 등)가 함께 떠 있어도 열린 드롭다운만 대상으로 삼아야 한다
  {
    const e = makeEnv({ menuItems: REAL_MENU });
    await sleep(40);

    // 화면에 없는 드롭다운에 같은 문구의 항목을 심어 둔다
    const stale = e.doc.createElement('tp-yt-iron-dropdown');
    stale.setAttribute('aria-hidden', 'true');
    stale.getBoundingClientRect = () => ({ top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 });
    const staleItem = e.doc.createElement('yt-list-item-view-model');
    staleItem.textContent = '채널 추천 안함';
    let staleClicked = false;
    staleItem.addEventListener('click', () => { staleClicked = true; });
    stale.appendChild(staleItem);
    e.doc.body.appendChild(stale);

    e.actionBtn().dispatchEvent(new e.win.MouseEvent('click', { bubbles: true }));
    await sleep(400);
    check('R19 닫힌 메뉴의 동일 항목은 건드리지 않음', staleClicked === false);
    check('R20 열린 메뉴의 항목을 클릭', e.clicked.includes('채널 추천 안함'));
  }

  // 열린 드롭다운이 둘일 때: 항목을 가진 쪽을 찾아야 한다
  {
    const e = makeEnv({ menuItems: REAL_MENU });
    await sleep(40);

    // 우리 메뉴보다 먼저 놓인, 열려 있지만 무관한 드롭다운 (댓글 정렬 등)
    const other = e.doc.createElement('tp-yt-iron-dropdown');
    other.getBoundingClientRect = () => ({ top: 0, left: 0, width: 200, height: 120,
                                           bottom: 120, right: 200 });
    ['인기순 추천 댓글 표시', '최신순 스팸 가능성이 있는 댓글을 포함하여 최근 댓글 표시']
      .forEach((text) => {
        const item = e.doc.createElement('tp-yt-paper-item');
        item.textContent = text;
        item.addEventListener('click', () => e.clicked.push(text));
        other.appendChild(item);
      });
    e.doc.body.insertBefore(other, e.doc.body.firstChild);

    e.actionBtn().dispatchEvent(new e.win.MouseEvent('click', { bubbles: true }));
    await sleep(400);
    check('R21 열린 드롭다운이 둘이어도 올바른 항목을 클릭',
          e.clicked.includes('채널 추천 안함'));
    check('R22 무관한 드롭다운 항목은 건드리지 않음',
          !e.clicked.some((c) => c.startsWith('인기순') || c.startsWith('최신순')));
  }

  // 사이드바 가이드처럼 무관한 tp-yt-paper-item 이 많아도 영향이 없어야 한다
  {
    const e = makeEnv({ menuItems: REAL_MENU });
    await sleep(40);
    ['홈', 'Shorts', '구독', '더보기', '간략히 보기', '신고 기록'].forEach((text) => {
      const item = e.doc.createElement('tp-yt-paper-item');
      item.textContent = text;
      item.addEventListener('click', () => e.clicked.push('guide:' + text));
      e.doc.body.appendChild(item);
    });
    e.actionBtn().dispatchEvent(new e.win.MouseEvent('click', { bubbles: true }));
    await sleep(400);
    check('R23 사이드바 항목을 건드리지 않음', !e.clicked.some((c) => c.startsWith('guide:')));
    check('R24 정상 항목 클릭 유지', e.clicked.includes('채널 추천 안함'));
  }

  // '채널 추천 안 함' 실행 후 유튜브가 다음 영상으로 자동 전환하는 흐름
  {
    const e = makeEnv({ menuItems: REAL_MENU });
    await sleep(40);
    check('R25 차단 영상이 정지된 상태', e.isPaused() === true);

    e.actionBtn().dispatchEvent(new e.win.MouseEvent('click', { bubbles: true }));
    await sleep(400);
    check('R26 추천 안 함 처리됨', e.clicked.includes('채널 추천 안함'));
    check('R27 처리 후 버튼 표시', e.actionBtn().textContent === '추천 안 함 처리됨');

    // 유튜브가 다음 영상(정상 채널)으로 넘긴다
    e.reel.removeAttribute('is-active');
    e.reel.getBoundingClientRect = () => ({ top: -800, bottom: 0, height: 800, width: 400,
                                            left: 0, right: 400 });
    const next = e.doc.createElement('ytd-reel-video-renderer');
    next.setAttribute('is-active', '');
    const nextVideo = e.doc.createElement('video');
    let nextPaused = true;   // 확장이 막아둔 여파로 정지된 채 시작
    let played = 0;
    Object.defineProperty(nextVideo, 'paused', { get: () => nextPaused, configurable: true });
    Object.defineProperty(nextVideo, 'readyState', { get: () => 4, configurable: true });
    nextVideo.pause = () => { nextPaused = true; };
    nextVideo.play = () => { played++; nextPaused = false; return Promise.resolve(); };
    next.appendChild(nextVideo);
    const nextBar = e.doc.createElement('div');
    nextBar.className = 'ytReelChannelBarViewModelChannelName';
    const nextLink = e.doc.createElement('a');
    nextLink.setAttribute('href', '/@normal');
    nextBar.appendChild(nextLink);
    next.appendChild(nextBar);
    next.getBoundingClientRect = () => ({ top: 0, bottom: 800, height: 800, width: 400,
                                          left: 0, right: 400 });
    e.doc.getElementById('app').appendChild(next);
    e.win.history.replaceState({}, '', '/shorts/next001');

    e.win.checkAndHandleVideo();
    await sleep(40);
    check('R28 전환된 정상 영상이 재생 복구됨', nextPaused === false && played === 1);
    check('R29 이전 오버레이 정리됨', e.overlayVisible() === false);
    check('R30 버튼 상태가 초기화됨',
          e.reel.querySelector('.blacklist-overlay-action').textContent === '채널 추천 안 함');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
