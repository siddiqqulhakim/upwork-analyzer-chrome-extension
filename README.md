# Upwork Job Analyzer

A Chrome extension that extracts job details from Upwork and tells you whether each job is worth applying to — with AI-powered analysis and optional cover letter generation.

**Purpose:** Save time by quickly filtering out bad jobs and getting personalized recommendations before spending Connects.

---

## Features

### 1. Job Extraction
Reads any Upwork job page and pulls out all the important details automatically: job title, skills, budget, hourly rate, client info, hire rate, and more.

### 2. AI Job Analysis
Sends the job details to Claude AI and gets back:
- **Verdict** — APPLY, SKIP, or APPLY WITH CAUTION
- **Match Score** — 1–10 based on how well the job fits your skills
- **Red Flags** — checks for bad client patterns, low budget, scope creep signs
- **Recommendation** — what action to take and why

### 3. Proposal Generator
Generates a full cover letter (5-move method) ready to paste into Upwork. Includes a bid recommendation. Toggle on with the checkbox before clicking Analyze.

### 4. Profile Personalization
Paste your own profile (skills, rate, experience) so the analysis and proposals are tailored to you rather than generic.

### 5. Analysis History
Keeps track of your last 100 analyzed jobs so you can revisit past decisions or compare jobs.

### 6. API Status Light
The green/red dot in the header shows whether the AI server is reachable. Red means the server is down or you're offline.

---

## How to Use

### Installation
1. Open Chrome and go to `chrome://extensions/`
2. Turn on **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the `upwork-analyzer-chrome-extension/` folder
4. The extension icon appears in your toolbar


### Daily Workflow
1. Open a job on Upwork (`upwork.com/jobs/...`)
2. Click the **Upwork Job Analyzer** icon in Chrome toolbar
3. Click **Get Details** — job data appears as a JSON preview
4. *(Optional)* Click **Edit Profile** → paste your profile → click **Save Profile**
5. *(Optional)* Check **Write Proposal + Bid Recommendation** for a full cover letter
6. Click **Analyze** — verdict and score appear in seconds
7. Copy the proposal or JSON and paste into Upwork

### History
- Click **History** to see past analyses
- Click any entry to restore its full analysis
- Click **Clear All** to wipe history

---

## Feature Quick Reference

| Feature | How to Access |
|---|---|
| Extract job | Click **Get Details** on any Upwork job page |
| Analyze job | Click **Analyze** (after Get Details) |
| Generate proposal | Check **Write Proposal + Bid Recommendation**, then click **Analyze** |
| Save profile | Click **Edit Profile** → paste text → click **Save Profile** |
| View history | Click **History** in the header |
| Check API status | Look for the green/red dot in the header |
