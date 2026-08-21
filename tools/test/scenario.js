const fs = require('fs');
const { JSDOM } = require('jsdom');

// 확장은 shared.js 를 content.js 보다 먼저 주입한다. 테스트도 동일하게 맞춘다.
function loadContentScript(targetPath) {
  const p = require('path');
  const shared = fs.readFileSync(p.join(__dirname, '..', '..', 'src', 'shared.js'), 'utf8');
  const content = fs.readFileSync(targetPath, 'utf8');
  return shared + '\n' + content;
}

const SRC = loadContentScript(process.argv[2] || require('path').join(__dirname, '..', '..', 'src', 'content.js'));

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function makeEnv(blacklist, channelHref, shortsId) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="app"></div>
  </body></html>`, { url: `https://www.youtube.com/shorts/${shortsId}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window;
  const doc = win.document;

  // chrome API 스텁
  const listeners = { storage: [], message: [] };
  win.chrome = {
    storage: {
      local: {
        get: (keys, cb) => cb({ blacklist }),
        set: (obj, cb) => { if (cb) cb(); },
      },
      onChanged: { addListener: (fn) => listeners.storage.push(fn) },
    },
    runtime: { onMessage: { addListener: (fn) => listeners.message.push(fn) } },
  };

  // reel + video 구성
  const reel = doc.createElement('ytd-reel-video-renderer');
  reel.setAttribute('is-active', '');
  const video = doc.createElement('video');
  let paused = false;
  const calls = { pause: 0, play: 0 };
  Object.defineProperty(video, 'paused', { get: () => paused, configurable: true });
  Object.defineProperty(video, 'readyState', { get: () => 4, configurable: true });
  video.pause = () => { calls.pause++; paused = true; };
  video.play = () => { calls.play++; paused = false; video.dispatchEvent(new win.Event('play')); return Promise.resolve(); };
  reel.appendChild(video);

  const bar = doc.createElement('div');
  bar.className = 'ytReelChannelBarViewModelChannelName';
  const a = doc.createElement('a');
  a.setAttribute('href', channelHref);
  bar.appendChild(a);
  reel.appendChild(bar);
  doc.getElementById('app').appendChild(reel);

  win.eval(SRC);

  return {
    win, doc, reel, video, calls, listeners,
    setPaused: (v) => { paused = v; },
    isPaused: () => paused,
    overlayText: () => { const o = reel.querySelector('.blacklist-overlay'); return o && o.style.display !== 'none' ? o.textContent : null; },
  };
}

