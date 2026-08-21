let currentBlacklist = [];
let blacklistLoaded = false;
let blockAdsEnabled = false;   // 광고 자동 재생 막기 (옵션, 기본 꺼짐)

let currentShortsId = null;          // 현재 숏츠 ID
let currentReelEl = null;            // 현재 활성 reel 요소 (URL이 안 바뀌는 광고 전환 감지용)
let isUserResumed = false;           // 현재 숏츠를 사용자가 직접 클릭해서 계속 보기로 했는지
let blockedForCurrentShorts = false; // 현재 숏츠가 차단 대상으로 판정됐는지
let lastBlockMessage = null;         // 현재 항목의 정지 사유 문구 (차단 채널 / 광고 공용)
let lastBlockOptions = null;         // 오버레이 옵션 (액션 버튼 노출 여부)
let extensionPausedPlayback = false; // 확장이 이번 숏츠의 재생을 막았는지
let lastPausedVideo = null;          // 확장이 마지막으로 정지시킨 video
let autoResumeDeadline = 0;          // 영상 전환 직후 자동 재생 복구가 허용되는 시각
let checkTimeout = null;

// 확장이 막아둔 정지 상태는 유튜브 플레이어에 남아 다음 영상까지 이어진다.
// 그 여파를 푸는 복구는 '영상 전환 직후 잠깐'으로만 허용해서
// 사용자가 직접 누른 일시정지를 되살리지 않도록 한다.
const AUTO_RESUME_WINDOW_MS = 2500;

// chrome.storage에서 블랙리스트 불러오기
function updateBlacklistFromStorage() {
  chrome.storage.local.get(['blacklist', 'blockAds'], (result) => {
    currentBlacklist = channelNamesOf(result.blacklist);
    blockAdsEnabled = result.blockAds === true;
    blacklistLoaded = true;
    checkAndHandleVideo();
  });
}

// 스토리지 변경 실시간 감지
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== 'local') return;

  let changed = false;
  if (changes.blacklist) {
    currentBlacklist = channelNamesOf(changes.blacklist.newValue);
    blacklistLoaded = true;
    changed = true;
  }
  if (changes.blockAds) {
    blockAdsEnabled = changes.blockAds.newValue === true;
    changed = true;
  }
  if (changed) checkAndHandleVideo();
});

// 숏츠 페이지 여부 (SPA 이동으로 다른 페이지에 머무를 수 있음)
function isShortsPage() {
  return window.location.pathname.startsWith('/shorts/');
}

// 플레이어가 광고를 재생 중인지 (전역 신호)
// ad-created는 광고가 한 번 생성되면 남는 클래스라 판정에 쓰면 안 된다.
function isAdPlaying() {
  return !!document.querySelector(
    '.html5-video-player.ad-showing, .html5-video-player.ad-interrupting, ' +
    '.ytp-ad-player-overlay, .ytp-ad-player-overlay-layout'
  );
}

// 이 reel 자체가 광고인지 판별.
// 숏츠 피드는 광고를 ytd-reel-video-renderer 안의 ytd-ad-slot-renderer로 끼워 넣는다.
// 광고 reel에는 채널바가 없어 직전 채널명을 잘못 읽기 쉬우므로 아예 개입하지 않는다.
// (전역 검색은 피드에 미리 로드된 광고 슬롯까지 잡아 차단을 통째로 무력화하므로 금지)
function isAdReel(reel) {
  return !!reel && !!reel.querySelector('ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer');
}

// ─────────────────────────────────────────────────────────────
// '채널 추천 안 함' 자동 처리
// 유튜브 메뉴를 대신 눌러 준다. DOM/문구가 바뀌면 조용히 깨지므로
// 자동 클릭은 문구가 정확히 일치할 때만 하고, 실패하면 메뉴를 열어 둔 채 사용자에게 넘긴다.
// (메뉴에는 '신고'가 바로 옆에 있어 부분 일치나 순서 기반 탐색은 절대 쓰지 않는다)
// ─────────────────────────────────────────────────────────────
// 오버레이 버튼 라벨은 브라우저 UI 언어를 따른다
const DONT_RECOMMEND_LABEL = t('dontRecommend');

