const ANALYZE_URL = 'http://localhost:3000/analyze';
const CHECKLIST_URL = 'http://localhost:3000/checklist';
const PROPOSAL_URL = 'http://localhost:3000/proposal';
const PROFILES_URL = 'http://localhost:3000/profiles';
const STORAGE_KEY = 'selectedProfile';

const statusEl     = document.getElementById('status');
const jsonViewEl   = document.getElementById('json-view');
const extractBtn   = document.getElementById('extract-btn');
const copyBtn      = document.getElementById('copy-btn');
const analyzeBtn   = document.getElementById('analyze-btn');
const resultPathEl = document.getElementById('result-path');
const profileSelectEl = document.getElementById('profile-select');

const proposalToggleEl = document.getElementById('proposal-toggle');
const proposalCheckbox = document.getElementById('proposal-checkbox');
const proposalSectionEl = document.getElementById('proposal-section');
const proposalBodyEl = document.getElementById('proposal-body');
const proposalCopyBtn = document.getElementById('proposal-copy-btn');
const proposalChevronEl = document.getElementById('proposal-chevron');

// Hide icon if it fails to load
const headerIcon = document.getElementById('header-icon');
if (headerIcon) {
  headerIcon.addEventListener('error', () => {
    headerIcon.style.display = 'none';
  });
}

let lastJobData = null;
let lastProposalText = null;   // raw text from server
let proposalCollapsed = false;

// ─── Proposal toggle ─────────────────────────────────────────────────────────
proposalToggleEl.addEventListener('click', (e) => {
  // Don't toggle if clicking the checkbox itself (it handles its own change)
  if (e.target === proposalCheckbox) return;
  proposalCheckbox.checked = !proposalCheckbox.checked;
  proposalCheckbox.dispatchEvent(new Event('change'));
});

proposalCheckbox.addEventListener('change', () => {
  if (proposalCheckbox.checked) {
    proposalToggleEl.classList.add('active');
  } else {
    proposalToggleEl.classList.remove('active');
  }
});

// Collapse / expand proposal panel
proposalSectionEl.querySelector('.proposal-header').addEventListener('click', (e) => {
  if (e.target === proposalCopyBtn || e.target.closest('#proposal-copy-btn')) return;
  proposalCollapsed = !proposalCollapsed;
  proposalBodyEl.style.display = proposalCollapsed ? 'none' : 'block';
  proposalChevronEl.style.transform = proposalCollapsed ? 'rotate(-90deg)' : '';
});

// Copy proposal text
let proposalCopyTimeout = null;
proposalCopyBtn.addEventListener('click', async () => {
  if (!lastProposalText) return;
  try {
    await navigator.clipboard.writeText(lastProposalText);
    proposalCopyBtn.textContent = '✓ Copied';
    proposalCopyBtn.classList.add('copied');
    clearTimeout(proposalCopyTimeout);
    proposalCopyTimeout = setTimeout(() => {
      proposalCopyBtn.textContent = 'Copy';
      proposalCopyBtn.classList.remove('copied');
    }, 1800);
  } catch {
    setStatus('Failed to copy proposal.', 'error');
  }
});

// ─── Load profiles from server into dropdown ──────────────────────────────────
async function loadProfiles() {
  try {
    const res = await fetch(PROFILES_URL);
    if (!res.ok) throw new Error('Failed to load profiles');
    const data = await res.json();
    const profiles = data.profiles || [];

    profileSelectEl.innerHTML = '';
    profiles.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.filename;
      opt.textContent = p.name || p.filename;
      profileSelectEl.appendChild(opt);
    });

    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && profiles.some(p => p.filename === saved)) {
      profileSelectEl.value = saved;
    }
  } catch (err) {
    profileSelectEl.innerHTML = '<option>(server not running)</option>';
  }
}

profileSelectEl.addEventListener('change', () => {
  localStorage.setItem(STORAGE_KEY, profileSelectEl.value);
});

loadProfiles();

// ─── Load job data from content script ───────────────────────────────────────
async function loadJobData() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => window.__upworkJobData,
  });
  return results[0]?.result || null;
}

function setStatus(html, cls) {
  statusEl.className = 'status ' + cls;
  statusEl.innerHTML = html;
}

