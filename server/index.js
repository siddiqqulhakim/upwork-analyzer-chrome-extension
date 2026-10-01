const http = require('http');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { generateProposal } = require('./proposal');

// ─── Config paths ───────────────────────────────────────────────────────────
const PROFILE_DIR = path.join(__dirname, '..', 'assets', 'profile');
const PROMPT_QUALIFIER = path.join(__dirname, '..', 'assets', 'analysis-prompts', 'job-qualifier.md');
const PROMPT_CHECKLIST = path.join(__dirname, '..', 'assets', 'analysis-prompts', 'proposal-checklist.md');
const DATA_PATH = path.join(__dirname, '..', 'data', 'upwork-jobs.json');
const PORT = 3000;

// ─── Load config ───────────────────────────────────────────────────────────
let apiToken = null;
let baseUrl = 'https://gateway.olagon.site/anthropic';

try {
  const home = process.env.HOME || process.env.USERPROFILE;
  const settingsPath = path.join(home, '.claude', 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  apiToken = settings.env?.ANTHROPIC_AUTH_TOKEN || settings.env?.ANTHROPIC_API_KEY || null;
  if (settings.env?.ANTHROPIC_BASE_URL) {
    baseUrl = settings.env.ANTHROPIC_BASE_URL.replace(/\/$/, '');
  }
} catch (err) {
  console.error('Failed to load settings.json:', err.message);
  process.exit(1);
}

if (!apiToken) {
  console.error('ANTHROPIC_AUTH_TOKEN not found in settings.json');
  process.exit(1);
}

// ─── Anthropic client via gateway ─────────────────────────────────────────────
const client = new Anthropic({ apiKey: apiToken, baseURL: baseUrl });

// ─── Profile helpers ──────────────────────────────────────────────────────────
function listProfiles() {
  if (!fs.existsSync(PROFILE_DIR)) return [];
  return fs.readdirSync(PROFILE_DIR)
    .filter(f => f.toLowerCase().endsWith('.md'))
    .map(filename => ({
      filename,
      name: extractProfileName(path.join(PROFILE_DIR, filename)),
    }));
}

function loadProfile(filename) {
  const safe = path.basename(filename); // prevent path traversal
  const fullPath = path.join(PROFILE_DIR, safe);
  if (!fullPath.startsWith(PROFILE_DIR)) return null;
  try {
    return fs.readFileSync(fullPath, 'utf8');
  } catch {
    return null;
  }
}

function extractProfileName(profilePath) {
  try {
    const content = fs.readFileSync(profilePath, 'utf8');
    const m = content.match(/\*\*Name\*\*\s*[:：]\s*(.+?)(?:\n|$)/i);
    if (m) return m[1].trim();
    return path.basename(profilePath, '.md');
  } catch {
    return path.basename(profilePath, '.md');
  }
}

let qualifierTemplate = '';
let checklistTemplate = '';
try {
  qualifierTemplate = fs.readFileSync(PROMPT_QUALIFIER, 'utf8');
  checklistTemplate = fs.readFileSync(PROMPT_CHECKLIST, 'utf8');
} catch (err) {
  console.error('Could not read prompt files:', err.message);
  process.exit(1);
}

// ─── Extract skills and rate from profile markdown ─────────────────────────────
/**
 * Parse a profile markdown file and extract:
 * - A flat list of skill keywords (lowercased)
 * - Target hourly rate range (floor and ceiling)
 */
function extractProfileFacts(profileContent) {
  if (!profileContent) return null;

  // Extract hourly rate from "Target Hourly Rate: $X - $Y"
  const rateMatch = profileContent.match(/\$?(\d+)\s*[-–]\s*\$?(\d+)/i);
  const userRateFloor = rateMatch ? parseInt(rateMatch[1]) : null;
  const userRateCeiling = rateMatch ? parseInt(rateMatch[2]) : null;

  // Collect all skill keywords from the profile text
  const skillKeywords = [
    // Data engineering
    'python', 'pyspark', 'pandas', 'sql', 'postgresql', 'mysql', 'ms sql server',
    'bigquery', 'airflow', 'dbt', 'airbyte', 'talend', 'ssis', 'azure data factory',
    'spark', 'hadoop', 'datahub', 'data governance', 'elt', 'etl', 'data warehouse',
    // Cloud / DevOps
    'gcp', 'google cloud', 'alibaba cloud', 'kubernetes', 'helm', 'argo cd',
    'github actions', 'grafana', 'docker', 'ci/cd',
    // BI / dashboards
    'apache superset', 'superset', 'power bi', 'looker studio', 'data studio',
    'streamlit', 'tableau', 'dashboard', 'data visualization',
    // Web
    'php', 'laravel', 'codeigniter', 'javascript', 'selenium', 'web scraping',
    'rest api', 'graphql', 'hasura', 'api',
    // Other
    'excel', 'google sheets', 'automation', 'scraping',
  ];

  const lower = profileContent.toLowerCase();
  const found = skillKeywords.filter(s => lower.includes(s));
  return { userRateFloor, userRateCeiling, skills: found };
}

// ─── Deterministic job scoring ──────────────────────────────────────────────
/**
 * Compute a deterministic match score, verdict, and red flags from raw job data.
 * profileContent is optional — when provided, skill matching and rate alignment
 * are tailored to the actual freelancer profile.
 */
function computeScore(job, profileContent) {
  const score = { value: 5, flags: [], reasons: [] };

  const client = job.client || {};
  const hourlyRate = job.hourly_rate || {};
  const rateLow = hourlyRate.low || 0;
  const rateHigh = hourlyRate.high || 0;
  const totalSpent = client.totalSpent || 0;
  const hires = parseInt(client.hires) || 0;
  const jobsPosted = client.jobsPosted || 0;
  const spendPerHire = hires > 0 ? totalSpent / hires : Infinity;
  const avgPaidRate = client.avgHourlyRate || 0;
  const proposals = job.activity?.Proposals || null;
  // Only treat as high competition if we have a concrete number (not "50+", not null)
  const proposalsCount = proposals && !/\+/.test(proposals) ? parseInt(proposals, 10) || 0 : null;
  const paymentVerified = client.paymentVerified;
  const rating = client.rating || 0;

  // ── Extract profile facts (skill list and rate range) ──
  const profile = extractProfileFacts(profileContent);
  const userRateFloor = profile?.userRateFloor ?? 15;
  const userRateCeiling = profile?.userRateCeiling ?? 30;
  const profileSkills = profile?.skills ?? [];

  // ── INSTANT SKIPS (return early) ──
  if (!paymentVerified && totalSpent === 0) {
    return { value: 1, verdict: 'SKIP', flags: ['Payment unverified with no spend history — highest risk.'], reasons: ['No payment verification AND no spend history = instant skip per policy.'] };
  }
  if (job.summary && /\bpay[_\s]?to|registration\s*fee|buy\s+credits|outside\s*upwork/i.test(job.summary)) {
    return { value: 1, verdict: 'SKIP', flags: ['Payment or fee outside Upwork requested.'], reasons: ['Request to pay a fee or move payment off-platform = instant skip.'] };
  }

  // ── SOFT FLAGS ──
  if (!paymentVerified && totalSpent > 0) {
    score.flags.push('⚠️ Payment NOT verified (but $' + totalSpent.toLocaleString() + ' actual spend exists — UI sync issue likely)');
    score.value -= 1;
  }
  if (spendPerHire < 100) {
    score.flags.push('Low spend-per-hire ($' + Math.round(spendPerHire) + ') — client hires cheaply');
    score.value -= 1;
  }
  if (avgPaidRate > 0 && rateLow > 0 && avgPaidRate < rateLow * 0.7) {
    score.flags.push('Rate mismatch: client paid avg $' + avgPaidRate + '/hr vs job range $' + rateLow + '-$' + rateHigh + '/hr');
    score.value -= 1.5;
  }
  if (proposalsCount !== null && proposalsCount > 40) {
    score.flags.push(proposalsCount + ' proposals already (posted recently) — high competition');
    score.value -= 0.5;
  }
  if (hires > 10 && jobsPosted > 0 && hires / jobsPosted > 0.5) {
    score.flags.push('High churn: ' + hires + ' hires / ' + jobsPosted + ' jobs posted — client cycles through freelancers');
    score.value -= 0.5;
  }

  // ── POSITIVE SIGNALS ──
  if (paymentVerified) { score.value += 1; }
  if (totalSpent > 5000) { score.value += 0.5; }
  if (rating >= 4.8) { score.value += 0.5; }
  if (job.skills && job.skills.length >= 4) { score.value += 0.5; }

  // ── SKILL MATCH (tailored to profile) ──
  const requiredSkills = (job.skills || []).map(s => s.toLowerCase());
  const jobTitle = (job.title || '').toLowerCase();
  const summary = (job.summary || '').toLowerCase();

  // Count how many of the job's required skills appear in the profile
  const matchedProfileSkills = requiredSkills.filter(
    s => profileSkills.some(ps => ps.includes(s) || s.includes(ps))
  );

  // Also check if job title/summary mentions profile skills
  const titleSummaryMatches = profileSkills.filter(
    ps => jobTitle.includes(ps) || summary.includes(ps)
  );

  const totalMatches = matchedProfileSkills.length + titleSummaryMatches.length;

  if (totalMatches >= 4) { score.value += 1.5; }
  else if (totalMatches >= 2) { score.value += 0.5; }
  else if (totalMatches === 1) { /* no change */ }
  else { score.value -= 1; } // weak/no skill match

  // ── RATE ALIGNMENT ──
  if (rateLow <= userRateCeiling && rateHigh >= userRateFloor) {
    score.value += 1;
  }

  // ── DETERMINISTIC VERDICT ──
  const finalScore = Math.max(1, Math.min(10, Math.round(score.value * 10) / 10));
  let verdict = 'APPLY WITH CAUTION';
  if (finalScore <= 3) verdict = 'SKIP';
  else if (finalScore >= 7) verdict = 'APPLY';

  // ── RED FLAG SUMMARY ──
  const redFlags = score.flags.length > 0
    ? score.flags.join('\n')
    : 'None';

  // ── CLIENT ASSESSMENT (deterministic) ──
  const clientAssessment = hires > 0
    ? `Active client with ${hires} hires, ${rating}★ rating — ${totalSpent > 0 ? '$' + totalSpent.toLocaleString() + ' total spent' : 'no recorded spend'}. ` +
      (spendPerHire < 200 ? 'Low spend-per-hire ($' + Math.round(spendPerHire) + ') suggests transactional pattern.' : 'Healthy spend pattern.')
    : 'New or low-activity client. Verify payment before committing.';

  // ── RECOMMENDATION (deterministic) ──
  const rec = verdict === 'SKIP'
    ? 'Do not apply. The risk signals outweigh potential gains.'
    : verdict === 'APPLY'
    ? 'Strong match — apply confidently. Rate alignment and skill overlap are solid.'
    : 'Apply with care. Anchor your rate at the budget floor (' + (rateLow > 0 ? '$' + rateLow : '$' + userRateFloor) + '/hr) and emphasize relevant portfolio work.';

  // ── PROPOSAL HOOK (dynamic from matched skills) ──
  const allMatched = [...new Set([...matchedProfileSkills, ...titleSummaryMatches])];
  const topMatches = allMatched.slice(0, 5);
  const proposalHook = topMatches.length >= 2
    ? 'Lead with your ' + topMatches.join(' + ') + ' experience. Mention specific tools, years of hands-on use, and a concrete result from past work.'
    : topMatches.length === 1
    ? 'Lead with your ' + topMatches[0] + ' experience. Tie it directly to what the client is asking for.'
    : 'Emphasize your strongest relevant skill from your profile and show a matched sample or portfolio link.';

  return {
    value: finalScore,
    verdict,
    flags: score.flags,
    red_flags: redFlags,
    client_assessment: clientAssessment,
    recommendation: rec,
    proposal_hook: proposalHook,
    connects_verdict: finalScore >= 6 ? 'Worth it — the job matches your profile and could convert to ongoing work.' :
                      finalScore >= 4 ? 'Caution — the risk signals are real but not disqualifying. Spend Connects selectively.' :
                      'Not worth it — too many red flags for the Connects cost.',
  };
}

// ─── Format job data as structured markdown for LLM input ─────────────────────
/**
 * Converts raw job data into a clean, labeled markdown block.
 * Only includes fields relevant to job qualification and proposal writing.
 * This cuts token noise significantly vs raw JSON while preserving all signal.
 */
function formatJobAsMarkdown(job) {
  const c = job.client || {};
  const hr = job.hourly_rate || {};
  const rate = job.hourlyRate || {};
  const act = job.activity || {};

  const lines = [];

  lines.push('## Job Title');
  lines.push(job.title || '(no title)');

  lines.push('');
  lines.push('## Original Post');
  lines.push(job.summary || '(no description)');

  lines.push('');
  lines.push('## Client');
  lines.push('Name: ' + (c.name || c.clientName || 'Unknown'));
  lines.push('Location: ' + (job.location || 'Not specified'));
  lines.push('Payment Verified: ' + (c.paymentVerified ? 'Yes' : 'No'));
  lines.push('Total Spent: ' + (c.totalSpent || c.total_spent ? '$' + (c.totalSpent || c.total_spent).toLocaleString() : 'None recorded'));
  lines.push('Jobs Posted: ' + (c.jobsPosted || c.jobs_posted || 0));
  lines.push('Hires: ' + (parseInt(c.hires) || 0));
  lines.push('Member Since: ' + (c.memberSince || c.member_since || 'Unknown'));
  lines.push('Rating: ' + (c.rating ? c.rating + '★' : 'No rating'));
  lines.push('Avg Hourly Rate Paid: ' + (c.avgHourlyRate || c.avg_hourly_rate ? '$' + (c.avgHourlyRate || c.avg_hourly_rate) + '/hr' : 'Not available'));

  lines.push('');
  lines.push('## Budget');
  lines.push('Type: ' + (job.projectType || job.budgetType || 'Not specified'));
  lines.push('Hourly Range: ' + (hr.low || rate.low ? '$' + (hr.low || rate.low) + ' – $' + (hr.high || rate.high) + '/hr' : 'Not specified'));
  lines.push('Fixed Budget: ' + (job.fixedPrice || job.budget ? '$' + (job.fixedPrice || job.budget).toLocaleString() : 'Not specified'));
  lines.push('Est. Hours/Week: ' + (job.hoursPerWeek || 'Not specified'));
  lines.push('Duration: ' + (job.duration || 'Not specified'));

  lines.push('');
  lines.push('## Required Skills');
  if (job.skills && job.skills.length > 0) {
    lines.push(job.skills.join(', '));
  } else {
    lines.push('None specified');
  }

  lines.push('');
  lines.push('## Experience Level');
  lines.push(job.experience_level || job.experienceLevel || 'Not specified');

  lines.push('');
  lines.push('## Job Activity');
  lines.push('Posted: ' + (job.posted || 'Unknown'));
  lines.push('Proposals: ' + (act.proposals || act.Proposals || 'Unknown'));
  lines.push('Connects Cost: ' + (job.proposalConnects ? job.proposalConnects + ' Connects' : 'Not specified'));

  if (job.recentJobs && job.recentJobs.length > 0) {
    lines.push('');
    lines.push('## Client Recent Jobs');
    for (const rj of job.recentJobs.slice(0, 5)) {
      const title = rj.title || rj.jobTitle || 'Untitled';
      const spent = rj.totalSpent || rj.spent || '';
      const status = rj.status || '';
      lines.push('- ' + title + (spent ? ' ($' + spent + ')' : '') + (status ? ' [' + status + ']' : ''));
    }
  }

  return lines.join('\n');
}

// ─── Build the analysis prompt ───────────────────────────────────────────────
function buildQualifierPrompt(job, profileContent, precomputed) {
  const scoringSection = precomputed
    ? `\n## PRE-COMPUTED SCORE (do not override — use these values)\n` +
      `Determined Score: **${precomputed.value}/10**\n` +
      `Determined Verdict: **${precomputed.verdict}**\n` +
      `Red Flags: ${precomputed.red_flags}\n` +
      `Client Assessment: ${precomputed.client_assessment}\n` +
      `Connects Verdict: ${precomputed.connects_verdict}\n` +
      `Proposal Hook: ${precomputed.proposal_hook}\n` +
      `Recommendation: ${precomputed.recommendation}\n\n` +
      `Your role: write the response using these values as grounding. Do NOT re-score or contradict the pre-computed verdict.\n`
    : '';
  return scoringSection + qualifierTemplate
    .replace('{{PROFILE}}', profileContent || '(profile not found)')
    .replace('{{JOB}}', formatJobAsMarkdown(job));
}

function buildChecklistPrompt(job, profileContent, precomputed) {
  const scoringSection = precomputed
    ? `\n## PRE-COMPUTED SCORE (do not override — use these values)\n` +
      `Determined Score: **${precomputed.value}/10**\n` +
      `Determined Verdict: **${precomputed.verdict}**\n` +
      `Red Flags: ${precomputed.red_flags}\n` +
      `Client Assessment: ${precomputed.client_assessment}\n` +
      `Connects Verdict: ${precomputed.connects_verdict}\n` +
      `Proposal Hook: ${precomputed.proposal_hook}\n` +
      `Recommendation: ${precomputed.recommendation}\n\n` +
      `Your role: write the proposal (if verdict is APPLY or APPLY WITH CAUTION) using these values as grounding. Do NOT re-score or contradict the pre-computed verdict.\n`
    : '';
  return scoringSection + checklistTemplate
    .replace('{{PROFILE}}', profileContent || '(profile not found)')
    .replace('{{JOB}}', formatJobAsMarkdown(job));
}

// ─── Call Claude via SDK ───────────────────────────────────────────────────────
async function callClaude(prompt, maxTokens = 1024) {
  const msg = await client.messages.create({
    model: 'databyte-m1',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
  const textBlock = (msg.content || []).find(b => b.type === 'text');
  return (textBlock?.text || '').trim();
}

// ─── Parse analysis text ─────────────────────────────────────────────────────
function parseAnalysis(text) {
  const result = {};
  const lines = text.split('\n');
  const clean = (s) => s.replace(/\*\*/g, '').replace(/\*+/g, '').replace(/#{1,3}\s*/g, '').trim();

  const sectionDefs = [
    ['red_flags',          ['RED FLAGS', 'RED FLAG']],
    ['client_assessment',  ['CLIENT ASSESSMENT', 'CLIENT ANALYSIS', 'CLIENT']],
    ['connects_verdict',   ['CONNECTS VERDICT', 'CONNECTS']],
    ['proposal_hook',      ['PROPOSAL HOOK', 'HOOK']],
    ['recommendation',     ['RECOMMENDATION', 'RECOMMEND']],
  ];

  const headerLines = new Map();
  for (let i = 0; i < lines.length; i++) {
    const stripped = clean(lines[i]);
    if (!stripped) continue;
    for (const [key, names] of sectionDefs) {
      if (headerLines.has(key)) continue;
      for (const name of names) {
        if (stripped.startsWith(name)) {
          headerLines.set(key, { idx: i, name });
          break;
        }
      }
    }
  }

  const keys = sectionDefs.map(([k]) => k);
  for (let k = 0; k < keys.length; k++) {
    const key = keys[k];
    if (!headerLines.has(key)) continue;
    const { idx: startIdx, name } = headerLines.get(key);
    const endIdx = k + 1 < keys.length && headerLines.has(keys[k + 1])
      ? headerLines.get(keys[k + 1]).idx
      : lines.length;

    const headerLine = clean(lines[startIdx]);
    const nameIdx = headerLine.indexOf(name);
    const remainingOnHeaderLine = nameIdx >= 0
      ? headerLine.slice(nameIdx + name.length).replace(/^[\s:-]+/, '').trim()
      : '';

    const contentLines = [];
    for (let j = startIdx + 1; j < endIdx; j++) {
      const next = clean(lines[j]);
      if (!next) continue;
      contentLines.push(next);
    }

    const combined = [remainingOnHeaderLine, ...contentLines].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    if (combined) result[key] = combined;
  }

  for (const line of lines) {
    const m = clean(line).match(/VERDICT[\s:\-—–]*(APPLY(?:\s+WITH\s+CAUTION)?|SKIP)/i);
    if (m) { result.verdict = m[1].toUpperCase().replace(/\s+/g, ' '); break; }
  }

  for (const line of lines) {
    const s = clean(line);
    const m = s.match(/MATCH SCORE[\s:-]*(\d+)\/?10?/i) || s.match(/SCORE[\s:-]*(\d+)\/?10?/i);
    if (m) { result.match_score = m[1]; break; }
  }

  return result;
}

// ─── Parse checklist response (includes proposal) ─────────────────────────────
function parseChecklistResponse(text) {
  const result = {};

  // Extract verdict - look for VERDICT followed by APPLY/SKIP
  const verdictMatch = text.match(/VERDICT[\s:—–-]*[\[\]]?\s*(APPLY(?:\s+WITH\s+CAUTION)?|SKIP)/i);
  if (verdictMatch) {
    result.verdict = verdictMatch[1].toUpperCase().replace(/\s+/g, ' ');
  } else {
    // Fallback: find any APPLY or SKIP in text
    const fallbackMatch = text.match(/\b(APPLY(?:\s+WITH\s+CAUTION)?|SKIP)\b/i);
    if (fallbackMatch) {
      result.verdict = fallbackMatch[1].toUpperCase().replace(/\s+/g, ' ');
    }
  }

  // Extract match score
  const scoreMatch = text.match(/MATCH SCORE[\s:-]*(\d+)/i);
  if (scoreMatch) result.match_score = scoreMatch[1];

  // Extract proposal section (between CUSTOMIZED PROPOSAL and end or FLAG LINE)
  const proposalMatch = text.match(/\*{0,2}CUSTOMIZED PROPOSAL\*{0,2}[\s\S]*?(?=\*{0,2}FLAG LINE|---[\s-]*$|$)/i);
  if (proposalMatch) {
    result.proposal = proposalMatch[0].replace(/\*{0,2}CUSTOMIZED PROPOSAL\*{0,2}/i, '').trim();
  }

  // Extract individual fields from the BID RECOMMENDATION section
  const clean = (s) => s.replace(/\*\*/g, '').replace(/\*+/g, '').replace(/#{1,3}\s*/g, '').trim();

  // Find the BID RECOMMENDATION section boundaries
  const bidSectionMatch = text.match(/BID RECOMMENDATION[\s\S]*?(?=CUSTOMIZED PROPOSAL|FLAG LINE|---[\s]*$|$)/i);
  if (bidSectionMatch) {
    const bidSection = bidSectionMatch[0];
    const bidLines = bidSection.split('\n');

    for (const line of bidLines) {
      const s = clean(line);

      // Red flags
      if (s.match(/RED FLAGS?[\s:]/i)) {
        const val = s.replace(/RED FLAGS?[\s:]*/i, '').trim();
        if (val) result.red_flags = val;
      }

      // Client assessment
      if (s.match(/CLIENT ASSESSMENT[\s:]/i)) {
        const val = s.replace(/CLIENT ASSESSMENT[\s:]*/i, '').trim();
        if (val) result.client_assessment = val;
      }

      // Connects verdict
      if (s.match(/CONNECTS VERDICT[\s:]/i) || s.match(/CONNECTS[\s:]/i)) {
        const val = s.replace(/CONNECTS VERDICT[\s:]*/i, '').replace(/CONNECTS[\s:]*/i, '').trim();
        if (val) result.connects_verdict = val;
      }

      // Proposal hook
      if (s.match(/PROPOSAL HOOK[\s:]/i) || s.match(/HOOK[\s:]/i)) {
        const val = s.replace(/PROPOSAL HOOK[\s:]*/i, '').replace(/HOOK[\s:]*/i, '').trim();
        if (val) result.proposal_hook = val;
      }

      // Recommendation
      if (s.match(/RECOMMENDATION[\s:]/i) || s.match(/RECOMMEND[\s:]/i)) {
        const val = s.replace(/RECOMMENDATION[\s:]*/i, '').replace(/RECOMMEND[\s:]*/i, '').trim();
        if (val) result.recommendation = val;
      }
    }
  }

  // If red_flags still empty, try to find it anywhere
  if (!result.red_flags) {
    const rfMatch = text.match(/RED FLAGS[\s:]*[\[\]]?(.+?)(?=CLIENT|MATCH|CONNECTS|PROPOSAL|RECOMMEND|---)/is);
    if (rfMatch) result.red_flags = rfMatch[1].trim();
  }

  return result;
}

// ─── JSON data helpers ────────────────────────────────────────────────────────
function readJobs() {
  if (!fs.existsSync(DATA_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')); }
  catch { return []; }
}

function saveJob(entry) {
  const jobs = readJobs();
  // Always append to keep historical consistency
  jobs.push(entry);

  // Ensure data dir exists
  const dir = path.dirname(DATA_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(jobs, null, 2));
}

// ─── HTTP server ─────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/proposal') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      res.setHeader('Content-Type', 'application/json');
      try {
        const { job, profileFile } = JSON.parse(body);

        if (!job) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Job data is required' }));
          return;
        }

        const profileContent = profileFile ? loadProfile(profileFile) : null;
        if (profileFile && !profileContent) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Profile not found: ' + profileFile }));
          return;
        }

        const userName = extractUserName(profileContent);

        console.log('[' + new Date().toISOString() + '] Generating proposal for: "' + job.title + '"');

        const result = await generateProposal(job, profileContent, callClaude);

        console.log('[' + new Date().toISOString() + '] Proposal generated for: "' + job.title + '"');

        res.writeHead(200);
        res.end(JSON.stringify({
          success: true,
          userName,
          ...result,
        }));
      } catch (err) {
        console.error('Proposal error:', err.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/analyze') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      res.setHeader('Content-Type', 'application/json');
      try {
        const job = JSON.parse(body);
        const profileFile = job.profileFile;
        const profileContent = profileFile ? loadProfile(profileFile) : null;
        if (profileFile && !profileContent) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Profile not found: ' + profileFile }));
          return;
        }

        const m = profileContent ? profileContent.match(/\*\*Name\*\*\s*[:：]\s*(.+?)(?:\n|$)/i) : null;
        const userName = m ? m[1].trim() : 'there';

        console.log('[' + new Date().toISOString() + '] Analyzing: "' + job.title + '" (profile: ' + (profileFile || 'default') + ')');
        const precomputed = computeScore(job, profileContent);
        const prompt = buildQualifierPrompt(job, profileContent, precomputed);
        const response = await callClaude(prompt);
        const analysis = parseAnalysis(response);

        const entry = {
          analyzed_at: new Date().toISOString(),
          uid: job.uid || '',
          url: job.url || '',
          title: job.title || '',
          posted: job.posted || '',
          location: job.location || '',
          proposal_connects: job.proposalConnects ?? null,
          available_connects: job.availableConnects ?? null,
          summary: job.summary || '',
          hourly_rate: job.hourlyRate || null,
          hours_per_week: job.hoursPerWeek || '',
          duration: job.duration || '',
          experience_level: job.experienceLevel || '',
          project_type: job.projectType || '',
          skills: job.skills || [],
          activity: job.activity || {},
          bid_range: job.bidRange || null,
          client: job.client || {},
          recent_jobs: job.recentJobs || [],
        };

        // Only add analysis fields if they have values
        const hasAnalysis = analysis.verdict || analysis.match_score || analysis.red_flags ||
          analysis.client_assessment || analysis.connects_verdict ||
          analysis.proposal_hook || analysis.recommendation || response;

        if (hasAnalysis) {
          entry.analysis = {
            // Precomputed values are authoritative — LLM is used only for the raw text
            verdict: precomputed.verdict,
            match_score: precomputed.value + '/10',
            red_flags: precomputed.red_flags,
            client_assessment: precomputed.client_assessment,
            connects_verdict: precomputed.connects_verdict,
            proposal_hook: precomputed.proposal_hook,
            recommendation: precomputed.recommendation,
            raw_response: response,
          };
        }

        saveJob(entry);
        console.log('[' + new Date().toISOString() + '] Saved to JSON: "' + job.title + '"');

        res.writeHead(200);
        res.end(JSON.stringify({
          success: true,
          userName,
          verdict: precomputed.verdict,
          matchScore: precomputed.value + '/10',
          response,
          dataPath: DATA_PATH,
        }));
      } catch (err) {
        console.error('Analysis error:', err.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // ─── Combined Checklist: Job Qualification + Proposal ─────────────────────
  if (req.method === 'POST' && req.url === '/checklist') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      res.setHeader('Content-Type', 'application/json');
      try {
        const job = JSON.parse(body);
        const profileFile = job.profileFile;
        const profileContent = profileFile ? loadProfile(profileFile) : null;
        if (profileFile && !profileContent) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Profile not found: ' + profileFile }));
          return;
        }

        const m = profileContent ? profileContent.match(/\*\*Name\*\*\s*[:：]\s*(.+?)(?:\n|$)/i) : null;
        const userName = m ? m[1].trim() : 'there';

        console.log('[' + new Date().toISOString() + '] Checklist (qualify + propose): "' + job.title + '"');
        const precomputed = computeScore(job, profileContent);
        const prompt = buildChecklistPrompt(job, profileContent, precomputed);
        const response = await callClaude(prompt, 2000);
        const analysis = parseChecklistResponse(response);

        const entry = {
          analyzed_at: new Date().toISOString(),
          uid: job.uid || '',
          url: job.url || '',
          title: job.title || '',
          posted: job.posted || '',
          location: job.location || '',
          proposal_connects: job.proposalConnects ?? null,
          available_connects: job.availableConnects ?? null,
          summary: job.summary || '',
          hourly_rate: job.hourlyRate || null,
          hours_per_week: job.hoursPerWeek || '',
          duration: job.duration || '',
          experience_level: job.experienceLevel || '',
          project_type: job.projectType || '',
          skills: job.skills || [],
          activity: job.activity || {},
          bid_range: job.bidRange || null,
          client: job.client || {},
          recent_jobs: job.recentJobs || [],
        };

        if (analysis.verdict || analysis.match_score || analysis.red_flags ||
          analysis.client_assessment || analysis.connects_verdict ||
          analysis.proposal_hook || analysis.recommendation || analysis.proposal) {
          entry.analysis = {
            // Precomputed values are authoritative — LLM is used only for the proposal draft + raw text
            verdict: precomputed.verdict,
            match_score: precomputed.value + '/10',
            red_flags: precomputed.red_flags,
            client_assessment: precomputed.client_assessment,
            connects_verdict: precomputed.connects_verdict,
            proposal_hook: precomputed.proposal_hook,
            recommendation: precomputed.recommendation,
            proposal: analysis.proposal || '',
            raw_response: response,
          };
        }

        saveJob(entry);
        console.log('[' + new Date().toISOString() + '] Checklist saved: "' + job.title + '"');

        res.writeHead(200);
        res.end(JSON.stringify({
          success: true,
          userName,
          verdict: precomputed.verdict,
          matchScore: precomputed.value + '/10',
          hasProposal: !!analysis.proposal,
          response,
          dataPath: DATA_PATH,
        }));
      } catch (err) {
        console.error('Checklist error:', err.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/profiles') {
    res.writeHead(200);
    res.end(JSON.stringify({ profiles: listProfiles() }));
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, profiles: listProfiles().length }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

function extractUserName(profileContent) {
  if (!profileContent) return 'there';
  // Match patterns like:
  // - **Name**: Muhammad Ilham Siddiqqulhakim
  // - **Name**: Muhammad Ilham Siddiqqulhakim
  // - Name: Muhammad Ilham Siddiqqulhakim
  const m = profileContent.match(/[-*]?\s*\*\*Name\*\*\s*[:：]\s*(.+?)(?:\n|$)/i)
    || profileContent.match(/^Name\s*[:：]\s*(.+?)(?:\n|$)/im);
  return m ? m[1].trim() : 'there';
}

server.listen(PORT, () => {
  const profiles = listProfiles();
  console.log('Upwork Job Analyzer server running at http://localhost:' + PORT);
  console.log('Profiles loaded: ' + profiles.length + ' (' + profiles.map(p => p.filename).join(', ') + ')');
  console.log('Prompts: job-qualifier.md + proposal-checklist.md');
  console.log('Endpoints: /analyze (qualify) | /checklist (qualify + propose) | /proposal');
  console.log('Data file: ' + DATA_PATH);
});
