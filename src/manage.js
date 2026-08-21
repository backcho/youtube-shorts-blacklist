document.addEventListener('DOMContentLoaded', () => {
  applyI18n();

  const addInput = document.getElementById('addInput');
  const addBtn = document.getElementById('addBtn');
  const searchInput = document.getElementById('searchInput');
  const sortSelect = document.getElementById('sortSelect');
  const listEl = document.getElementById('list');
  const countEl = document.getElementById('count');
  const recentCountInput = document.getElementById('recentCountInput');
  const saveCountBtn = document.getElementById('saveCountBtn');
  const saveMsg = document.getElementById('saveMsg');
  const blockAdsToggle = document.getElementById('blockAdsToggle');

  const DEFAULT_RECENT_COUNT = 5;
  let blacklist = [];

  function load() {
    chrome.storage.local.get(['blacklist', 'popupRecentCount', 'blockAds'], (result) => {
      blacklist = toChannelEntries(result.blacklist);
      const stored = Number(result.popupRecentCount);
      recentCountInput.value = Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_RECENT_COUNT;
      blockAdsToggle.checked = result.blockAds === true;
      render();
    });
  }

  function save(next, done) {
    blacklist = next;
    chrome.storage.local.set({ blacklist: next }, () => {
      render();
      if (done) done();
    });
  }

  function render() {
    const keyword = normalizeChannelName(searchInput.value);
    // 저장 순서가 곧 등록 순서다 (등록일이 없는 이전 항목도 순서는 신뢰할 수 있다)
    let items = blacklist.map((entry, index) => ({ name: entry.name, addedAt: entry.addedAt, index }));

    if (keyword) {
      items = items.filter((it) => normalizeChannelName(it.name).includes(keyword));
    }

    const sort = sortSelect.value;
    if (sort === 'recent') items.reverse();
    else if (sort === 'name') items.sort((a, b) => a.name.localeCompare(b.name, 'ko'));

    countEl.textContent = keyword
      ? t('countFiltered', [String(items.length), String(blacklist.length)])
      : t('countAll', [String(blacklist.length)]);

    listEl.innerHTML = '';
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-msg';
      empty.textContent = blacklist.length === 0
        ? t('emptyListManage')
        : t('noResults');
      listEl.appendChild(empty);
      return;
    }

    items.forEach((it) => {
      const li = document.createElement('li');

      const left = document.createElement('span');
      const idx = document.createElement('span');
      idx.className = 'idx';
      idx.textContent = `#${it.index + 1}`;
      const label = document.createElement('span');
      label.textContent = it.name;
      left.appendChild(idx);
      left.appendChild(label);

      const added = document.createElement('span');
      added.className = 'added-at';
      added.textContent = formatAddedAt(it.addedAt);

      const del = document.createElement('button');
      del.className = 'delete-btn';
      del.textContent = '✕';
      del.title = t('deleteTitle');
      del.addEventListener('click', () => removeChannel(it.name));

      const right = document.createElement('span');
      right.className = 'row-right';
      right.appendChild(added);
      right.appendChild(del);

      li.appendChild(left);
      li.appendChild(right);
      listEl.appendChild(li);
    });
  }

  function addChannel() {
    const name = addInput.value.trim();
    if (!name) return;

    if (findChannelEntry(blacklist, name)) {
      alert(t('alreadyRegistered'));
      return;
    }

    save(blacklist.concat([{ name, addedAt: Date.now() }]), () => { addInput.value = ''; });
  }

  function removeChannel(name) {
    const target = normalizeChannelName(name);
    save(blacklist.filter((entry) => normalizeChannelName(entry.name) !== target));
  }

  addBtn.addEventListener('click', addChannel);
  addInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') addChannel(); });
  searchInput.addEventListener('input', render);
  sortSelect.addEventListener('change', render);

  saveCountBtn.addEventListener('click', () => {
    const value = Number(recentCountInput.value);
    if (!Number.isFinite(value) || value < 1) {
      alert(t('invalidCount'));
      return;
    }
    chrome.storage.local.set({ popupRecentCount: value }, () => {
      saveMsg.textContent = t('saved');
      setTimeout(() => { saveMsg.textContent = ''; }, 2000);
    });
  });

  blockAdsToggle.addEventListener('change', () => {
    chrome.storage.local.set({ blockAds: blockAdsToggle.checked });
  });

  // 팝업 등 다른 화면에서 변경한 내용을 실시간 반영
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local') return;
    if (changes.blacklist) {
      blacklist = toChannelEntries(changes.blacklist.newValue);
      render();
    }
    if (changes.blockAds) {
      blockAdsToggle.checked = changes.blockAds.newValue === true;
    }
  });

  load();
});
