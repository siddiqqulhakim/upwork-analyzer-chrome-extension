(function() {
  function text(el) {
    return el ? (el.textContent || el.innerText || '').trim() : null;
  }

  function q(sel, ctx) {
    return (ctx || document).querySelector(sel);
  }

  function qa(sel, ctx) {
    return Array.from((ctx || document).querySelectorAll(sel));
  }

  function parseRating(ratingEl) {
    if (!ratingEl) return null;
    const val = text(q('.air3-rating-value-text', ratingEl));
    const starWidth = q('.air3-rating-foreground', ratingEl);
    if (!val) return null;
    return parseFloat(val);
  }

  function parseMoney(el) {
    const t = text(el);
    if (!t) return null;
    const match = t.match(/[\d,]+(?:\.\d+)?/);
    return match ? parseFloat(match[0].replace(',', '')) : null;
  }

  function parseHours(t) {
    if (!t) return null;
    const m = t.match(/([\d,]+)/);
    return m ? parseInt(m[1].replace(',', '')) : null;
  }

  // --- Job Details Card ---
  const card = q('.job-details-card');
  const sections = qa('.air3-card-section', card);

  // Title
  const title = text(q('h4 .text-base.flex-1', card)) ||
                text(q('h4 span:first-child', card));

  // UID from URL or data attr
  const uid = location.pathname.match(/~([A-F0-9]+)/)?.[1] || null;
  const url = location.href;

  // Posted time
  const posted = text(q('.posted-on-line [data-v-63ce6a7b]', card)) ||
                 text(q('.posted-on-line', card));

  // Location
  const location2 = text(q('[data-cy="clock-hourly"]')?.closest('li')?.querySelector('p') ||
                         q('.air3-card-section .text-base-sm p'));

  // Connects cost & available connects
  // HTML: <div>Send a proposal for: <strong>13 Connects</strong></div>
  //       <div>Available Connects: <strong>115</strong></div>
  const connectsSection = q('.text-light-on-muted.text-body-sm.mt-5');
  let proposalConnects = null;
  let availableConnects = null;
  if (connectsSection) {
    const divs = qa('div', connectsSection);
    divs.forEach(div => {
      const t = text(div);
      if (t.includes('Send a proposal for')) {
        const m = t.match(/(\d+)/);
        if (m) proposalConnects = parseInt(m[1]);
      }
      if (t.includes('Available Connects')) {
        const m = t.match(/(\d+)/);
        if (m) availableConnects = parseInt(m[1]);
      }
    });
  }

  // Description
  const descEl = q('[data-test="Description"]', card);
  const summary = text(q('p', descEl));

  // Hourly rate range (inside [data-cy="clock-timelog"] section)
  const priceLi = q('[data-cy="clock-timelog"]')?.closest('li');
  const rateEls = qa('strong', priceLi || card);
  let hourlyRateLow = null, hourlyRateHigh = null;
  if (rateEls.length >= 2) {
    hourlyRateLow = parseMoney(rateEls[0]);
    hourlyRateHigh = parseMoney(rateEls[1]);
  }

  // Hours/week
  const hoursLi = q('[data-cy="clock-hourly"]')?.closest('li');
  const hoursPerWeek = text(hoursLi?.querySelector('strong'));

  // Duration
  const durationLi = q('[data-cy="duration1"]')?.closest('li');
  const duration = text(durationLi?.querySelector('strong'));

  // Experience level
  const expLi = q('[data-cy="expertise"]')?.closest('li');
  const experienceLevel = text(expLi?.querySelector('strong'));

  // Project type
  const projectType = text(q('.segmentations li strong + span', card));

  // Skills
  const skills = qa('.skills-list .air3-line-clamp', card).map(el => text(el)).filter(Boolean);

  // Activity on job
  const activityItems = qa('.client-activity-items .ca-item', card);
  const activity = {};
  activityItems.forEach(item => {
    const title = text(item.querySelector('.title'))?.replace(/:/g, '').trim();
    const value = text(item.querySelector('.value')) || text(item.querySelector('.value div'));
    if (title) activity[title] = value;
  });

  // Bid range
  const bidSection = q('h5 strong', card);
  const bidText = text(bidSection);
  let bidHigh = null, bidAvg = null, bidLow = null;
  if (bidText) {
    const high = bidText.match(/High \$?([\d,]+(?:\.\d+)?)/);
    const avg  = bidText.match(/Avg  \$?([\d,]+(?:\.\d+)?)/);
    const low  = bidText.match(/Low  \$?([\d,]+(?:\.\d+)?)/);
    if (high) bidHigh = parseFloat(high[1].replace(',', ''));
    if (avg)  bidAvg  = parseFloat(avg[1].replace(',', ''));
    if (low)  bidLow  = parseFloat(low[1].replace(',', ''));
  }

  // --- About the client ---
  const clientSection = q('[data-test="about-client-container"]');
  const clientRatingEl = q('.air3-rating', clientSection);
  const client = {
    paymentVerified: !!q('.payment-verified', clientSection),
    phoneVerified: !!q('.payment-verified.text-success', clientSection),
    rating: parseRating(clientRatingEl),
    reviewCount: (text(q('.nowrap.mt-1', clientSection)) || '').replace('of ', '').replace('reviews', '').trim() || null,
    location: null,
    jobsPosted: null,
    hireRate: null,
    totalSpent: null,
    hires: null,
    avgHourlyRate: null,
    memberSince: null,
  };

  // Parse client location
  const locLi = q('[data-qa="client-location"]', clientSection);
  if (locLi) {
    const parts = qa('span', locLi).map(s => text(s)).filter(Boolean);
    client.location = parts.join(', ');
  }

  // Jobs posted & hire rate
  const jobStatsLi = q('[data-qa="client-job-posting-stats"]', clientSection);
  if (jobStatsLi) {
    const parts = qa('strong, div', jobStatsLi).map(el => text(el)).filter(Boolean);
    client.jobsPosted = parts[0] || null;
    client.hireRate = parts.slice(1).join(', ') || null;
  }

  // Total spent
  const spendEl = q('[data-qa="client-spend"]', clientSection);
  if (spendEl) {
    const t = text(spendEl);
    const m = t.match(/\$?([\d,]+(?:\.\d+)?)/);
    client.totalSpent = m ? parseFloat(m[1].replace(',', '')) : null;
  }

  // Hires
  const hiresEl = q('[data-qa="client-hires"]', clientSection);
  client.hires = text(hiresEl);

  // Avg hourly rate
  const rateEl = q('[data-qa="client-hourly-rate"]', clientSection);
  if (rateEl) {
    const t = text(rateEl);
    const m = t.match(/\$?([\d,]+(?:\.\d+)?)/);
    client.avgHourlyRate = m ? parseFloat(m[1].replace(',', '')) : null;
  }

  // Hours
  const hoursEl = q('[data-qa="client-hours"]', clientSection);
  client.hoursWorked = text(hoursEl);

  // Member since
  const memberEl = q('[data-qa="client-contract-date"]', clientSection);
  client.memberSince = text(memberEl)?.replace('Member since', '').trim() || null;

  // --- Recent job history ---
  const recentJobs = qa('.extra-jobs-cards [data-cy="job"]').map(jobEl => ({
    title: text(q('[data-cy="job-title"]', jobEl)),
    freelancer: text(qa('a[href*="/freelancers/"]', jobEl).map(a => a.textContent.trim()).join(', ')),
    freelancerUrl: qa('a[href*="/freelancers/"]', jobEl).map(a => 'https://www.upwork.com' + a.getAttribute('href')).join(', '),
    rating: parseRating(q('.air3-rating', jobEl)),
    hours: text(q('[data-cy="stats"] strong', jobEl)),
    dates: text(q('[data-cy="date"]', jobEl)),
    pay: text(q('[data-cy="stats"]', jobEl)),
  }));

  // --- Assemble output ---
  const job = {
    uid,
    url,
    title,
    posted,
    location: location2,
    proposalConnects,
    availableConnects,
    summary,
    hourlyRate: hourlyRateLow && hourlyRateHigh ? { low: hourlyRateLow, high: hourlyRateHigh } : null,
    hoursPerWeek,
    duration,
    experienceLevel,
    projectType,
    skills,
    activity,
    bidRange: bidHigh || bidAvg || bidLow ? { high: bidHigh, avg: bidAvg, low: bidLow } : null,
    client,
    recentJobs,
  };

  // Pretty-print to console
  const json = JSON.stringify(job, null, 2);
  console.log(json);

  // Auto-copy to clipboard
  navigator.clipboard.writeText(json).then(() => {
    console.log('%c✔ Job data extracted and copied to clipboard!', 'color: green; font-weight: bold');
  }).catch(() => {
    console.log('%c⚠ Job data extracted (clipboard copy failed — run copy(JSON.stringify(window.lastJobData, null, 2)))', 'color: orange; font-weight: bold');
  });

  // Also make it available as window.lastJobData for re-use
  window.lastJobData = job;
})();
