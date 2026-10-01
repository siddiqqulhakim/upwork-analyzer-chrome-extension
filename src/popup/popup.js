(function () {
  // ── Configuration ─────────────────────────────────────────────────────────
  const API_BASE     = 'https://upwork-analyzer-server-api.siddiqqulhakim.com';
  const ANALYZE_URL  = API_BASE + '/api/analyze';
  const CHECKLIST_URL = API_BASE + '/api/checklist';

  // Storage keys
  const PROFILE_KEY  = 'upworkAnalyzerProfile';
  const HISTORY_KEY  = 'upworkAnalyzerHistory';
  const MAX_HISTORY  = 100;

  // ── State ──────────────────────────────────────────────────────────────────
  let lastJobData       = null;
  let lastAnalysisData  = null;
  let lastProposalText  = null;
  let proposalCollapsed = false;
  let userProfile       = '';
  let currentView       = 'main'; // 'main' | 'history'

  // ── DOM Elements ───────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const statusEl          = $('status');
  const jsonViewEl        = $('json-view');
  const extractBtn        = $('extract-btn');
  const copyBtn           = $('copy-btn');
  const analyzeBtn        = $('analyze-btn');
  const proposalToggleEl  = $('proposal-toggle');
  const proposalCheckbox  = $('proposal-checkbox');
  const proposalSectionEl = $('proposal-section');
  const proposalBodyEl    = $('proposal-body');
  const proposalCopyBtn   = $('proposal-copy-btn');
  const proposalChevronEl = $('proposal-chevron');
  const profileToggleBtn  = $('profile-toggle-btn');
  const profilePanelEl    = $('profile-panel');
  const profileTextarea   = $('profile-textarea');
  const profileSaveBtn    = $('profile-save-btn');
  const profileSavedEl    = $('profile-saved-msg');
  const historyToggleBtn  = $('history-toggle-btn');
  const historyPanelEl    = $('history-panel');
  const historyListEl      = $('history-list');
  const historyClearBtn    = $('history-clear-btn');
  const mainViewEl         = $('main-view');
  const backToMainBtn      = $('back-to-main-btn');
  const apiStatusLight     = $('api-status-light');

  // ── Storage helpers ───────────────────────────────────────────────────────
  function storageGet(key, callback) {
    if (chrome?.storage?.local) {
      chrome.storage.local.get(key, (data) => callback(data?.[key] ?? null));
    } else {
      try {
        const val = localStorage.getItem(key);
        callback(val ? JSON.parse(val) : null);
      } catch {
        callback(null);
      }
    }
  }

  function storageSet(key, value, callback) {
    if (chrome?.storage?.local) {
      chrome.storage.local.set({ [key]: value }, () => {
        if (callback) callback(value);
      });
    } else {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        if (callback) callback(value);
      } catch {
        if (callback) callback(value);
      }
    }
  }

  // ── History helpers ────────────────────────────────────────────────────────
  function getHistory() {
    return new Promise((resolve) => {
      storageGet(HISTORY_KEY, (data) => {
        resolve(Array.isArray(data) ? data : []);
      });
    });
  }

  function saveToHistory(entry) {
    getHistory().then((history) => {
      // Deduplicate by job URL
      history = history.filter((h) => h.jobUrl !== entry.jobUrl);
      history.unshift(entry); // newest first
      if (history.length > MAX_HISTORY) {
        history = history.slice(0, MAX_HISTORY);
      }
      storageSet(HISTORY_KEY, history);
    });
  }

  async function renderHistory() {
    const history = await getHistory();

    if (history.length === 0) {
      historyListEl.innerHTML =
        '<div style="text-align:center;color:#666;font-size:11px;padding:20px 0;">No analysis history yet.<br>Your analyzed jobs will appear here.</div>';
      return;
    }

    historyListEl.innerHTML = history
      .map((item, i) => {
        const date = new Date(item.analyzedAt);
        const timeAgo = getTimeAgo(date);
        const verdictClass =
          item.verdict === 'APPLY' ? 'apply' :
          item.verdict === 'SKIP'  ? 'skip' : 'caution';
        const score = item.matchScore ? item.matchScore.replace('/10', '') : '';
        return `
      <div class="history-item" data-index="${i}">
        <div class="history-header">
          <span class="verdict-badge ${verdictClass}">${item.verdict}</span>
          ${score ? `<span class="history-score">${score}/10</span>` : ''}
          <span class="history-time">${timeAgo}</span>
        </div>
        <div class="history-title">${escapeHtml(item.jobTitle || 'Untitled')}</div>
        ${item.skills?.length ? `<div class="history-skills">${escapeHtml(item.skills.slice(0, 3).join(', '))}</div>` : ''}
      </div>`;
      })
      .join('');

    // Click to restore
    historyListEl.querySelectorAll('.history-item').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.index);
        restoreFromHistory(history[idx]);
      });
    });
  }

  function getTimeAgo(date) {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
    if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
    return Math.floor(seconds / 86400) + 'd ago';
  }

  function restoreFromHistory(entry) {
    lastJobData = entry.jobData || null;
    lastAnalysisData = entry;
    lastProposalText = entry.proposal || null;

    // Show JSON preview
    jsonViewEl.textContent = JSON.stringify(lastJobData, null, 2);
    jsonViewEl.classList.add('visible');

    // Restore verdict
    const verdictClass =
      entry.verdict === 'APPLY' ? 'apply' :
      entry.verdict === 'SKIP'  ? 'skip' : 'caution';

    setStatus(
      '<div class="verdict ' + verdictClass + '">' + entry.verdict + '</div>' +
      '<div class="score">Match Score: ' + (entry.matchScore || '') + '</div>' +
      '<div class="response">' + escapeHtml(entry.response || '') + '</div>',
      'success'
    );

    // Restore proposal
    if (lastProposalText && entry.verdict !== 'SKIP') {
      showProposal(lastProposalText);
    } else {
      hideProposal();
    }

    // Reset buttons
    extractBtn.textContent = '✓ Restored';
    extractBtn.style.borderColor = '#a0d911';
    extractBtn.style.color = '#a0d911';
    extractBtn.disabled = false;
    if (copyBtn) copyBtn.disabled = false;
    if (analyzeBtn) {
      analyzeBtn.textContent = '✓ Done';
      analyzeBtn.style.background = '#a0d911';
      analyzeBtn.disabled = true;
    }

    // Go back to main view
    showView('main');
  }

  function clearHistory() {
    if (!confirm('Clear all analysis history?')) return;
    storageSet(HISTORY_KEY, [], () => renderHistory());
  }

  // ── View navigation ────────────────────────────────────────────────────────
  function showView(view) {
    currentView = view;
    if (view === 'history') {
      mainViewEl.style.display = 'none';
      historyPanelEl.style.display = 'block';
      renderHistory();
    } else {
      mainViewEl.style.display = 'block';
      historyPanelEl.style.display = 'none';
    }
  }

  // ── Profile ───────────────────────────────────────────────────────────────
  function loadProfile() {
    storageGet(PROFILE_KEY, (data) => {
      userProfile = data || '';
      if (profileTextarea) profileTextarea.value = userProfile;
    });
  }

  function saveProfile() {
    userProfile = (profileTextarea?.value || '').trim();
    storageSet(PROFILE_KEY, userProfile, () => {
      if (profileSavedEl) {
        profileSavedEl.textContent = '✓ Saved';
        profileSavedEl.style.color = '#a0d911';
        setTimeout(() => {
          if (profileSavedEl) {
            profileSavedEl.textContent = '';
            profileSavedEl.style.color = '';
          }
        }, 2000);
      }
    });
  }

  // ── Event listeners ────────────────────────────────────────────────────────
  profileToggleBtn?.addEventListener('click', () => {
    profilePanelEl?.classList.toggle('hidden');
  });
  profileSaveBtn?.addEventListener('click', saveProfile);

  historyToggleBtn?.addEventListener('click', () => showView('history'));
  backToMainBtn?.addEventListener('click', () => showView('main'));
  historyClearBtn?.addEventListener('click', clearHistory);

  proposalToggleEl?.addEventListener('click', (e) => {
    if (e.target === proposalCheckbox) return;
    proposalCheckbox.checked = !proposalCheckbox.checked;
    proposalCheckbox.dispatchEvent(new Event('change'));
  });
  proposalCheckbox?.addEventListener('change', () => {
    proposalToggleEl?.classList.toggle('active', proposalCheckbox.checked);
  });

  proposalSectionEl?.querySelector('.proposal-header').addEventListener('click', (e) => {
    if (e.target === proposalCopyBtn || e.target.closest('#proposal-copy-btn')) return;
    proposalCollapsed = !proposalCollapsed;
    if (proposalBodyEl) proposalBodyEl.style.display = proposalCollapsed ? 'none' : 'block';
    if (proposalChevronEl) proposalChevronEl.style.transform = proposalCollapsed ? 'rotate(-90deg)' : '';
  });

  let copyTimeout = null;
  proposalCopyBtn?.addEventListener('click', async () => {
    if (!lastProposalText) return;
    try {
      await navigator.clipboard.writeText(lastProposalText);
      proposalCopyBtn.textContent = '✓ Copied';
      proposalCopyBtn.classList.add('copied');
      clearTimeout(copyTimeout);
      copyTimeout = setTimeout(() => {
        proposalCopyBtn.textContent = 'Copy';
        proposalCopyBtn.classList.remove('copied');
      }, 1800);
    } catch {
      setStatus('Failed to copy proposal.', 'error');
    }
  });

  // ── Load job data from content script ─────────────────────────────────────
  async function loadJobData() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.__upworkJobData,
    });
    return results[0]?.result || null;
  }

  function setStatus(html, cls) {
    if (!statusEl) return;
    statusEl.className = 'status ' + cls;
    statusEl.innerHTML = html;
  }

  // ── Extract button ────────────────────────────────────────────────────────
  extractBtn?.addEventListener('click', async () => {
    extractBtn.disabled = true;
    extractBtn.textContent = 'Extracting...';
    setStatus('<span class="spinner"></span>Extracting job data...', 'loading');

    try {
      lastJobData = await loadJobData();
      if (!lastJobData) {
        setStatus('No job data found.\n\nMake sure you are on an Upwork job details page.', 'error');
        extractBtn.disabled = false;
        extractBtn.textContent = 'Get Details';
        if (copyBtn) copyBtn.disabled = true;
        return;
      }

      jsonViewEl.textContent = JSON.stringify(lastJobData, null, 2);
      jsonViewEl.classList.add('visible');
      hideProposal();

      // Reset analyze button
      analyzeBtn.textContent = 'Analyze';
      analyzeBtn.style.background = '';
      analyzeBtn.disabled = false;
      lastAnalysisData = null;

      extractBtn.textContent = '✓ Extracted';
      extractBtn.style.borderColor = '#a0d911';
      extractBtn.style.color = '#a0d911';
      if (copyBtn) copyBtn.disabled = false;

      const title = lastJobData.title || 'Unknown Job';
      const skills = lastJobData.skills?.length
        ? lastJobData.skills.slice(0, 3).join(', ') +
          (lastJobData.skills.length > 3 ? '...' : '')
        : '';
      setStatus(
        '"' + title + '"\n' +
        (skills ? '\nSkills: ' + skills + '\n' : '') +
        'Click "Analyze" to get the analysis.',
        'idle'
      );
    } catch (err) {
      setStatus('Error: ' + err.message, 'error');
      extractBtn.disabled = false;
      extractBtn.textContent = 'Get Details';
    }
  });

  // ── Analyze button ────────────────────────────────────────────────────────
  analyzeBtn?.addEventListener('click', async () => {
    if (!lastJobData) {
      setStatus('Extract the job details first.', 'error');
      return;
    }

    const generateProposal = proposalCheckbox?.checked || false;
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = 'Analyzing...';
    setStatus(
      '<span class="spinner"></span>' +
      (generateProposal ? 'Analyzing & generating proposal...' : 'Analyzing job...'),
      'loading'
    );
    hideProposal();

    try {
      const endpoint = generateProposal ? CHECKLIST_URL : ANALYZE_URL;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job: lastJobData,
          profile: userProfile || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Server error ' + res.status);
      }

      const remaining = res.headers.get('X-RateLimit-Remaining');
      const limitMsg = remaining && parseInt(remaining) <= 3
        ? '\n⚠️ Rate limit low (' + remaining + ' left)'
        : '';

      const verdict = (data.verdict || 'APPLY WITH CAUTION')
        .toUpperCase().replace(/\s+/g, ' ');

      let proposalText = '';
      if (generateProposal && data.proposal) {
        proposalText = data.proposal
          .replace(/\*{0,2}FLAG LINE\*{0,2}[\s\S]*/i, '')
          .trim();
      }

      const verdictClass =
        verdict === 'APPLY' ? 'apply' :
        verdict === 'SKIP'  ? 'skip' : 'caution';

      const greeting = data.userName && data.userName !== 'there'
        ? 'Hi ' + data.userName + ', '
        : '';

      analyzeBtn.textContent = '✓ Done';
      analyzeBtn.style.background = '#a0d911';
      analyzeBtn.disabled = true;
      if (extractBtn) extractBtn.disabled = true;

      setStatus(
        '<div class="verdict ' + verdictClass + '">' +
        greeting + verdict +
        '</div>' +
        '<div class="score">Match Score: ' + (data.matchScore || '') + limitMsg + '</div>' +
        '<div class="response">' +
        escapeHtml(
          (data.response || '')
            .replace(/CUSTOMIZED PROPOSAL[\s\S]*$/i, '')
            .trim()
        ) +
        '</div>',
        'success'
      );

      if (proposalText && verdict !== 'SKIP') {
        showProposal(proposalText);
      }

      // ── Save to history ─────────────────────────────────────────────────
      lastAnalysisData = {
        analyzedAt: new Date().toISOString(),
        jobUrl:    lastJobData.url || '',
        jobTitle:  lastJobData.title || 'Untitled',
        skills:    lastJobData.skills || [],
        verdict,
        matchScore: data.matchScore || '',
        verdictClass,
        response:   (data.response || '').replace(/CUSTOMIZED PROPOSAL[\s\S]*$/i, '').trim(),
        proposal:   proposalText || null,
        jobData:    lastJobData,
      };
      saveToHistory(lastAnalysisData);

    } catch (err) {
      let msg = err.message;
      if (msg.includes('fetch') || msg.includes('localhost') || msg.includes('CORS')) {
        msg = 'Cannot reach the server. Make sure you\'re connected to the internet.';
      }
      setStatus('Error: ' + msg, 'error');
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = 'Analyze';
    }
  });

  // ── Copy JSON button ──────────────────────────────────────────────────────
  copyBtn?.addEventListener('click', async () => {
    if (!lastJobData) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(lastJobData, null, 2));
      copyBtn.textContent = '✓ Copied!';
      copyBtn.classList.add('copied');
      copyBtn.disabled = true;
      setTimeout(() => {
        copyBtn.textContent = 'Copy JSON';
        copyBtn.classList.remove('copied');
        copyBtn.disabled = false;
      }, 1800);
    } catch {
      setStatus('Failed to copy to clipboard.', 'error');
    }
  });

  // ── Proposal helpers ──────────────────────────────────────────────────────
  function hideProposal() {
    proposalSectionEl?.classList.remove('visible');
    if (proposalBodyEl) proposalBodyEl.innerHTML = '';
    lastProposalText = null;
    proposalCollapsed = false;
    if (proposalBodyEl) proposalBodyEl.style.display = 'block';
    if (proposalChevronEl) proposalChevronEl.style.transform = '';
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function renderProposalSection(text) {
    const sections = [];
    const regex = /\*{2}([A-Z][A-Z\s/]+)\*{2}/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      if (lastIndex < match.index) {
        const before = text.slice(lastIndex, match.index).trim();
        if (before) sections.push({ type: 'prose', content: before });
      }
      const title = match[1].trim();
      const start = match.index + match[0].length;
      const nextMatch = regex.exec(text);
      const end = nextMatch ? nextMatch.index : text.length;
      const content = text.slice(start, end).trim();
      sections.push({ type: title, content });
      regex.lastIndex = nextMatch ? regex.lastIndex - (text.length - end) : end;
      if (!nextMatch) break;
    }

    let html = '';
    const bidIdx = sections.findIndex((s) => s.type === 'BID RECOMMENDATION');
    if (bidIdx >= 0) {
      html += `<div class="bid-recommendation">
        <div class="label">Bid Recommendation</div>
        <div class="text">${escapeHtml(sections[bidIdx].content)}</div>
      </div>`;
    }

    for (const section of sections) {
      if (section.type === 'BID RECOMMENDATION' || section.type === 'prose') continue;
      const moveMatch = section.type.match(/^MOVE\s*(\d+)(?:\s*[—\-:]\s*(.+))?$/i);
      const label = moveMatch
        ? 'Move ' + moveMatch[1] + (moveMatch[2] ? ' — ' + moveMatch[2].trim() : '')
        : section.type.replace(/MOVE\s*/i, 'Move ');
      const isNote = /^(Note|NOTE|Warning|WARNING|Stretch:)/i.test(
        section.content.split('\n')[0]
      );
      if (isNote) {
        html += `<div class="proposal-note">${escapeHtml(section.content)}</div>`;
      } else {
        html += `<div class="proposal-move">
          <div class="proposal-move-title">${escapeHtml(label)}</div>
          <div class="proposal-move-body">${escapeHtml(section.content).replace(/\n/g, '<br>')}</div>
        </div>`;
      }
    }

    if (sections.length === 0) {
      html = `<div class="proposal-move"><div class="proposal-move-body">${escapeHtml(text)}</div></div>`;
    }
    return html;
  }

  function showProposal(proposalText) {
    lastProposalText = proposalText;
    if (proposalBodyEl) proposalBodyEl.innerHTML = renderProposalSection(proposalText);
    proposalSectionEl?.classList.add('visible');
    proposalCollapsed = false;
    if (proposalBodyEl) proposalBodyEl.style.display = 'block';
    if (proposalChevronEl) proposalChevronEl.style.transform = '';
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  function setApiStatusLight(ok) {
    if (!apiStatusLight) return;
    if (ok) {
      apiStatusLight.style.background = '#a0d911';
      apiStatusLight.title = 'API: Online';
    } else {
      apiStatusLight.style.background = '#ff6b6b';
      apiStatusLight.title = 'API: Offline — check your connection';
    }
  }

  async function checkApiHealth() {
    setApiStatusLight(null); // neutral/pending
    try {
      const res = await fetch(API_BASE + '/api/health', {
        signal: AbortSignal.timeout(5000),
      });
      setApiStatusLight(res.ok);
    } catch {
      setApiStatusLight(false);
    }
  }

  loadProfile();
  checkApiHealth();
})();
