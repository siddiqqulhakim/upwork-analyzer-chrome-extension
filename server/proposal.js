'use strict';

/**
 * Generates a customized Upwork proposal using the 5-move method
 * based on the user's profile and the job details.
 */

function buildProposalPrompt(job, profileContent) {
  return `You are an expert Upwork proposal writer for a data engineering / tech freelancer.

## Your task
Read the job post and the freelancer's profile below. Then produce:
1. A **Bid Recommendation** (2-3 sentences)
2. A **customized cover letter proposal** using the 5-move method (see below)

---

## Profile
${profileContent || '(no profile provided)'}

---

## Job Details
${JSON.stringify(job, null, 2)}

---

## 5-Move Proposal Method

**Move 1 — Credibility Line** (1 sentence, first thing)
Identity + years + niche specialization. Establish fit in one line.
Example: "I'm a Data Engineer with 5+ years specializing in Django dashboards and ETL pipelines."

**Move 2 — Curated Proof** (immediately after Move 1)
Place 2-4 portfolio links or work samples that match THIS job's niche. Matched proof beats impressive-but-unrelated proof. Do NOT list all portfolio items — only the ones directly relevant.

**Move 3 — Mirror the Brief** (short bullet list)
Restate the client's requirements as a short bullet list. Prove you read it carefully.
Example: "Based on your brief, you need someone who can combine: Django backend, data pipeline optimization, and production-grade UX/UI for dashboards."

**Move 4 — Phased Delivery Plan** (omit for invite-only or very short jobs)
A numbered 2-4 step delivery plan scoped to the job. Shows the client exactly what they'll get.
Example: "1. Audit existing dashboard and document bottlenecks, 2. Redesign panels and optimize queries, 3. Add new visualizations, 4. Polish, test, and hand over."

**Move 5 — Question Close** (1-2 specific questions)
End with a genuine clarifying question. Shows you care about getting it right.
Example: "Quick questions so I don't guess wrong: are you using BigQuery or PostgreSQL for the data layer? And is there an existing API we should integrate with?"

---

## Voice & Length Rules (hard — follow strictly)
- Maximum 250 words total for the proposal body
- Write like a person: short sentences, plain words, contractions OK
- Zero filler openers: no "I hope this finds you well", no "I'm excited"
- No em dashes
- Do NOT include contact info (Upwork policy)
- Do NOT invent outcomes or rates not in the profile
- If a key job requirement is NOT in the profile, flag it briefly in one line before the draft

---

## Output format
Produce your output using exactly this structure (keep the headers as shown):

---
**BID RECOMMENDATION**
[Your bid recommendation here — be specific: exact dollar amount, hourly or fixed, and 1-2 sentences of reasoning based on the job budget, competition, and client's profile]

---

**MOVE 1 — CREDIBILITY LINE**
[One sentence]

**MOVE 2 — CURATED PROOF**
[Portfolio links and brief context for each. Use markdown links: [Project Name](URL)]

**MOVE 3 — MIRROR THE BRIEF**
- [Bullet 1]
- [Bullet 2]
- [Bullet 3]

**MOVE 4 — DELIVERY PLAN**
1. [Step 1]
2. [Step 2]
3. [Step 3]

**MOVE 5 — QUESTION CLOSE**
[1-2 specific questions]

---
[Flag line if any job requirement is outside the profile scope — e.g. "Note: Python is not in your profile but the job requires it. Mention your willingness to learn or related experience here."]
---

Generate the proposal now.`;
}

async function generateProposal(job, profileContent, callClaude) {
  const prompt = buildProposalPrompt(job, profileContent);
  const raw = await callClaude(prompt, 1500);

  // Extract bid recommendation from the "BID RECOMMENDATION" section
  let bidRecommendation = '';
  const bidMatch = raw.match(/\*{2}BID RECOMMENDATION\*{2}\s*\n([\s\S]*?)(?=\*{2}MOVE 1|\*{2}MOVE\s|---)/i);
  if (bidMatch) {
    bidRecommendation = bidMatch[1].trim();
  } else {
    // Fallback: take everything before the first MOVE header
    const parts = raw.split(/\*{2}MOVE\s*\d/i);
    if (parts.length > 1) {
      bidRecommendation = parts[0].replace(/\*{2}BID RECOMMENDATION\*{2}/i, '').trim();
    }
  }

  return {
    bidRecommendation,
    proposalText: raw,
  };
}

module.exports = { generateProposal, buildProposalPrompt };