// ─── Extract button ───────────────────────────────────────────────────────────
extractBtn.addEventListener('click', async () => {
  extractBtn.disabled = true;
  extractBtn.textContent = 'Extracting...';
  setStatus('<span class="spinner"></span>Extracting job data...', 'loading');

  try {
    lastJobData = await loadJobData();
    if (!lastJobData) {
      setStatus('No job data found.\n\nMake sure you are on an Upwork job details page.', 'error');
      extractBtn.disabled = false;
      extractBtn.textContent = 'Get Details';
      copyBtn.disabled = true;
      return;
    }

    // Show JSON preview
    jsonViewEl.textContent = JSON.stringify(lastJobData, null, 2);
    jsonViewEl.classList.add('visible');

    // Reset proposal state
    hideProposal();

    extractBtn.textContent = '✓ Extracted';
    extractBtn.style.borderColor = '#a0d911';
    extractBtn.style.color = '#a0d911';
    copyBtn.disabled = false;
    analyzeBtn.disabled = false;

    const title = lastJobData.title || 'Unknown Job';
    const skills = lastJobData.skills?.length
      ? lastJobData.skills.slice(0, 3).join(', ') + (lastJobData.skills.length > 3 ? '...' : '')
      : '';
    setStatus(
      `"${title}"\n${skills ? '\nSkills: ' + skills + '\n' : ''}Click "Analyze & Save" to run Claude and save to JSON.`,
      'idle'
    );

  } catch (err) {
    setStatus('Error: ' + err.message, 'error');
    extractBtn.disabled = false;
    extractBtn.textContent = 'Get Details';
  }
});

// ─── Analyze button ───────────────────────────────────────────────────────────
analyzeBtn.addEventListener('click', async () => {
  if (!lastJobData) {
    setStatus('Extract the job details first.', 'error');
    return;
  }

  const selectedProfile = profileSelectEl.value;
  const generateProposal = proposalCheckbox.checked;

  analyzeBtn.disabled = true;
  analyzeBtn.textContent = 'Analyzing...';
  setStatus('<span class="spinner"></span>Analyzing with Claude...', 'loading');
  hideProposal();

  try {
    let analyzeData;
    let response = '';
    let verdict = 'caution';
    let verdictText = 'APPLY WITH CAUTION';
    let score = '';

    if (generateProposal) {
      // Use combined /checklist endpoint for proposal generation
      setStatus('<span class="spinner"></span>Analyzing & generating proposal...', 'loading');
      const checklistRes = await fetch(CHECKLIST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...lastJobData, profileFile: selectedProfile }),
      });
      analyzeData = await checklistRes.json();

      if (!checklistRes.ok) {
        throw new Error(analyzeData.error || 'Server error ' + checklistRes.status);
      }

      const fullResponse = analyzeData.response || '';
      // Extract proposal BEFORE stripping for display
      const proposalSection = fullResponse.match(/CUSTOMIZED PROPOSAL[\s\S]*$/i)?.[0] || '';

      // Strip proposal section from status display to avoid duplication
      response = fullResponse.replace(/CUSTOMIZED PROPOSAL[\s\S]*$/i, '').trim();
      score = analyzeData.matchScore ? 'Match Score: ' + analyzeData.matchScore : '';

      // Use precomputed verdict/score from server — do NOT re-parse from LLM response
      const parsedVerdict = (analyzeData.verdict || 'APPLY WITH CAUTION').toUpperCase().replace(/\s+/g, ' ');

      if (parsedVerdict === 'SKIP') {
        verdict = 'skip';
        verdictText = 'SKIP';
        // Don't show proposal for SKIP even if checkbox was checked
      } else if (parsedVerdict === 'APPLY') {
        verdict = 'apply';
        verdictText = 'APPLY';
      } else {
        verdictText = parsedVerdict;
      }

      // Show proposal if NOT SKIP
      if (parsedVerdict !== 'SKIP' && proposalSection) {
        showProposalFromResponse(proposalSection);
      }

    } else {
      // Use standard /analyze endpoint (no proposal)
      const analyzeRes = await fetch(ANALYZE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...lastJobData, profileFile: selectedProfile }),
      });

      analyzeData = await analyzeRes.json();

      if (!analyzeRes.ok) {
        throw new Error(analyzeData.error || 'Server error ' + analyzeRes.status);
      }

      response = analyzeData.response || '';
      // Strip proposal section from status display to avoid duplication
      response = response.replace(/CUSTOMIZED PROPOSAL[\s\S]*$/i, '').trim();
      score = analyzeData.matchScore ? 'Match Score: ' + analyzeData.matchScore : '';

      // Use precomputed verdict from server — do NOT re-parse from LLM response
      const parsedVerdict = (analyzeData.verdict || 'APPLY WITH CAUTION').toUpperCase().replace(/\s+/g, ' ');

      if (parsedVerdict === 'SKIP') {
        verdict = 'skip';
        verdictText = 'SKIP';
      } else if (parsedVerdict === 'APPLY') {
        verdict = 'apply';
        verdictText = 'APPLY';
      } else {
        verdictText = parsedVerdict;
      }
    }

    // ── Render results ──
    const greeting = analyzeData.userName && analyzeData.userName !== 'there'
      ? 'Hi ' + analyzeData.userName + ', '
      : '';

    analyzeBtn.textContent = '✓ Saved';
    analyzeBtn.style.background = '#a0d911';
    analyzeBtn.disabled = true;
    extractBtn.disabled = true;
    resultPathEl.textContent = 'Saved to: ' + (analyzeData.dataPath || 'upwork-jobs.json');

    setStatus(
      '<div class="verdict ' + verdict + '">' + greeting + verdictText + '</div>' +
      (score ? '<div class="score">' + score + '</div>' : '') +
      '<div class="response">' + response.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>',
      'success'
    );

  } catch (err) {
    let msg = err.message;
    if (msg.includes('fetch') && msg.includes('localhost')) {
      msg = 'Server not running. Run npm run server first.';
    }
    setStatus('Error: ' + msg, 'error');
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = 'Analyze & Save';
  }
});

