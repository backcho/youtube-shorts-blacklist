// 모든 회귀 시나리오를 순서대로 실행한다.
const { spawnSync } = require('child_process');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src', 'content.js');
const suites = ['i18n.js', 'storage.js', 'manage.js', 'scenario.js', 'scenario2.js', 'adrisk.js', 'recommend.js'];

let failed = 0;
for (const suite of suites) {
  console.log(`\n=== ${suite} ===`);
  const r = spawnSync(process.execPath, [path.join(__dirname, suite), SRC], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}

console.log(failed ? `\n${failed}개 스위트 실패` : '\n모든 스위트 통과');
process.exit(failed ? 1 : 0);