// 유튜브 메뉴 문구. 브라우저 UI 언어가 아니라 '유튜브' UI 언어를 따르므로
// i18n 으로 빼지 않고 두 언어를 모두 들고 있는다.
// 공백을 지우고 비교한다 ('채널 추천 안함' / '채널 추천 안 함' 등 표기 흔들림 대응)
const DONT_RECOMMEND_MENU_TEXTS = [
  '채널추천안함',
  '이채널추천안함',
  "don'trecommendchannel",
  'dontrecommendchannel',
];

const MENU_ITEM_SELECTOR = 'yt-list-item-view-model, ytd-menu-service-item-renderer, tp-yt-paper-item';

// 메뉴 드롭다운의 최상위 요소
const MENU_CONTAINER_SELECTOR = 'tp-yt-iron-dropdown';

// 메뉴가 렌더될 때까지 100ms 간격으로 기다리는 횟수 (약 2초)
const MENU_WAIT_ATTEMPTS = 20;

// 숏츠의 '⋮' 버튼 후보들. 위와 같은 이유로 i18n 대상이 아니다.
//
// 관측된 구조(2026-08):
//   ytd-menu-renderer.style-scope.ytd-shorts-player-controls
//     > yt-button-shape#button-shape.style-scope.ytd-menu-renderer
//       > button[aria-label="추가 작업"]      (button 자체에는 id 가 없다)
//
// 구조 기반 셀렉터를 먼저 쓴다. aria-label 은 UI 언어를 타지만 구조는 그렇지 않다.
// 라벨 후보는 구조가 바뀌었을 때를 위한 폴백이다.
const MORE_ACTIONS_SELECTORS = [
  'ytd-menu-renderer.ytd-shorts-player-controls button',
  'ytd-menu-renderer yt-button-shape#button-shape button',
  'ytd-menu-renderer button',
  'button[aria-label="추가 작업"]',
  'button[aria-label="기타 작업"]',
  'button[aria-label*="More actions"]',
];

// 영상이 바뀌면 버튼을 기본 상태로 되돌린다 (이전 영상의 '처리됨' 표시가 남지 않도록)
function resetOverlayActions() {
  const buttons = document.querySelectorAll('.blacklist-overlay-action');
  for (const btn of buttons) {
    btn.disabled = false;
    if (btn.textContent !== DONT_RECOMMEND_LABEL) {
      btn.textContent = DONT_RECOMMEND_LABEL;
    }
  }
}

function normalizeMenuText(text) {
  return String(text || '').replace(/\s+/g, '').toLowerCase();
}

function findMoreActionsButton(reel) {
  if (!reel) return null;
  for (const selector of MORE_ACTIONS_SELECTORS) {
    const el = reel.querySelector(selector);
    if (el) return el;
  }
  return null;
}

// 열려 있는 드롭다운을 찾는다.
// 페이지에는 닫힌 메뉴(댓글 정렬 등)가 여럿 떠 있어서 전역 검색은 그쪽 항목까지 잡는다.
function findOpenDropdown() {
  const dropdowns = document.querySelectorAll(MENU_CONTAINER_SELECTOR);
  for (const dropdown of dropdowns) {
    if (dropdown.getAttribute('aria-hidden') === 'true') continue;
    const rect = dropdown.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return dropdown;
  }
  return null;
}

