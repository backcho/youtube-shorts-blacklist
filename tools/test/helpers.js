// 테스트용 chrome.i18n 스텁.
// 실제 _locales/*/messages.json 을 읽어 확장과 같은 문구로 검증한다.
const fs = require('fs');
const path = require('path');

function loadMessages(locale) {
  const p = path.join(__dirname, '..', '..', 'src', '_locales', locale, 'messages.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function makeI18n(locale) {
  const messages = loadMessages(locale || 'ko');
  return {
    getMessage(key, substitutions) {
      const entry = messages[key];
      if (!entry) return '';
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
    },
  };
}

module.exports = { loadMessages, makeI18n };