// ─── Copy JSON button ──────────────────────────────────────────────────────────
copyBtn.addEventListener('click', async () => {
  if (!lastJobData) return;
  try {
    const json = JSON.stringify(lastJobData, null, 2);
    await navigator.clipboard.writeText(json);
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

// ─── Proposal display helpers ─────────────────────────────────────────────────
function hideProposal() {
  proposalSectionEl.classList.remove('visible');
  proposalBodyEl.innerHTML = '';
  lastProposalText = null;
  proposalCollapsed = false;
  proposalBodyEl.style.display = 'block';
  if (proposalChevronEl) proposalChevronEl.style.transform = '';
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderProposalSection(text) {
  // Split the raw proposal text into sections by the **HEADER** pattern
  const sections = [];
  const regex = /\*{2}([A-Z][A-Z\s/]+)\*{2}/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (lastIndex < match.index) {
      // Text before this header — attach to previous section or as intro
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

  // Bid recommendation (before the move sections)
  const bidIdx = sections.findIndex(s => s.type === 'BID RECOMMENDATION');
  if (bidIdx >= 0) {
    html += `<div class="bid-recommendation">
      <div class="label">Bid Recommendation</div>
      <div class="text">${escapeHtml(sections[bidIdx].content)}</div>
    </div>`;
  }

  // Move sections
  for (const section of sections) {
    if (section.type === 'BID RECOMMENDATION') continue;
    if (section.type === 'prose') continue;

    // Normalize "MOVE 1", "MOVE 1 — CREDIBILITY LINE" etc.
    const moveMatch = section.type.match(/^MOVE\s*(\d+)(?:\s*[—\-:]\s*(.+))?$/i);
    const label = moveMatch
      ? `Move ${moveMatch[1]}${moveMatch[2] ? ' — ' + moveMatch[2].trim() : ''}`
      : section.type.replace(/MOVE\s*/i, 'Move ');

    // Detect note/warning lines
    const isNote = /^(Note|NOTE|Warning|WARNING|Stretch:)/i.test(section.content.split('\n')[0]);
    if (isNote) {
      html += `<div class="proposal-note">${escapeHtml(section.content)}</div>`;
    } else {
      html += `<div class="proposal-move">
        <div class="proposal-move-title">${escapeHtml(label)}</div>
        <div class="proposal-move-body">${escapeHtml(section.content).replace(/\n/g, '<br>')}</div>
      </div>`;
    }
  }

  // If no sections parsed, show raw text
  if (sections.length === 0) {
    html = `<div class="proposal-move"><div class="proposal-move-body">${escapeHtml(text)}</div></div>`;
  }

  return html;
}

function showProposal(result) {
  const proposalText = result.proposalText || '';
  lastProposalText = proposalText;

  // Inject bid recommendation + parsed moves
  proposalBodyEl.innerHTML = renderProposalSection(proposalText);

  proposalSectionEl.classList.add('visible');
  proposalCollapsed = false;
  proposalBodyEl.style.display = 'block';
  if (proposalChevronEl) proposalChevronEl.style.transform = '';
}

function showProposalFromResponse(proposalSection) {
  // proposalSection is already extracted - just clean it up
  const proposalText = proposalSection
    .replace(/CUSTOMIZED PROPOSAL[\s]*/i, '')
    .replace(/\*{0,2}FLAG LINE\*{0,2}[\s\S]*/i, '')
    .trim();

  if (!proposalText) return;

  lastProposalText = proposalText;
  proposalBodyEl.innerHTML = renderProposalSection(proposalText);

  proposalSectionEl.classList.add('visible');
  proposalCollapsed = false;
  proposalBodyEl.style.display = 'block';
  if (proposalChevronEl) proposalChevronEl.style.transform = '';
}