function isVisible(el) {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function matchDontRecommend(items) {
  for (const item of items) {
    if (DONT_RECOMMEND_MENU_TEXTS.includes(normalizeMenuText(item.textContent))) {
      return item;
    }
  }
  return null;
}

// 열린 메뉴에서 '채널 추천 안 함' 항목을 찾는다 (완전 일치만).
//
// 메뉴는 클릭 후 비동기로 렌더되므로, 기다리는 동안에는 열린 드롭다운 안에서만 찾는다.
// 이때 전역으로 넓히면 아직 안 열린 우리 메뉴 대신 닫혀 있는 다른 메뉴의 항목을 집는다.
// 전역 폴백은 드롭다운 구조가 바뀐 경우를 위한 것이라 마지막 시도에서만,
// 그것도 화면에 실제로 보이는 항목에 한해 허용한다.
function findDontRecommendItem(allowGlobalFallback) {
  const dropdown = findOpenDropdown();
  if (dropdown) {
    return matchDontRecommend(dropdown.querySelectorAll(MENU_ITEM_SELECTOR));
  }
  if (!allowGlobalFallback) return null;
  return matchDontRecommend(
    [...document.querySelectorAll(MENU_ITEM_SELECTOR)].filter(isVisible));
}

// 항목 내부의 실제 클릭 대상을 찾는다
function clickMenuItem(item) {
  const clickable = item.querySelector('[role="menuitem"], button, a, yt-list-item-view-model') || item;
  clickable.click();
}

function onDontRecommendClick(e) {
  e.preventDefault();
  e.stopPropagation();

  const button = e.currentTarget;
  const data = getActiveShortsData();
  const moreBtn = findMoreActionsButton(data && data.activeReel);

  if (!moreBtn) {
    button.textContent = t('menuNotFound');
    return;
  }

  button.disabled = true;
  button.textContent = t('processing');
  moreBtn.click();

  // 메뉴는 비동기로 렌더되므로 잠시 기다렸다가 항목을 찾는다
  let attempts = 0;
  const timer = setInterval(() => {
    attempts++;
    const item = findDontRecommendItem(attempts >= MENU_WAIT_ATTEMPTS);

    if (item) {
      clearInterval(timer);
      clickMenuItem(item);
      button.textContent = t('recommendDone');
      return;
    }

    if (attempts >= MENU_WAIT_ATTEMPTS) {
      clearInterval(timer);
      // 자동 처리 실패: 메뉴는 열려 있으므로 사용자가 직접 고르게 둔다
      button.disabled = false;
      button.textContent = t('selectFromMenu');
    }
  }, 100);
}

// 오버레이 색상 (광고 / 블랙리스트를 한눈에 구분)
const OVERLAY_STYLES = {
  ad: {
    bgColor: 'rgba(217, 48, 37, 0.94)',      // 묵직한 웜 레드
    btnBorder: '1px solid rgba(255, 255, 255, 0.5)'
  },
  blacklist: {
    bgColor: 'rgba(230, 126, 34, 0.94)',     // 세련된 오렌지 / 호박색
    btnBorder: '1px solid rgba(255, 255, 255, 0.6)'
  }
};

// 정지 사유 문구
const AD_BLOCK_MESSAGE = t('overlayAd');
function blacklistBlockMessage(channelName) {
  return t('overlayBlocked', [String(channelName)]);
}

// 현재 숏츠 ID(URL 기반) 추출
function getShortsIdFromURL() {
  const match = window.location.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

// 블랙리스트 매칭 검사
function isBlacklistedChannel(channelName) {
  const target = normalizeChannelName(channelName);
  if (!target) return false;
  return currentBlacklist.some((item) => normalizeChannelName(item) === target);
}

// 채널명 추출 함수 (href 디코딩 우선 - 한글/특수문자 채널 대응)
function extractChannelName(element) {
  if (!element) return null;

  const href = element.getAttribute('href');
  if (href && href.includes('/@')) {
    try {
      const decodedHref = decodeURIComponent(href);
      const match = decodedHref.match(/\/@([^/?#]+)/);
      if (match && match[1]) {
        return `@${match[1]}`;
      }
    } catch (e) {}
  }

  const text = element.textContent ? element.textContent.trim() : '';
  return text || null;
}

// 화면에 보이는 활성 숏츠 컨테이너 찾기
function getActiveReel() {
  const active = document.querySelector('ytd-reel-video-renderer[is-active]');
  if (active) return active;

  // is-active 속성이 없는 레이아웃 대비: 뷰포트를 가장 많이 덮는 reel을 사용한다.
  // 화면 절반 미만만 걸치는 reel은 이전/다음 영상이므로 활성으로 인정하지 않는다.
  const reels = document.querySelectorAll('ytd-reel-video-renderer');
  const viewportHeight = window.innerHeight;
  let best = null;
  let bestOverlap = 0;

  for (const reel of reels) {
    const rect = reel.getBoundingClientRect();
    if (rect.height === 0 || rect.width === 0) continue;
    const overlap = Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = reel;
    }
  }

  return bestOverlap >= viewportHeight * 0.5 ? best : null;
}

// 현재 활성화된 숏츠 정보 조회
function getActiveShortsData() {
  const activeReel = getActiveReel();
  if (!activeReel) return null;

  const video = activeReel.querySelector('video');
  let channelName = null;

  const modernChannelEl = activeReel.querySelector('.ytReelChannelBarViewModelChannelName a');
  if (modernChannelEl) {
    channelName = extractChannelName(modernChannelEl);
  }

  if (!channelName) {
    const selectors = ['#channel-name a', 'ytd-channel-name a', 'a[href*="/@"]'];
    for (const selector of selectors) {
      const el = activeReel.querySelector(selector);
      channelName = extractChannelName(el);
      if (channelName) break;
    }
  }

  return { activeReel, video, channelName };
}

// 오버레이 표시 (화면 중앙)
// 메시지와 액션 버튼을 별도 노드로 두어, 문구를 갱신해도 버튼이 사라지지 않게 한다.
function showOverlay(activeReel, message, options) {
  if (!activeReel) return;

  const showAction = !!(options && options.action);

  let overlay = activeReel.querySelector('.blacklist-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'blacklist-overlay';
    overlay.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: white;
      padding: 14px 22px;
      border-radius: 25px;
      font-weight: bold;
      font-size: 14px;
      z-index: 9999;
      pointer-events: none;
      box-shadow: 0 6px 16px rgba(0,0,0,0.4);
      text-align: center;
      backdrop-filter: blur(4px);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
    `;

    const messageEl = document.createElement('span');
    messageEl.className = 'blacklist-overlay-message';
    overlay.appendChild(messageEl);

    const actionBtn = document.createElement('button');
    actionBtn.className = 'blacklist-overlay-action';
    actionBtn.type = 'button';
    actionBtn.textContent = DONT_RECOMMEND_LABEL;
    actionBtn.style.cssText = `
      pointer-events: auto;
      cursor: pointer;
      background: rgba(0,0,0,0.25);
      color: white;
      font: inherit;
      font-size: 12px;
      padding: 6px 12px;
      border-radius: 14px;
    `;
    actionBtn.addEventListener('click', onDontRecommendClick, true);
    overlay.appendChild(actionBtn);

    activeReel.style.position = 'relative';
    activeReel.appendChild(overlay);
  }

  // 동일한 값을 다시 쓰면 MutationObserver가 재발화하므로 변경 시에만 반영
  const style = OVERLAY_STYLES[(options && options.kind) || 'blacklist'] || OVERLAY_STYLES.blacklist;
  if (overlay.style.backgroundColor !== style.bgColor) {
    overlay.style.backgroundColor = style.bgColor;
  }

  const messageEl = overlay.querySelector('.blacklist-overlay-message');
  if (messageEl && messageEl.textContent !== message) {
    messageEl.textContent = message;
  }

  const actionBtn = overlay.querySelector('.blacklist-overlay-action');
  if (actionBtn) {
    if (actionBtn.style.border !== style.btnBorder) {
      actionBtn.style.border = style.btnBorder;
    }
    const wanted = showAction ? 'inline-block' : 'none';
    if (actionBtn.style.display !== wanted) {
      actionBtn.style.display = wanted;
    }
  }

  if (overlay.style.display !== 'flex') {
    overlay.style.display = 'flex';
  }
}

// 오버레이 숨김
function hideOverlay(activeReel) {
  if (!activeReel) return;
  const overlay = activeReel.querySelector('.blacklist-overlay');
  if (overlay && overlay.style.display !== 'none') {
    overlay.style.display = 'none';
  }
}

// 활성 숏츠가 아닌 곳에 남아있는 오버레이 정리
function hideStaleOverlays(activeReel) {
  const overlays = document.querySelectorAll('.blacklist-overlay');
  for (const overlay of overlays) {
    if (activeReel && activeReel.contains(overlay)) continue;
    if (overlay.style.display !== 'none') {
      overlay.style.display = 'none';
    }
  }
}

// 숏츠 진입/전환 시 상태 초기화
// 광고 reel로 넘어갈 때는 URL이 그대로일 수 있어 URL만으로는 전환을 놓친다.
// 활성 reel 요소가 바뀐 것도 전환으로 본다.
function syncCurrentItem(activeReel) {
  const newShortsId = getShortsIdFromURL();
  const idChanged = !!newShortsId && newShortsId !== currentShortsId;
  const reelChanged = !!activeReel && activeReel !== currentReelEl;
  if (!idChanged && !reelChanged) return false;

  if (newShortsId) currentShortsId = newShortsId;
  if (activeReel) currentReelEl = activeReel;
  isUserResumed = false;
  blockedForCurrentShorts = false;
  lastBlockMessage = null;
  lastBlockOptions = null;
  resetOverlayActions();

  // 확장이 막아둔 정지 여파는 영상이 바뀌어도 유튜브 플레이어에 남는다.
  // 광고 구간을 지나는 동안 놓치지 않도록 전환 때마다 복구 창을 다시 연다.
  autoResumeDeadline = extensionPausedPlayback ? Date.now() + AUTO_RESUME_WINDOW_MS : 0;
  return true;
}

// 자동 정지 처리 (차단 채널 / 광고 공용)
function blockPlayback(activeReel, video, message, options) {
  blockedForCurrentShorts = true;
  lastBlockMessage = message;
  lastBlockOptions = options || null;
  extensionPausedPlayback = true;
  autoResumeDeadline = 0;

  if (video && !video.paused) {
    video.pause();
    lastPausedVideo = video;
    console.log('[Blacklist] 자동 정지:', message);
  }
  showOverlay(activeReel, message, options);
}

// 핵심 제어 및 정지 로직
function checkAndHandleVideo() {
  if (!isShortsPage()) {
    // 숏츠를 벗어나면 상태를 초기화해 다음 진입 시 오판하지 않도록 함
    currentShortsId = null;
    currentReelEl = null;
    isUserResumed = false;
    blockedForCurrentShorts = false;
    lastBlockMessage = null;
    lastBlockOptions = null;
    extensionPausedPlayback = false;
    lastPausedVideo = null;
    autoResumeDeadline = 0;
    hideStaleOverlays(null);
    return;
  }

  const data = getActiveShortsData();
  if (!data) return;

  const { activeReel, video, channelName } = data;

  // 채널명 추출 실패와 무관하게 영상 전환은 먼저 반영해야 상태가 새지 않음
  syncCurrentItem(activeReel);

  // 광고: 채널 정보가 없어 차단 판정을 할 수 없다.
  // 옵션이 켜져 있을 때만 자동 재생을 막고, 꺼져 있으면 오버레이만 걷고 손대지 않는다.
  if (isAdReel(activeReel) || isAdPlaying()) {
    hideStaleOverlays(activeReel);
    if (blockAdsEnabled && video && !isUserResumed) {
      blockPlayback(activeReel, video, AD_BLOCK_MESSAGE, { kind: 'ad' });
    } else {
      hideOverlay(activeReel);
    }
    return;
  }

  if (!blacklistLoaded) return;

  hideStaleOverlays(activeReel);

  if (!video) return;

  if (!channelName) {
    // 채널바가 일시적으로 사라져도 이미 차단 판정된 숏츠라면 상태를 유지한다
    if (blockedForCurrentShorts && lastBlockMessage && !isUserResumed) {
      blockPlayback(activeReel, video, lastBlockMessage, lastBlockOptions);
    }
    return;
  }

  if (isBlacklistedChannel(channelName)) {
    if (isUserResumed) {
      hideOverlay(activeReel);
      return;
    }
    blockPlayback(activeReel, video, blacklistBlockMessage(channelName), { action: true, kind: 'blacklist' });
    return;
  }

  // 정상 채널
  blockedForCurrentShorts = false;
  lastBlockMessage = null;
  lastBlockOptions = null;
  hideOverlay(activeReel);

  // 같은 영상이 블랙리스트에서 빠진 경우: 확장이 직접 멈춘 영상만 되돌려 준다.
  // (사용자가 손으로 멈춘 영상은 lastPausedVideo가 아니므로 건드리지 않는다)
  if (lastPausedVideo === video && extensionPausedPlayback && video.readyState >= 2) {
    lastPausedVideo = null;
    extensionPausedPlayback = false;
    autoResumeDeadline = 0;
    if (video.paused) {
      video.play().catch((err) => {
        console.log('[Blacklist] 차단 해제 후 재생 시도:', err);
      });
    }
    return;
  }

  // 확장이 막아둔 여파로 멈춰 있는 경우에만, 전환 직후 잠깐 동안 재생을 복구한다.
  // 이 창을 벗어나면 사용자가 직접 누른 일시정지를 절대 건드리지 않는다.
  if (autoResumeDeadline) {
    if (Date.now() > autoResumeDeadline) {
      autoResumeDeadline = 0;
      return;
    }
    if (video.readyState >= 2) {
      autoResumeDeadline = 0;
      extensionPausedPlayback = false;
      lastPausedVideo = null;
      if (video.paused) {
        video.play().catch((err) => {
          // 브라우저 자동재생 제한 정책 예외 케이스 처리
          console.log('[Blacklist] 다음 영상 자동 재생 시도:', err);
        });
      }
    }
  }
}

// 사용자가 차단된 영상 화면을 직접 클릭한 경우 '계속 시청'으로 해석
document.addEventListener('click', (e) => {
  if (!isShortsPage() || isAdPlaying()) return;

  const data = getActiveShortsData();
  if (!data || !data.activeReel || !data.activeReel.contains(e.target)) return;

  // 좋아요/구독/채널 이동 등 버튼 클릭은 '계속 시청' 의도가 아님
  if (e.target instanceof Element &&
      e.target.closest('a, button, ytd-button-renderer, yt-button-shape, #actions, .ytReelChannelBarViewModel')) {
    return;
  }

  // 차단된 영상일 때만 개입한다.
  // 정상 영상의 클릭은 유튜브의 재생/일시정지 토글이므로 절대 건드리지 않는다.
  const blocked = blockedForCurrentShorts ||
                  (blockAdsEnabled && isAdReel(data.activeReel)) ||
                  isBlacklistedChannel(data.channelName);
  if (!blocked || isUserResumed) return;

  isUserResumed = true;
  extensionPausedPlayback = false;
  lastPausedVideo = null;
  autoResumeDeadline = 0;
  hideOverlay(data.activeReel);

  // 확장이 정지시킨 탓에 유튜브 내부 상태와 어긋나 클릭 한 번으로 재생되지 않는 경우 보정
  const video = data.video;
  if (video) {
    setTimeout(() => {
      if (isUserResumed && video.paused) {
        video.play().catch(() => {});
      }
    }, 50);
  }
}, true);

// 비디오 이벤트 제어 (최초 로딩/재생 시 차단 여부 체크)
document.addEventListener('play', (e) => {
  if (!isShortsPage()) return;

  const video = e.target;
  if (!video || video.tagName !== 'VIDEO') return;

  const data = getActiveShortsData();
  // 프리로드된 다른 숏츠나 광고 video에는 반응하지 않음
  if (!data || data.video !== video) return;

  syncCurrentItem(data.activeReel);

  if (isUserResumed) return;

  if (isAdReel(data.activeReel) || isAdPlaying()) {
    if (blockAdsEnabled) {
      blockPlayback(data.activeReel, video, AD_BLOCK_MESSAGE, { kind: 'ad' });
    }
    return;
  }

  if (!blacklistLoaded) return;

  if (isUserResumed) return;

  if (data.channelName) {
    if (isBlacklistedChannel(data.channelName)) {
      blockPlayback(data.activeReel, video, blacklistBlockMessage(data.channelName), { action: true, kind: 'blacklist' });
    }
  } else if (blockedForCurrentShorts && lastBlockMessage) {
    blockPlayback(data.activeReel, video, lastBlockMessage, lastBlockOptions);
  }
}, true);

// 디바운스/스로틀링 적용
function throttledCheck() {
  if (checkTimeout) return;
  checkTimeout = setTimeout(() => {
    checkTimeout = null;
    checkAndHandleVideo();
  }, 100);
}

// DOM 변동 감지
const observer = new MutationObserver(() => {
  throttledCheck();
});

function startObserver() {
  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  });
  checkAndHandleVideo();
}

// 초기화는 모든 선언이 끝난 뒤에 실행한다.
// (위쪽에서 호출하면 아래에 선언된 const 를 콜백이 먼저 건드려 TDZ 오류가 난다)
updateBlacklistFromStorage();

if (document.body) {
  startObserver();
} else {
  document.addEventListener('DOMContentLoaded', startObserver, { once: true });
}

// 진입 직후에는 채널바가 늦게 렌더되어 차단이 지연된다.
// MutationObserver의 100ms 스로틀과 별개로 초반 몇 초만 짧게 폴링한다.
let bootstrapTicks = 0;
const bootstrapTimer = setInterval(() => {
  bootstrapTicks++;
  checkAndHandleVideo();

  // 채널명을 읽어 판정이 끝났으면 폴링을 멈추고 MutationObserver에 맡긴다
  const data = isShortsPage() ? getActiveShortsData() : null;
  if (bootstrapTicks >= 60 || (data && data.channelName)) {
    clearInterval(bootstrapTimer);
  }
}, 50);

// 팝업 요청 시 현재 채널명 응답
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getCurrentChannel') {
    const data = isShortsPage() ? getActiveShortsData() : null;
    sendResponse({ channelName: data ? data.channelName : null });
  }
  return true;
});
