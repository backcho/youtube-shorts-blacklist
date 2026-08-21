// 블랙리스트 저장 형식 유틸 (content / popup / manage 공용)
//
// 저장 형식: [{ name, addedAt }]
//   - addedAt 은 등록 시각(ms). 등록일을 알 수 없는 항목은 null 이다.
//   - v0.6 이전에는 문자열 배열이었다. 읽을 때 자동으로 변환하며,
//     그 시점의 실제 등록일은 알 수 없으므로 addedAt 을 지어내지 않고 null 로 둔다.
//
// content script 에서도 쓰이므로 function 선언만 사용한다.

// ── i18n ────────────────────────────────────────────────────
// 브라우저 UI 언어에 따라 _locales/{ko,en}/messages.json 이 선택된다.
// 유튜브 메뉴 문구 매칭(content.js)은 여기 포함되지 않는다.
// 그쪽은 브라우저 언어가 아니라 유튜브 UI 언어를 따르므로 양쪽을 모두 들고 있어야 한다.
function t(key, substitutions) {
  const msg = chrome.i18n.getMessage(key, substitutions);
  return msg || key;
}

// data-i18n / data-i18n-placeholder / data-i18n-title 속성을 채운다
function applyI18n(root) {
  const scope = root || document;
  scope.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  scope.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });
  scope.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.getAttribute('data-i18n-title'));
  });
}

function normalizeChannelName(name) {
  return String(name || '').trim().toLowerCase().replace(/^@/, '');
}

// 구 형식(문자열 배열)과 현 형식(객체 배열)을 모두 받아 항목 배열로 정규화한다
function toChannelEntries(raw) {
  if (!Array.isArray(raw)) return [];

  const entries = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      if (item.trim()) entries.push({ name: item, addedAt: null });
      continue;
    }
    if (item && typeof item.name === 'string' && item.name.trim()) {
      const at = Number(item.addedAt);
      entries.push({ name: item.name, addedAt: Number.isFinite(at) && at > 0 ? at : null });
    }
  }
  return entries;
}

function channelNamesOf(raw) {
  return toChannelEntries(raw).map((entry) => entry.name);
}

function findChannelEntry(entries, name) {
  const target = normalizeChannelName(name);
  if (!target) return null;
  return entries.find((entry) => normalizeChannelName(entry.name) === target) || null;
}

function formatAddedAt(addedAt) {
  if (!addedAt) return t('noDate');
  const d = new Date(addedAt);
  if (Number.isNaN(d.getTime())) return t('noDate');
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
