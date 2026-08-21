// '채널 추천 안 함' 버튼 동작 검증
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

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
function makeEnv({ menuItems, moreButton = true, blockAds = false, blacklist = ['@blocked'] }) {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>',
    { url: 'https://www.youtube.com/shorts/blk001', runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window, doc = win.document;
  Object.defineProperty(win, 'innerHeight', { value: 800, configurable: true });
  win.chrome = {
    storage: { local: { get: (k, cb) => cb({ blacklist, blockAds }), set: (o, cb) => cb && cb() },
               onChanged: { addListener: () => {} } },
    runtime: { onMessage: { addListener: () => {} } },
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
    const more = doc.createElement('button');
    more.setAttribute('aria-label', '기타 작업');
    more.addEventListener('click', () => {
      clicked.push('⋮');
      if (!menuItems) return;
      // 유튜브처럼 비동기로 메뉴를 렌더한다
      win.setTimeout(() => {
        const menu = doc.createElement('div');
        menu.id = 'menu';
        menuItems.forEach((text) => {
          const item = doc.createElement('yt-list-item-view-model');
          item.textContent = text;
          item.addEventListener('click', () => clicked.push(text));
          menu.appendChild(item);
        });
        doc.body.appendChild(menu);
      }, 120);
    });
    reel.appendChild(more);
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

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
