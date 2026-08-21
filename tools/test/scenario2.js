const fs = require('fs');
const { JSDOM } = require('jsdom');
const { makeI18n } = require('./helpers');

const TARGET = process.argv[2] || require('path').join(__dirname, '..', '..', 'src', 'content.js');
// 확장은 shared.js 를 content.js 보다 먼저 주입한다. 테스트도 동일하게 맞춘다.
function loadContentScript(targetPath) {
  const p = require('path');
  const shared = fs.readFileSync(p.join(__dirname, '..', '..', 'src', 'shared.js'), 'utf8');
  const content = fs.readFileSync(targetPath, 'utf8');
  return shared + '\n' + content;
}

const SRC = loadContentScript(TARGET);

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function makeEnv(blacklist, opts = {}) {
  const shortsId = opts.shortsId || 'vid001';
  const dom = new JSDOM(`<!doctype html><html><body><div id="app"></div></body></html>`, {
    url: `https://www.youtube.com/shorts/${shortsId}`,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const win = dom.window;
  const doc = win.document;
  Object.defineProperty(win, 'innerHeight', { value: 800, configurable: true });

  const listeners = { storage: [], message: [] };
  let storeCb = null;
  win.chrome = {
    storage: {
      local: {
        get: (keys, cb) => {
          const payload = { blacklist, blockAds: opts.blockAds === true };
          if (opts.deferStorage) storeCb = () => cb(payload); else cb(payload);
        },
        set: (o, cb) => cb && cb(),
      },
      onChanged: { addListener: (fn) => listeners.storage.push(fn) },
    },
    runtime: { onMessage: { addListener: (fn) => listeners.message.push(fn) } },
    i18n: makeI18n(process.env.TEST_LOCALE || 'ko'),
  };

  const env = { win, doc, listeners, reels: [], flushStorage: () => storeCb && storeCb() };

  // reel 하나를 만든다. 뷰포트를 꽉 채우는 것만 활성으로 인정되도록 rect를 흉내낸다.
  env.addReel = ({ href, active, top = 0, ad = false }) => {
    const reel = doc.createElement('ytd-reel-video-renderer');
    if (active) reel.setAttribute('is-active', '');
    const video = doc.createElement('video');
    let paused = false;
    const calls = { pause: 0, play: 0 };
    Object.defineProperty(video, 'paused', { get: () => paused, configurable: true });
    Object.defineProperty(video, 'readyState', { get: () => 4, configurable: true });
    video.pause = () => { calls.pause++; paused = true; };
    video.play = () => { calls.play++; paused = false; video.dispatchEvent(new win.Event('play')); return Promise.resolve(); };
    reel.appendChild(video);

    if (href) {
      const bar = doc.createElement('div');
      bar.className = 'ytReelChannelBarViewModelChannelName';
      const a = doc.createElement('a');
      a.setAttribute('href', href);
      bar.appendChild(a);
      reel.appendChild(bar);
    }
    if (ad) {
      // 실제 숏츠 광고 DOM: ytd-reel-video-renderer > ytd-ad-slot-renderer
      const slot = doc.createElement('ytd-ad-slot-renderer');
      slot.className = 'style-scope ytd-reel-video-renderer';
      const layout = doc.createElement('ytd-in-feed-ad-layout-renderer');
      layout.className = 'style-scope ytd-ad-slot-renderer';
      slot.appendChild(layout);
      reel.appendChild(slot);
    }
    reel.getBoundingClientRect = () => ({ top, bottom: top + 800, height: 800, width: 400, left: 0, right: 400 });
    doc.getElementById('app').appendChild(reel);

    const handle = {
      reel, video, calls,
      setPaused: (v) => { paused = v; },
      isPaused: () => paused,
      overlayText: () => { const o = reel.querySelector('.blacklist-overlay'); return o && o.style.display !== 'none' ? o.textContent : null; },
      removeBar: () => { const b = reel.querySelector('.ytReelChannelBarViewModelChannelName'); if (b) b.remove(); return b; },
      setActive: (v) => { if (v) reel.setAttribute('is-active', ''); else reel.removeAttribute('is-active'); },
      setTop: (t) => { reel.getBoundingClientRect = () => ({ top: t, bottom: t + 800, height: 800, width: 400, left: 0, right: 400 }); },
    };
    env.reels.push(handle);
    return handle;
  };

  // 실제 관측된 광고 구간의 플레이어 클래스 (ad-showing 없음, ad-created만 존재)
  env.showAdPlayer = () => {
    const p = doc.createElement('div');
    p.className = 'html5-video-player ad-created playing-mode';
    doc.body.appendChild(p);
    return () => p.remove();
  };

  env.boot = () => win.eval(SRC);
  env.goTo = (id) => win.history.replaceState({}, '', `/shorts/${id}`);
  return env;
}

(async () => {
  // ── 증상 5: 사용자가 일시정지하면 유지되어야 한다 ──────────────────
  {
    const e = makeEnv(['@blocked']);
    const r = e.addReel({ href: '/@normal', active: true });
    e.boot();
    await sleep(30);
    check('5-1 정상 채널은 정지시키지 않음', r.isPaused() === false && r.calls.pause === 0);

    // 사용자가 화면을 클릭해 일시정지 (유튜브가 pause 처리)
    r.video.dispatchEvent(new e.win.MouseEvent('click', { bubbles: true }));
    r.setPaused(true);
    await sleep(250);
    check('5-2 화면 클릭 후 일시정지가 유지됨', r.isPaused() === true && r.calls.play === 0);

    e.win.checkAndHandleVideo();
    await sleep(30);
    check('5-3 반복 검사에도 재생되지 않음', r.isPaused() === true && r.calls.play === 0);
  }

  // ── 증상 2: 차단 영상 다음의 정상 영상은 자동 재생되어야 한다 ──────
  {
    const e = makeEnv(['@blocked'], { shortsId: 'blk001' });
    const r1 = e.addReel({ href: '/@blocked', active: true });
    e.boot();
    await sleep(30);
    check('2-1 첫 영상(차단 채널) 정지', r1.isPaused() === true);
    check('2-2 오버레이 표시', /@blocked/.test(r1.overlayText() || ''));

    // 다음 영상으로 스크롤: 새 reel이 활성화되고, 유튜브 상태 오염으로 정지된 채 시작
    r1.setActive(false); r1.setTop(-800);
    const r2 = e.addReel({ href: '/@normal', active: true });
    r2.setPaused(true);
    e.goTo('nor002');
    e.win.checkAndHandleVideo();
    await sleep(30);
    check('2-3 다음 정상 영상 자동 재생 복구', r2.isPaused() === false && r2.calls.play === 1);
    check('2-4 이전 오버레이 정리', r1.overlayText() === null && r2.overlayText() === null);

    // 복구 이후 사용자가 일시정지하면 유지되어야 한다 (증상 5 회귀)
    r2.setPaused(true);
    e.win.checkAndHandleVideo();
    await sleep(30);
    check('2-5 복구 이후의 사용자 일시정지는 유지', r2.isPaused() === true && r2.calls.play === 1);
  }

  // ── 증상 2b: 차단이 없었으면 자동 재생에 개입하지 않는다 ───────────
  {
    const e = makeEnv([], { shortsId: 'nor001' });
    const r1 = e.addReel({ href: '/@a', active: true });
    e.boot();
    await sleep(30);
    r1.setActive(false); r1.setTop(-800);
    const r2 = e.addReel({ href: '/@b', active: true });
    r2.setPaused(true);          // 사용자가 정지한 채 넘어옴
    e.goTo('nor002');
    e.win.checkAndHandleVideo();
    await sleep(30);
    check('2-6 차단 이력이 없으면 재생 강제 안 함', r2.isPaused() === true && r2.calls.play === 0);
  }

  // ── 증상 3: 광고 구간에서 오버레이 재등장/광고 정지 없어야 한다 ────
  {
    const e = makeEnv(['@blocked'], { shortsId: 'blk001' });
    const r1 = e.addReel({ href: '/@blocked', active: true });
    e.boot();
    await sleep(30);
    check('3-1 첫 영상 차단됨', r1.isPaused() === true && r1.overlayText() !== null);

    // 3번째 영상 자리에 광고 reel: 채널바가 없고 URL도 그대로다 (실제 관측 구조)
    r1.setActive(false); r1.setTop(-1600);
    const ad = e.addReel({ href: null, active: true, ad: true });
    const hideAd = e.showAdPlayer();
    e.win.checkAndHandleVideo();
    await sleep(30);
    check('3-2 옵션 꺼짐(기본): 광고를 정지시키지 않음', ad.isPaused() === false && ad.calls.pause === 0);
    check('3-3 옵션 꺼짐(기본): 광고 오버레이 없음', ad.overlayText() === null);
    check('3-3b 차단 채널 오버레이는 재등장하지 않음', r1.overlayText() === null);

    // 광고 종료 후 정상 영상
    hideAd();
    ad.setActive(false); ad.setTop(-800);
    const r3 = e.addReel({ href: '/@normal', active: true });
    r3.setPaused(true);
    e.goTo('nor003');
    e.win.checkAndHandleVideo();
    await sleep(30);
    check('3-4 광고 이후 정상 영상 재생', r3.isPaused() === false);
    check('3-5 광고 이후 오버레이 없음', r3.overlayText() === null);
  }

  // ── 광고 수동 재생: 클릭하면 광고도 볼 수 있어야 한다 ────────────
  {
    const e = makeEnv([], { shortsId: 'nor001', blockAds: true });
    const r1 = e.addReel({ href: '/@normal', active: true });
    e.boot();
    await sleep(30);
    r1.setActive(false); r1.setTop(-800);
    const ad = e.addReel({ href: null, active: true, ad: true });
    e.win.checkAndHandleVideo();
    await sleep(30);
    check('3-7 옵션 켬: 광고 자동 재생 정지', ad.isPaused() === true);
    check('3-8 광고 안내 오버레이', /광고/.test(ad.overlayText() || ''));

    ad.video.dispatchEvent(new e.win.MouseEvent('click', { bubbles: true }));
    await sleep(150);
    check('3-9 광고 클릭 시 수동 재생', ad.isPaused() === false);
    check('3-10 광고 재생 후 오버레이 제거', ad.overlayText() === null);

    e.win.checkAndHandleVideo();
    await sleep(30);
    check('3-11 광고 수동 재생 유지', ad.isPaused() === false);
  }

  // ── 증상 3b: 채널바가 없다고 이전 채널명으로 오탐하지 않는다 ───────
  {
    const e = makeEnv(['@blocked'], { shortsId: 'blk001' });
    const r1 = e.addReel({ href: '/@blocked', active: true });
    e.boot();
    await sleep(30);
    // 화면 밖 이전 reel만 남고 활성 reel이 없는 과도기
    r1.setActive(false); r1.setTop(-700);   // 100px만 걸침
    e.goTo('next001');
    const before = r1.calls.pause;
    e.win.checkAndHandleVideo();
    await sleep(30);
    check('3-6 화면 밖 reel을 활성으로 오인하지 않음', r1.calls.pause === before);
  }

  // ── 증상 1: 블랙리스트 로드 전에는 판정을 보류한다 ─────────────────
  {
    const e = makeEnv(['@blocked'], { shortsId: 'blk001', deferStorage: true });
    const r = e.addReel({ href: '/@blocked', active: true });
    e.boot();
    await sleep(30);
    check('1-1 로드 전에는 오탐하지 않음', r.overlayText() === null);
    e.flushStorage();
    await sleep(30);
    check('1-2 로드 직후 즉시 차단', r.isPaused() === true && r.overlayText() !== null);
  }

  // ── 차단 영상 수동 재생 (기존 기능 회귀) ──────────────────────────
  {
    const e = makeEnv(['@blocked'], { shortsId: 'blk001' });
    const r = e.addReel({ href: '/@blocked', active: true });
    e.boot();
    await sleep(30);
    check('M1 차단됨', r.isPaused() === true);
    r.video.dispatchEvent(new e.win.MouseEvent('click', { bubbles: true }));
    await sleep(150);
    check('M2 클릭 시 수동 재생', r.isPaused() === false);
    check('M3 오버레이 숨김', r.overlayText() === null);
    e.win.checkAndHandleVideo();
    await sleep(30);
    check('M4 수동 재생 유지', r.isPaused() === false);

    // 수동 재생 후 사용자가 다시 일시정지하면 유지되어야 한다
    r.setPaused(true);
    e.win.checkAndHandleVideo();
    await sleep(30);
    check('M5 수동 재생 후의 일시정지도 유지', r.isPaused() === true);
  }

  // ── 버튼 클릭은 차단 해제로 취급하지 않는다 ───────────────────────
  {
    const e = makeEnv(['@blocked'], { shortsId: 'blk001' });
    const r = e.addReel({ href: '/@blocked', active: true });
    e.boot();
    await sleep(30);
    const btn = e.doc.createElement('button');
    r.reel.appendChild(btn);
    btn.dispatchEvent(new e.win.MouseEvent('click', { bubbles: true }));
    await sleep(150);
    r.setPaused(false);
    e.win.checkAndHandleVideo();
    await sleep(30);
    check('M6 좋아요/구독 클릭은 차단 유지', r.isPaused() === true);
  }

  // ── 블랙리스트 실시간 반영 ────────────────────────────────────────
  {
    const e = makeEnv(['@blocked'], { shortsId: 'blk001' });
    const r = e.addReel({ href: '/@blocked', active: true });
    e.boot();
    await sleep(30);
    e.listeners.storage.forEach(fn => fn({ blacklist: { newValue: [] } }, 'local'));
    await sleep(30);
    check('M7 블랙리스트 해제 시 오버레이 제거', r.overlayText() === null);

    const e2 = makeEnv([], { shortsId: 'nor001' });
    const r2 = e2.addReel({ href: '/@target', active: true });
    e2.boot();
    await sleep(30);
    e2.listeners.storage.forEach(fn => fn({ blacklist: { newValue: ['@target'] } }, 'local'));
    await sleep(30);
    check('M8 블랙리스트 추가 시 즉시 차단', r2.isPaused() === true);
  }

  // ── 광고 옵션 실시간 토글 ─────────────────────────────────────────
  {
    const e = makeEnv([], { shortsId: 'nor001' });
    const r1 = e.addReel({ href: '/@normal', active: true });
    e.boot();
    await sleep(30);
    r1.setActive(false); r1.setTop(-800);
    const ad = e.addReel({ href: null, active: true, ad: true });
    e.win.checkAndHandleVideo();
    await sleep(30);
    check('O1 기본값은 꺼짐 - 광고 재생 유지', ad.isPaused() === false);

    // 팝업에서 옵션을 켜면 즉시 반영
    e.listeners.storage.forEach(fn => fn({ blockAds: { newValue: true } }, 'local'));
    await sleep(30);
    check('O2 옵션 켜면 즉시 광고 정지', ad.isPaused() === true && /광고/.test(ad.overlayText() || ''));

    // 다시 끄면 광고 안내가 사라진다
    e.listeners.storage.forEach(fn => fn({ blockAds: { newValue: false } }, 'local'));
    await sleep(30);
    check('O3 옵션 끄면 광고 오버레이 제거', ad.overlayText() === null);
  }

  // ── 팝업 응답 ─────────────────────────────────────────────────────
  {
    const e = makeEnv([], { shortsId: 'nor001' });
    e.addReel({ href: '/@%ED%95%9C%EA%B8%80', active: true });
    e.boot();
    await sleep(30);
    let res = null;
    e.listeners.message.forEach(fn => fn({ action: 'getCurrentChannel' }, {}, (r) => { res = r; }));
    check('M9 팝업에 한글 채널명 응답', res && res.channelName === '@한글');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
