// 테스트용 chrome.i18n 스텁.
// 실제 _locales/*/messages.json 을 읽고, 크롬의 폴백 규칙을 따라 로케일을 고른다.
//
//   1. 요청 로케일에서 지역 코드를 뗀다 (ko-KR -> ko)
//   2. 해당 _locales 디렉토리가 없으면 manifest 의 default_locale 을 쓴다
//   3. 선택된 로케일에 키가 없으면 default_locale 에서 보충한다
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');

function availableLocales() {
  return fs.readdirSync(path.join(SRC, '_locales'))
    .filter((d) => fs.existsSync(path.join(SRC, '_locales', d, 'messages.json')));
}

function defaultLocale() {
  return JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8')).default_locale;
}

function loadMessages(locale) {
  return JSON.parse(fs.readFileSync(path.join(SRC, '_locales', locale, 'messages.json'), 'utf8'));
}

// 크롬이 실제로 고르는 로케일
function resolveLocale(requested) {
  const fallback = defaultLocale();
  if (!requested) return fallback;
  const available = availableLocales();
  const base = String(requested).replace('_', '-').split('-')[0].toLowerCase();
  if (available.includes(requested)) return requested;
  if (available.includes(base)) return base;
  return fallback;
}

function expand(entry, substitutions) {
  let out = entry.message;
  const subs = Array.isArray(substitutions)
    ? substitutions
    : (substitutions != null ? [substitutions] : []);
  if (entry.placeholders) {
    for (const [name, def] of Object.entries(entry.placeholders)) {
      const idx = parseInt(String(def.content).replace('$', ''), 10) - 1;
      const value = subs[idx] != null ? subs[idx] : '';
      out = out.replace(new RegExp('\\$' + name + '\\$', 'gi'), value);
    }
  }
  return out;
}

function makeI18n(locale) {
  const resolved = resolveLocale(locale);
  const messages = loadMessages(resolved);
  const fallbackMessages = resolved === defaultLocale() ? messages : loadMessages(defaultLocale());
  return {
    resolvedLocale: resolved,
    getMessage(key, substitutions) {
      const entry = messages[key] || fallbackMessages[key];
      return entry ? expand(entry, substitutions) : '';
    },
  };
}

module.exports = { loadMessages, makeI18n, resolveLocale, availableLocales, defaultLocale };
