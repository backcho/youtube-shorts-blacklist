// 관리 페이지: 정렬 / 검색 / 추가 / 삭제
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { makeI18n } = require('./helpers');

const SRC = path.join(__dirname, '..', '..', 'src');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function boot(blacklist, locale) {
  const html = fs.readFileSync(path.join(SRC, 'manage.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'chrome-extension://test/manage.html',
                                runScripts: 'outside-only' });
  const win = dom.window, doc = win.document;

  let store = { blacklist, popupRecentCount: 5, blockAds: false };
  win.chrome = {
    storage: {
      local: {
        get: (keys, cb) => cb(JSON.parse(JSON.stringify(store))),
        set: (obj, cb) => { Object.assign(store, obj); if (cb) cb(); },
      },
      onChanged: { addListener: () => {} },
    },
    runtime: { onMessage: { addListener: () => {} } },
    i18n: makeI18n(locale || 'ko'),
  };

  win.eval(fs.readFileSync(path.join(SRC, 'shared.js'), 'utf8'));
  win.eval(fs.readFileSync(path.join(SRC, 'manage.js'), 'utf8'));
  doc.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true }));

  return {
    win, doc,
    store: () => store,
    names: () => [...doc.querySelectorAll('#list li')]
      .map((li) => li.querySelector('span > span:nth-child(2)').textContent),
    dates: () => [...doc.querySelectorAll('#list .added-at')].map((e) => e.textContent),
    count: () => doc.getElementById('count').textContent,
    sortTo: (v) => {
      const sel = doc.getElementById('sortSelect');
      sel.value = v;
      sel.dispatchEvent(new win.Event('change'));
    },
    search: (v) => {
      const el = doc.getElementById('searchInput');
      el.value = v;
      el.dispatchEvent(new win.Event('input'));
    },
  };
}

const D = (y, m, d) => new Date(y, m - 1, d).getTime();
const SAMPLE = [
  { name: '@banana', addedAt: D(2026, 1, 5) },
  { name: '@apple',  addedAt: D(2026, 3, 20) },
  { name: '@cherry', addedAt: D(2026, 2, 10) },
];

(async () => {
  // 정렬
  {
    const e = boot(SAMPLE);
    check('M1 기본은 등록일 내림차순(최근 먼저)',
          JSON.stringify(e.names()) === JSON.stringify(['@cherry', '@apple', '@banana']));

    e.sortTo('oldest');
    check('M2 등록일 오름차순',
          JSON.stringify(e.names()) === JSON.stringify(['@banana', '@apple', '@cherry']));

    e.sortTo('nameAsc');
    check('M3 이름 오름차순',
          JSON.stringify(e.names()) === JSON.stringify(['@apple', '@banana', '@cherry']));

    e.sortTo('nameDesc');
    check('M4 이름 내림차순',
          JSON.stringify(e.names()) === JSON.stringify(['@cherry', '@banana', '@apple']));
  }

  // 한글 이름 정렬
  {
    const e = boot([
      { name: '하늘', addedAt: D(2026, 1, 1) },
      { name: '가람', addedAt: D(2026, 1, 2) },
      { name: '나무', addedAt: D(2026, 1, 3) },
    ]);
    e.sortTo('nameAsc');
    check('M5 한글 이름 오름차순',
          JSON.stringify(e.names()) === JSON.stringify(['가람', '나무', '하늘']));
    e.sortTo('nameDesc');
    check('M6 한글 이름 내림차순',
          JSON.stringify(e.names()) === JSON.stringify(['하늘', '나무', '가람']));
  }

  // 등록일 표기
  {
    const e = boot([{ name: '@a', addedAt: D(2026, 8, 21) }, { name: '@b' }]);
    e.sortTo('oldest');
    check('M7 등록일 표기', e.dates()[0] === '2026-08-21');
    check('M8 등록일 없으면 안내 문구', e.dates()[1] === '기록 없음');
  }

  // 검색
  {
    const e = boot(SAMPLE);
    e.search('an');
    check('M9 검색 필터', JSON.stringify(e.names()) === JSON.stringify(['@banana']));
    check('M10 검색 중 개수 표기', e.count() === '(1 / 3개)');

    e.search('@APPLE');
    check('M11 대소문자·@ 무시 검색', JSON.stringify(e.names()) === JSON.stringify(['@apple']));

    e.search('zzz');
    check('M12 결과 없음 안내',
          e.doc.querySelector('#list .empty-msg').textContent === '검색 결과가 없습니다.');

    e.search('');
    check('M13 검색 해제 시 전체 표시', e.names().length === 3);
    check('M14 전체 개수 표기', e.count() === '(3개)');
  }

  // 추가 / 삭제
  {
    const e = boot(SAMPLE.slice());
    const input = e.doc.getElementById('addInput');
    input.value = '@durian';
    e.doc.getElementById('addBtn').dispatchEvent(new e.win.MouseEvent('click'));
    await sleep(20);
    check('M15 추가 시 저장', e.store().blacklist.some((x) => x.name === '@durian'));
    check('M16 추가 항목에 등록일 기록',
          typeof e.store().blacklist.find((x) => x.name === '@durian').addedAt === 'number');
    check('M17 추가 후 입력창 비움', input.value === '');

    e.doc.querySelector('#list .delete-btn').dispatchEvent(new e.win.MouseEvent('click'));
    await sleep(20);
    check('M18 삭제 반영', e.store().blacklist.length === 3);
  }

  // 영어 로케일
  {
    const e = boot(SAMPLE, 'en');
    check('M19 영어 로케일 정렬 라벨',
          e.doc.querySelector('option[value="nameAsc"]').textContent === 'Name ↑ (A→Z)');
    e.search('zzz');
    check('M20 영어 로케일 결과 없음 문구',
          e.doc.querySelector('#list .empty-msg').textContent === 'No matching channels.');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
