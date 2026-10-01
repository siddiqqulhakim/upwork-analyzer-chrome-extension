# Upwork Job Analyzer

A Chrome Extension + local server that extracts job details from Upwork, scores them deterministically, and generates AI-powered (Claude) proposals — helping freelancers apply smarter and write better cover letters.

## What It Does

- **Extract** job details from any Upwork job posting (title, budget, client info, skills, bid range, etc.)
- **Score** jobs with a deterministic algorithm before calling the LLM — giving consistent verdicts (Apply / Apply with Caution / Skip)
- **Analyze** with Claude: red flags, client assessment, Connects verdict, recommendation
- **Generate proposals** using a customizable freelancer profile, including bid recommendations and a structured cover letter in the 5-move method

## Prerequisites & Requirements

### Required

- **Chrome** (or Chromium-based browser: Edge, Brave, Arc, etc.)
- **Node.js** v18 or higher
- **Anthropic API key** (set in `~/.claude/settings.json` — see [Configuration](#configuration))

### API Key Setup

1. Create or open `~/.claude/settings.json`
2. Add your key:

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "sk-ant-..."
  }
}
```

Optionally, point to a custom gateway:

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "sk-ant-...",
    "ANTHROPIC_BASE_URL": "https://gateway.olagon.site/anthropic"
  }
}
```

## Installation

### 1. Clone the repo

```bash
git clone <repo-url>
cd upwork-chrome-extension
```

### 2. Install dependencies

```bash
npm install
```

### 3. Add your freelancer profile

Create a markdown file in `assets/profile/`. The filename becomes the profile selector label:

```markdown
**Name**: Your Name

Your bio, skills, experience summary...
```

See `assets/profile/ilham.md` for a complete example.

### 4. Load the extension in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the project root folder (the one containing `manifest.json`)

### 5. Start the server

```bash
npm run server
```

You should see:

```
Upwork Job Analyzer server running at http://localhost:3000
Profiles loaded: 1 (your-profile.md)
```

## Usage / Quick Start

1. Open Upwork and navigate to any job posting (e.g. `https://www.upwork.com/jobs/...`)
2. Click the extension icon in Chrome's toolbar
3. Select your **freelancer profile** from the dropdown
4. Optionally check **"Write Proposal + Bid Recommendation"** to generate a full cover letter
5. Click **Get Details** — the extension extracts job data from the page
6. Click **Analyze & Save** — the server scores the job and returns a verdict:

| Verdict | Meaning |
|---|---|
| **APPLY** | Strong match — go ahead |
| **APPLY WITH CAUTION** | Proceed carefully, anchor your rate, emphasize portfolio |
| **SKIP** | Red flags detected — don't spend Connects here |

Results are saved to `data/upwork-jobs.json` for your records.

## Project Structure

```
upwork-chrome-extension/
├── manifest.json            # Chrome extension manifest (v3)
├── package.json             # Server dependencies
├── server/
│   └── index.js             # Local API server (Node.js)
│   └── proposal.js          # Proposal generation logic
├── src/
│   ├── popup/
│   │   ├── popup.html       # Extension popup UI
│   │   └── popup.js         # Popup logic, API calls
│   └── content/
│       └── content.js       # Injected into Upwork pages to extract job data
├── assets/
│   ├── profile/             # Freelancer profile markdown files
│   └── analysis-prompts/    # Claude prompt templates
│       ├── job-qualifier.md
│       └── proposal-checklist.md
├── scripts/
│   ├── extract-upwork-job.js
│   └── generate-icons.js
├── icons/                   # Extension icons (16, 48, 128 px)
└── data/
    └── upwork-jobs.json     # Analyzed jobs (auto-created)
```

## API Endpoints

The server runs on `http://localhost:3000`:

| Endpoint | Method | Description |
|---|---|---|
| `/analyze` | POST | Score + analyze a job (no proposal) |
| `/checklist` | POST | Full analysis + proposal generation |
| `/proposal` | POST | Generate proposal only |
| `/profiles` | GET | List available profile files |
| `/health` | GET | Server health check |

## Available Scripts

```bash
npm run server      # Start the API server
npm run icons       # Regenerate extension icons
npm run start       # Run icons then start server
npm run test        # Instructions for testing the extension
```
