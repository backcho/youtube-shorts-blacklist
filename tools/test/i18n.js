// 다국어 리소스 검증
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { makeI18n, loadMessages } = require('./helpers');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name); }
}

const SRC_DIR = path.join(__dirname, '..', '..', 'src');
const LOCALES = ['en', 'ko'];

// ── 리소스 정합성 ────────────────────────────────────────────
const msgs = Object.fromEntries(LOCALES.map((l) => [l, loadMessages(l)]));
const keys = Object.fromEntries(LOCALES.map((l) => [l, new Set(Object.keys(msgs[l]))]));

const missingInKo = [...keys.en].filter((k) => !keys.ko.has(k));
const missingInEn = [...keys.ko].filter((k) => !keys.en.has(k));
check('I1 ko 에 빠진 키 없음', missingInKo.length === 0);
check('I2 en 에 빠진 키 없음', missingInEn.length === 0);

// placeholder 개수가 로케일 간 일치해야 한다
let phMismatch = [];
for (const k of keys.en) {
  const a = Object.keys(msgs.en[k].placeholders || {}).sort().join(',');
  const b = Object.keys((msgs.ko[k] || {}).placeholders || {}).sort().join(',');
  if (a !== b) phMismatch.push(k);
}
check('I3 placeholder 구성 일치', phMismatch.length === 0);

// message 안의 $NAME$ 이 placeholders 에 선언돼 있어야 한다
let undeclared = [];
for (const l of LOCALES) {
  for (const [k, entry] of Object.entries(msgs[l])) {
    const declared = new Set(Object.keys(entry.placeholders || {}).map((s) => s.toLowerCase()));
    for (const m of entry.message.matchAll(/\$([A-Za-z0-9_]+)\$/g)) {
      if (!declared.has(m[1].toLowerCase())) undeclared.push(`${l}:${k}:${m[1]}`);
    }
  }
}
check('I4 선언되지 않은 placeholder 없음', undeclared.length === 0);

// ── HTML/JS 가 참조하는 키가 실제로 존재하는가 ────────────────
const used = new Set();
for (const f of ['popup.html', 'manage.html']) {
  const html = fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
  for (const m of html.matchAll(/data-i18n(?:-placeholder|-title)?="([^"]+)"/g)) used.add(m[1]);
}
for (const f of ['popup.js', 'manage.js', 'content.js', 'shared.js']) {
  const js = fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
  for (const m of js.matchAll(/\bt\(\s*'([A-Za-z0-9_]+)'/g)) used.add(m[1]);
}
const unknown = [...used].filter((k) => !keys.en.has(k));
check(`I5 참조 키가 모두 정의됨 (참조 ${used.size}개)`, unknown.length === 0);
if (unknown.length) console.log('   미정의:', unknown.join(', '));

// manifest 의 __MSG_*__ 도 정의돼 있어야 한다
const manifest = fs.readFileSync(path.join(SRC_DIR, 'manifest.json'), 'utf8');
const msgKeys = [...manifest.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)].map((m) => m[1]);
check('I6 manifest __MSG_*__ 정의됨',
      msgKeys.length > 0 && msgKeys.every((k) => keys.en.has(k)));

const mf = JSON.parse(manifest);
check('I7 default_locale 이 실제 존재', LOCALES.includes(mf.default_locale));

// ── 영어 로케일로 실제 동작하는가 ─────────────────────────────
function runContent(locale) {
  const shared = fs.readFileSync(path.join(SRC_DIR, 'shared.js'), 'utf8');
  const content = fs.readFileSync(path.join(SRC_DIR, 'content.js'), 'utf8');
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>',
    { url: 'https://www.youtube.com/shorts/x1', runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window, doc = win.document;
  Object.defineProperty(win, 'innerHeight', { value: 800, configurable: true });
  win.chrome = {
    storage: { local: { get: (k, cb) => cb({ blacklist: ['@blocked'] }), set: (o, cb) => cb && cb() },
               onChanged: { addListener: () => {} } },
    runtime: { onMessage: { addListener: () => {} } },
    i18n: makeI18n(locale),
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
  reel.getBoundingClientRect = () => ({ top: 0, bottom: 800, height: 800, width: 400, left: 0, right: 400 });
  doc.getElementById('app').appendChild(reel);
  win.eval(shared + '\n' + content);
  return {
    msg: () => { const m = reel.querySelector('.blacklist-overlay-message'); return m ? m.textContent : null; },
    btn: () => { const b = reel.querySelector('.blacklist-overlay-action'); return b ? b.textContent : null; },
  };
}

// ── 로케일 폴백 (manifest default_locale 기준) ────────────────
const { resolveLocale, defaultLocale } = require('./helpers');
check('I13 ko / ko-KR 는 한국어',
      resolveLocale('ko') === 'ko' && resolveLocale('ko-KR') === 'ko');
check('I14 지원하지 않는 언어는 default_locale 로 폴백',
      ['ja', 'fr', 'zh-CN', 'de'].every((l) => resolveLocale(l) === defaultLocale()));
check('I15 default_locale 은 en', defaultLocale() === 'en');
check('I16 en-GB 등 지역 변형도 en', resolveLocale('en-GB') === 'en');
check('I17 폴백 로케일에 모든 키가 있음',
      [...keys.ko].every((k) => keys.en.has(k)));

const ja = makeI18n('ja');
check('I18 미지원 언어에서 영어 문구가 나온다',
      ja.getMessage('overlayAd') === msgs.en.overlayAd.message);

const en = runContent('en');
check('I8 영어 로케일 오버레이 문구', /Blacklisted channel \[@blocked\]/.test(en.msg() || ''));
check('I9 영어 로케일 버튼 라벨', en.btn() === "Don't recommend channel");

const ko = runContent('ko');
check('I10 한국어 로케일 오버레이 문구', /블랙리스트 채널 \[@blocked\]/.test(ko.msg() || ''));
check('I11 한국어 로케일 버튼 라벨', ko.btn() === '채널 추천 안 함');

// 채널명 치환이 실제로 일어났는지 (placeholder 가 남아있으면 실패)
check('I12 placeholder 미치환 없음',
      !/\$CHANNEL\$/i.test(en.msg() || '') && !/\$CHANNEL\$/i.test(ko.msg() || ''));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
