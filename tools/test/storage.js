// 블랙리스트 저장 형식(구 문자열 배열 → 신 객체 배열) 호환 검증
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SHARED = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'shared.js'), 'utf8');
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(SHARED, ctx);

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name); }
}

const { toChannelEntries, channelNamesOf, findChannelEntry, formatAddedAt, normalizeChannelName } = ctx;

// 구 형식(문자열 배열)
{
  const e = toChannelEntries(['@a', '침착맨', '  ']);
  check('S1 구 형식을 항목으로 변환', e.length === 2 && e[0].name === '@a' && e[1].name === '침착맨');
  check('S2 등록일을 지어내지 않고 null', e[0].addedAt === null && e[1].addedAt === null);
  check('S3 빈 문자열 제거', !e.some((x) => !x.name.trim()));
}

// 신 형식(객체 배열)
{
  const now = Date.now();
  const e = toChannelEntries([{ name: '@a', addedAt: now }, { name: '@b' }, { name: '', addedAt: now }]);
  check('S4 신 형식 유지', e.length === 2 && e[0].addedAt === now);
  check('S5 addedAt 없으면 null', e[1].addedAt === null);
}

// 혼합 (마이그레이션 도중 상태)
{
  const e = toChannelEntries(['@old', { name: '@new', addedAt: 1700000000000 }]);
  check('S6 혼합 배열 처리', e.length === 2 && e[0].addedAt === null && e[1].addedAt === 1700000000000);
}

// 잘못된 입력
{
  check('S7 배열이 아니면 빈 배열', toChannelEntries(undefined).length === 0 && toChannelEntries(null).length === 0);
  check('S8 이상한 항목 무시', toChannelEntries([null, 42, {}, { name: 5 }]).length === 0);
  check('S9 음수/NaN addedAt 은 null', toChannelEntries([{ name: '@a', addedAt: -1 }])[0].addedAt === null);
}

// content.js 가 쓰는 이름 추출
{
  check('S10 이름만 추출 (구 형식)', JSON.stringify(channelNamesOf(['@a', '@b'])) === '["@a","@b"]');
  check('S11 이름만 추출 (신 형식)',
        JSON.stringify(channelNamesOf([{ name: '@a', addedAt: 1 }])) === '["@a"]');
}

// 중복 판정은 @ / 대소문자를 무시한다
{
  const entries = toChannelEntries([{ name: '@ABC', addedAt: 1 }]);
  check('S12 대소문자 무시 중복 탐지', !!findChannelEntry(entries, 'abc'));
  check('S13 @ 무시 중복 탐지', !!findChannelEntry(entries, '@abc'));
  check('S14 다른 채널은 미탐', !findChannelEntry(entries, '@abcd'));
  check('S15 빈 값은 미탐', !findChannelEntry(entries, '  '));
}

// 날짜 표기
{
  const d = new Date(2026, 7, 21).getTime();
  check('S16 날짜 포맷', formatAddedAt(d) === '2026-08-21');
  check('S17 등록일 없으면 안내 문구', formatAddedAt(null) === '기록 없음');
  check('S18 잘못된 값도 안전', formatAddedAt('zzz') === '기록 없음');
}

check('S19 정규화 규칙', normalizeChannelName('  @HanGul ') === 'hangul');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
