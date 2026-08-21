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

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>',
  { url: 'https://www.youtube.com/shorts/blk001', runScripts: 'outside-only', pretendToBeVisual: true });
const win = dom.window, doc = win.document;
Object.defineProperty(win, 'innerHeight', { value: 800, configurable: true });
win.chrome = {
  storage: { local: { get: (k, cb) => cb({ blacklist: ['@blocked'] }), set: (o, cb) => cb && cb() },
             onChanged: { addListener: () => {} } },
  runtime: { onMessage: { addListener: () => {} } },
};

// 활성 reel: 차단 채널
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
reel.getBoundingClientRect = () => ({ top: 0, bottom: 800, height: 800, width: 400, left: 0, right: 400 });
doc.getElementById('app').appendChild(reel);

// 피드 아래쪽에 '다음' 광고 reel이 미리 로드되어 있는 상황 (화면 밖)
const adReel = doc.createElement('ytd-reel-video-renderer');
const slot = doc.createElement('ytd-ad-slot-renderer');
slot.className = 'style-scope ytd-reel-video-renderer';
adReel.appendChild(slot);
adReel.getBoundingClientRect = () => ({ top: 800, bottom: 1600, height: 800, width: 400, left: 0, right: 400 });
doc.getElementById('app').appendChild(adReel);

win.eval(SRC);
setTimeout(() => {
  const ok = paused === true;
  console.log((ok ? 'PASS' : 'FAIL') + ' 피드에 광고 슬롯이 미리 로드돼 있어도 차단이 동작');
  process.exit(ok ? 0 : 1);
}, 60);