(async () => {
  // A. 블랙리스트 채널(한글 핸들, URL 인코딩) 자동 정지 + 오버레이
  {
    const e = makeEnv(['@한글채널'], '/@%ED%95%9C%EA%B8%80%EC%B1%84%EB%84%90', 'aaa111');
    e.win.checkAndHandleVideo();
    check('A1 블랙리스트 채널 자동 정지', e.isPaused() === true && e.calls.pause === 1);
    check('A2 오버레이 표시', /블랙리스트 채널 \[@한글채널\]/.test(e.overlayText() || ''));

    // F. 반복 호출 시 textContent 재할당 없음 (MutationObserver 무한루프 회귀)
    const overlay = e.reel.querySelector('.blacklist-overlay');
    let mutations = 0;
    const mo = new e.win.MutationObserver((recs) => { mutations += recs.length; });
    mo.observe(e.reel, { childList: true, subtree: true, characterData: true });
    e.win.checkAndHandleVideo();
    e.win.checkAndHandleVideo();
    await sleep(30);
    check('F 오버레이 재표시가 DOM 변경을 유발하지 않음', mutations === 0);
    mo.disconnect();
  }

  // B. 사용자가 화면(영상)을 클릭하면 계속 시청 허용
  {
    const e = makeEnv(['@blocked'], '/@blocked', 'bbb222');
    e.win.checkAndHandleVideo();
    check('B0 클릭 전 정지 상태', e.isPaused() === true);

    e.video.dispatchEvent(new e.win.MouseEvent('click', { bubbles: true }));
    await sleep(120);
    check('B1 클릭 후 재생 복구', e.isPaused() === false);
    check('B2 클릭 후 오버레이 숨김', e.overlayText() === null);

    // 수동 재생 이후에는 재검사해도 다시 멈추지 않아야 함
    e.win.checkAndHandleVideo();
    check('B3 수동 재생 상태 유지', e.isPaused() === false);
  }

  // B'. 좋아요/구독 등 버튼 클릭은 차단 해제로 취급하지 않음
  {
    const e = makeEnv(['@blocked'], '/@blocked', 'bbb333');
    e.win.checkAndHandleVideo();
    const btn = e.doc.createElement('button');
    e.reel.appendChild(btn);
    btn.dispatchEvent(new e.win.MouseEvent('click', { bubbles: true }));
    await sleep(120);
    e.win.checkAndHandleVideo();
    check("B4 버튼 클릭은 차단을 해제하지 않음", e.isPaused() === true);
  }

  // C. 정상 채널에서 사용자가 직접 일시정지한 영상을 강제 재생하지 않음 (핵심 회귀)
  {
    const e = makeEnv(['@other'], '/@normal', 'ccc333');
    e.win.checkAndHandleVideo();
    check('C0 정상 채널은 건드리지 않음', e.isPaused() === false && e.calls.pause === 0);

    e.setPaused(true);           // 사용자가 직접 일시정지
    e.win.checkAndHandleVideo();
    e.win.checkAndHandleVideo();
    await sleep(30);
    check('C1 사용자의 일시정지를 강제로 되살리지 않음', e.isPaused() === true && e.calls.play === 0);
  }

  // D. 블랙리스트에서 제거되면 확장이 멈춘 영상은 재생 복구
  {
    const e = makeEnv(['@blocked'], '/@blocked', 'ddd444');
    e.win.checkAndHandleVideo();
    check('D0 정지됨', e.isPaused() === true);
    e.listeners.storage.forEach(fn => fn({ blacklist: { newValue: [] } }, 'local'));
    await sleep(30);
    check('D1 블랙리스트 해제 시 재생 복구', e.isPaused() === false && e.calls.play === 1);
    check('D2 오버레이 제거', e.overlayText() === null);
  }

  // E. 채널명을 못 읽는 순간에도 영상 전환 상태가 초기화됨 (isUserResumed 누수 회귀)
  {
    const e = makeEnv(['@blocked'], '/@blocked', 'eee555');
    e.win.checkAndHandleVideo();
    e.video.dispatchEvent(new e.win.MouseEvent('click', { bubbles: true }));
    await sleep(120);
    check('E0 수동 재생 상태', e.isPaused() === false);

    // 다음 숏츠로 전환: 채널바가 아직 렌더되지 않은 상태
    const bar = e.reel.querySelector('.ytReelChannelBarViewModelChannelName');
    bar.remove();
    e.win.history.replaceState({}, '', '/shorts/fff666');
    e.win.checkAndHandleVideo();   // 채널명 없음 -> 아무 조치 없지만 상태는 초기화되어야 함

    // 채널바 렌더 완료 후 재검사 -> 다시 차단되어야 함
    e.reel.appendChild(bar);
    e.win.checkAndHandleVideo();
    check('E1 영상 전환 후 수동 재생 상태가 새지 않음', e.isPaused() === true);
  }

  // G. 숏츠가 아닌 페이지에서는 개입하지 않음
  {
    const e = makeEnv(['@blocked'], '/@blocked', 'ggg777');
    // 숏츠를 벗어난 뒤의 동작만 본다 (로드 시점 검사 결과는 초기화)
    e.win.history.replaceState({}, '', '/feed/subscriptions');
    e.setPaused(false);
    e.calls.pause = 0;
    e.win.checkAndHandleVideo();
    check('G1 숏츠 외 페이지에서는 정지하지 않음', e.isPaused() === false && e.calls.pause === 0);
    check('G2 숏츠 외 페이지에서 남은 오버레이 정리', e.overlayText() === null);
  }

  // H. 팝업 메시지 응답
  {
    const e = makeEnv([], '/@%ED%95%9C%EA%B8%80', 'hhh888');
    let res = null;
    e.listeners.message.forEach(fn => fn({ action: 'getCurrentChannel' }, {}, (r) => { res = r; }));
    check('H 팝업에 현재 채널명 응답', res && res.channelName === '@한글');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
