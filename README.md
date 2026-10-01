# Upwork Job Analyzer — Chrome Extension

A Chrome Extension (Manifest V3) that extracts job details from Upwork and provides AI-powered analysis with bid recommendations and customizable cover letter generation.

---

## Architecture

```
┌──────────────────────────┐     ┌────────────────────────┐     ┌─────────────┐
│  Chrome Extension         │────▶│  Next.js API Routes   │────▶│ Claude API  │
│  (popup.js + content.js) │     │  (scoring + prompts)  │     │ (server-side│
│  Data: chrome.storage   │     │  Rate limiting         │     │  API key)   │
└──────────────────────────┘     └────────────────────────┘     └─────────────┘
```

```
upwork-analyzer-chrome-extension/
├── manifest.json             # Extension manifest (Manifest V3)
├── package.json              # Dev orchestration
├── icons/                    # Extension icons (16, 48, 128 px)
└── src/
    ├── content/
    │   └── content.js        # Runs on Upwork pages, extracts job data
    └── popup/
        ├── popup.html        # Extension popup UI (dark theme)
        └── popup.js          # Popup logic, API calls, history management
```

---

## Features

### Job Extraction
Automatically parses any Upwork job detail page and extracts:
- Title, posted time, location, experience level, project type
- Hourly rate range, fixed budget, Connects cost
- Required skills (up to all listed)
- Bid range (low / avg / high)
- Client info: rating, review count, total spent, hire rate, payment & phone verification
- Client recent job history: titles, pay type/amount, freelancer ratings, feedback, date ranges
- Proposal activity: number of proposals, time posted

### AI-Powered Analysis (`POST /api/analyze`)
Returns a verdict — `APPLY` / `SKIP` / `APPLY WITH CAUTION` — with:
- **Match score** (1–10) computed deterministically before the AI call
- **Red flag detection** — instant skips and soft flags
- **Client legitimacy assessment** — spend history, spend-per-hire, churn signals
- **Connects verdict** — whether the Connects cost is worth it
- **Proposal hook** — one specific differentiator to lead with
- **Actionable recommendation**

### Proposal Generation (`POST /api/checklist`)
In addition to full analysis, generates a complete cover letter using the five-move method:
1. **Credibility Line** — identity, years, niche specialization (shown in preview)
2. **Curated Proof** — 3–5 matched portfolio links
3. **Mirror the Brief** — restate requirements as bullet points
4. **Delivery Plan** — phased 2–4 step approach (skipped on quick replies)
5. **Question Close** — 2–3 specific clarifying questions

### Profile Customization
Paste your Upwork profile (or a text summary of your skills and rate range) via the **Edit Profile** panel. The scoring algorithm and proposal generator use your profile to:
- Compute rate alignment between your range and the job budget
- Detect skill overlap (50+ data engineering, cloud, BI, and web keywords supported)
- Tailor proposal language to your background

### Analysis History
Up to 100 analyzed jobs persist in `chrome.storage.local`. Click any history entry to restore the full analysis and generated proposal. Useful for revisiting decisions or comparing jobs.

---

## Installation

### From Source

```bash
# No build step required — pure Manifest V3, vanilla JS
# Navigate to chrome://extensions/
```

1. Open Chrome and go to `chrome://extensions/`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** and select the `upwork-analyzer-chrome-extension/` directory.
4. The extension icon appears in your toolbar.

### Build for Production / Web Store

```bash
zip -r upwork-job-analyzer.zip src/ icons/ manifest.json -x "*.git*"
```

---

## Setup

### 1. Deploy the Companion API Server

```bash
cd upwork-analyzer-server-api
cp .env.example .env.local   # add ANTHROPIC_API_KEY
npm install
npm run dev                   # local dev

# Deploy to Vercel (zero-config)
vercel deploy
```

See [upwork-analyzer-server-api/README.md](../upwork-analyzer-server-api/) for full deployment instructions.

### 2. Configure the API URL

In `src/popup/popup.js`, set `API_BASE` to your deployed server URL:

```javascript
const API_BASE = 'https://your-vercel-app.vercel.app'; // or http://localhost:3000 for local dev
```

### 3. Set Environment Variables (Server Side)

```env
# Required
ANTHROPIC_API_KEY=sk-ant-api03-...

# Optional
ANTHROPIC_BASE_URL=https://api.anthropic.com   # default
ANTHROPIC_MODEL=claude-sonnet-4-6              # default
```

---

## Usage

1. Open any Upwork job detail page (`https://www.upwork.com/jobs/~...`).
2. Click the **Upwork Job Analyzer** icon in your Chrome toolbar.
3. Click **Get Details** — the extension extracts all job and client data, shown as a JSON preview.
4. *(Optional)* Paste your profile via **Edit Profile** for tailored results.
5. *(Optional)* Enable **Write Proposal + Bid Recommendation** for a full cover letter.
6. Click **Analyze** — the verdict, score, flags, and recommendation appear within seconds.
7. Copy the generated proposal or raw JSON, then paste into Upwork.

### Profile Setup

1. Click **Edit Profile** in the popup header.
2. Paste your Upwork profile text or a summary: name, skills, and hourly rate range (e.g., `$20–$35/hr`).
3. Click **Save Profile**. Stored locally — persists across sessions.

---

## Permissions

| Permission | Reason |
|---|---|
| `activeTab` | Access the current tab to inject and read job data |
| `scripting` | Execute the content script on Upwork pages |
| `https://www.upwork.com/*` | Content script host match pattern |

---

## Local Storage Schema

All data is stored via `chrome.storage.local`:

| Key | Type | Description |
|---|---|---|
| `upworkAnalyzerProfile` | `string \| null` | Saved profile text |
| `upworkAnalyzerHistory` | `HistoryEntry[]` | Up to 100 past analyses |

```typescript
interface HistoryEntry {
  analyzedAt: string;        // ISO timestamp
  jobUrl: string;
  jobTitle: string;
  skills: string[];
  verdict: string;           // 'APPLY' | 'SKIP' | 'APPLY WITH CAUTION'
  matchScore: string;        // e.g. '7.5/10'
  response: string;          // AI analysis text
  proposal: string | null;   // Generated cover letter
  jobData: JobData;          // Full extracted job object (for restore)
}
```

---

## Rate Limits

The server API enforces per-IP rate limits:

| Endpoint | Limit |
|---|---|
| `POST /api/analyze` | 20 requests / minute |
| `POST /api/checklist` | 10 requests / minute |

The popup shows a warning when remaining quota drops below 3.

---

## Tech Stack

- **Manifest V3** Chrome Extension (no build step required)
- **Vanilla JavaScript** — no popup framework dependencies
- **Companion API** — Next.js 14 (standalone output), TypeScript
- **AI** — Claude API (API key held server-side; never exposed to the browser)
