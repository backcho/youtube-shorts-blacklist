document.addEventListener('DOMContentLoaded', () => {
  const channelInput = document.getElementById('channelInput');
  const addBtn = document.getElementById('addBtn');
  const blacklistUI = document.getElementById('blacklist');
  const currentChannelText = document.getElementById('currentChannelText');
  const quickAddBtn = document.getElementById('quickAddBtn');
  const blockAdsToggle = document.getElementById('blockAdsToggle');
  const listSummary = document.getElementById('listSummary');
  const manageBtn = document.getElementById('manageBtn');

  const DEFAULT_RECENT_COUNT = 5;
  let recentCount = DEFAULT_RECENT_COUNT;

  let detectedChannel = '';

  // 현재 활성화된 유튜브 탭에서 채널명 가져오기
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    // 권한이 없는 탭에서는 url이 undefined일 수 있음
    if (tab && tab.url && tab.url.includes('youtube.com/shorts')) {
      chrome.tabs.sendMessage(tab.id, { action: 'getCurrentChannel' }, (response) => {
        if (chrome.runtime.lastError || !response || !response.channelName) {
          currentChannelText.textContent = '채널을 찾을 수 없습니다.';
          return;
        }

        detectedChannel = response.channelName;
        currentChannelText.textContent = detectedChannel;
        // 사용자가 이미 입력 중이라면 덮어쓰지 않음
        if (!channelInput.value) {
          channelInput.value = detectedChannel;
        }
        quickAddBtn.style.display = 'block';
      });
    } else {
      currentChannelText.textContent = '유튜브 숏츠 페이지가 아닙니다.';
    }
  });

  // 블랙리스트 목록 불러오기
  function loadBlacklist() {
    chrome.storage.local.get(['blacklist', 'popupRecentCount'], (result) => {
      const stored = Number(result.popupRecentCount);
      recentCount = Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_RECENT_COUNT;
      renderList(toChannelEntries(result.blacklist));
    });
  }

  // UI 목록 출력 (최근 등록순으로 상위 N개만)
  function renderList(list) {   // list: toChannelEntries 결과
    blacklistUI.innerHTML = '';
    if (list.length === 0) {
      blacklistUI.innerHTML = '<div class="empty-msg">등록된 블랙리스트 채널이 없습니다.</div>';
      listSummary.textContent = '';
      return;
    }

    // 저장 순서가 곧 등록 순서이므로 뒤집으면 최근 등록이 위로 온다
    const recent = list.slice().reverse().slice(0, recentCount);

    listSummary.textContent = list.length > recent.length
      ? `최근 ${recent.length}개 표시 / 전체 ${list.length}개`
      : `전체 ${list.length}개`;

    recent.forEach((entry) => {
      const li = document.createElement('li');

      const label = document.createElement('span');
      label.textContent = entry.name;
      label.title = `등록일: ${formatAddedAt(entry.addedAt)}`;

      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = '✕';
      deleteBtn.className = 'delete-btn';
      // 인덱스는 저장소가 바뀌면 어긋나므로 값 기준으로 삭제
      deleteBtn.addEventListener('click', () => removeChannel(entry.name));

      li.appendChild(label);
      li.appendChild(deleteBtn);
      blacklistUI.appendChild(li);
    });
  }

  // 채널 추가 공통 함수
  function addChannel(nameToAdd) {
    const channelName = (nameToAdd || channelInput.value).trim();
    if (!channelName) return;

    chrome.storage.local.get(['blacklist'], (result) => {
      const entries = toChannelEntries(result.blacklist);

      if (findChannelEntry(entries, channelName)) {
        alert('이미 등록된 채널입니다.');
        return;
      }

      entries.push({ name: channelName, addedAt: Date.now() });
      chrome.storage.local.set({ blacklist: entries }, () => {
        channelInput.value = '';
        loadBlacklist();
      });
    });
  }

  // 채널 삭제
  function removeChannel(nameToRemove) {
    chrome.storage.local.get(['blacklist'], (result) => {
      const target = normalizeChannelName(nameToRemove);
      const next = toChannelEntries(result.blacklist)
        .filter((entry) => normalizeChannelName(entry.name) !== target);

      chrome.storage.local.set({ blacklist: next }, () => {
        loadBlacklist();
      });
    });
  }

  // 광고 자동 재생 막기 설정 (기본 꺼짐)
  function loadSettings() {
    chrome.storage.local.get(['blockAds'], (result) => {
      blockAdsToggle.checked = result.blockAds === true;
    });
  }

  blockAdsToggle.addEventListener('change', () => {
    chrome.storage.local.set({ blockAds: blockAdsToggle.checked });
  });

  manageBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // 이벤트 리스너
  addBtn.addEventListener('click', () => addChannel());
  quickAddBtn.addEventListener('click', () => addChannel(detectedChannel));
  channelInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addChannel();
  });

  loadBlacklist();
  loadSettings();
});
