(function () {
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
    return val ? parseFloat(val) : null;
  }

  function parseMoney(el) {
    const t = text(el);
    if (!t) return null;
    const match = t.match(/\$?\s*([\d,]+(?:\.\d+)?)\s*([KkMm])?/);
    if (!match) return null;
    const num = parseFloat(match[1].replace(/,/g, ''));
    const suffix = (match[2] || '').toUpperCase();
    if (suffix === 'K') return num * 1000;
    if (suffix === 'M') return num * 1_000_000;
    return num;
  }

  // Extract job fields
  function extractJob() {
    const card = q('.job-details-card');
    if (!card) return null;

    // UID from URL (e.g. /jobs/~022092641804983723917)
    const uid = location.pathname.match(/~([A-F0-9]+)/)?.[1] || null;
    const url = location.href;

    // Title — first span inside h4
    const title = text(q('h4 span:first-child', card));

    // Posted time
    const posted = text(q('.posted-on-line .text-body-sm span', card))
      || text(q('.posted-on-line', card));

    // Location — look for the location p with tabindex="0"
    const locationEl = q('.d-inline-flex p[tabindex="0"]', card)
      || q('p[tabindex="0"].text-light-on-muted', card);
    const locationText = text(locationEl);

    // Connects cost & available connects
    // Lives in the sidebar, not the main card:
    // <div class="text-light-on-muted text-body-sm mt-4">
    //   <div>Send a proposal for: <strong>26 Connects</strong></div>
    //   <div class="mt-2">Available Connects: <strong>115</strong></div>
    // </div>
    const connectsSidebar = q('.sidebar', card);
    let proposalConnects = null;
    let availableConnects = null;
    if (connectsSidebar) {
      const t = text(connectsSidebar);
      const propMatch = t.match(/proposal for:\s*(\d+)\s*Connects/i);
      if (propMatch) proposalConnects = parseInt(propMatch[1]);
      const availMatch = t.match(/Available Connects:\s*(\d+)/i);
      if (availMatch) availableConnects = parseInt(availMatch[1]);
    }

    // Description / Summary
    const descEl = q('[data-test="Description"]', card);
    const summary = text(q('p', descEl));

    // Hourly rate range — strong elements inside the price li
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

    // Duration — Upwork uses data-cy="duration1".."durationN" depending on length
    const durationLi = q('[data-cy^="duration"]')?.closest('li');
    let duration = null;
    if (durationLi) {
      // Prefer the desktop (longer) span; fall back to any visible
      const longSpan = q('.d-none.d-lg-inline', durationLi);
      const shortSpan = q('.d-lg-none', durationLi);
      duration = text(longSpan) || text(shortSpan) || text(durationLi.querySelector('strong'));
    }

    // Experience level
    const expLi = q('[data-cy="expertise"]')?.closest('li');
    const experienceLevel = text(expLi?.querySelector('strong'));

    // Project type
    const projectType = text(q('.segmentations li strong + span', card));

    // Contract-to-hire indicator — appears as a card section with "Contract-to-hire opportunity" heading
    const contractToHire = !!q('.air3-card-section h4', card) &&
      Array.from(qa('h4', card)).some(h => h.textContent.includes('Contract-to-hire'));

    // Skills
    const skills = qa('.skills-list .air3-line-clamp', card).map(el => text(el)).filter(Boolean);

    // Activity on job — values can be ranges ("5 to 10") or relative time
    // NOTE: "50+" means 50 or more but the exact number is hidden by Upwork.
    // Only capture concrete numbers (not "50+") for programmatic use.
    const activity = {};
    qa('.client-activity-items .ca-item', card).forEach(item => {
      const t = text(item.querySelector('.title'))?.replace(/:/g, '').trim();
      const v = text(item.querySelector('.value')) || text(item.querySelector('.value div'));
      if (!t) return;
      // Store "50+" as null — Upwork hides the real count above 50, so it's not useful for scoring
      const numeric = v && !/\+/.test(v) ? v : null;
      activity[t] = numeric;
    });

    // Bid range — scope to its own section to avoid matching other h5+strong
    const bidSection = q('h5 > strong', card);
    const bidText = text(bidSection);
    let bidHigh = null, bidAvg = null, bidLow = null;
    if (bidText && /Bid range/.test(bidText)) {
      const high = bidText.match(/High\s*\$?([\d,]+(?:\.\d+)?)/);
      const avg = bidText.match(/Avg\s*\$?([\d,]+(?:\.\d+)?)/);
      const low = bidText.match(/Low\s*\$?([\d,]+(?:\.\d+)?)/);
      if (high) bidHigh = parseFloat(high[1].replace(',', ''));
      if (avg) bidAvg = parseFloat(avg[1].replace(',', ''));
      if (low) bidLow = parseFloat(low[1].replace(',', ''));
    }

    // About the client
    const clientSection = q('[data-test="about-client-container"]');
    const clientRatingEl = q('.air3-rating', clientSection);
    const locLi = q('[data-qa="client-location"]', clientSection);
    const jobStatsLi = q('[data-qa="client-job-posting-stats"]', clientSection);
    const spendEl = q('[data-qa="client-spend"]', clientSection);
    const rateEl = q('[data-qa="client-hourly-rate"]', clientSection);
    const hoursEl = q('[data-qa="client-hours"]', clientSection);
    const memberEl = q('[data-qa="client-contract-date"]', clientSection);

    // Review count: "4.60 of 75 reviews" -> 75
    let reviewCount = null;
    const reviewText = text(q('.nowrap.mt-1', clientSection));
    if (reviewText) {
      const m = reviewText.match(/of\s+([\d,]+)/i);
      if (m) reviewCount = parseInt(m[1].replace(/,/g, ''));
    }

    // jobsPosted: "338 jobs posted"
    let jobsPosted = null;
    let hireRate = null;
    if (jobStatsLi) {
      const strongText = text(q('strong', jobStatsLi));
      const divText = text(q('div', jobStatsLi));
      const m = strongText?.match(/(\d+)/);
      if (m) jobsPosted = parseInt(m[1]);
      hireRate = divText;
    }

    const client = {
      paymentVerified: !!q('.payment-verified', clientSection),
      // phoneVerified — green checkmark (text-success) on the payment icon in the sidebar;
      // falls back to same element since Upwork shows one verified badge for both payment + phone
      phoneVerified: !!q('.payment-verified.text-success', clientSection),
      rating: parseRating(clientRatingEl),
      reviewCount,
      location: locLi ? qa('strong, span.nowrap', locLi).map(s => text(s)).filter(Boolean).join(', ') : null,
      jobsPosted,
      hireRate,
      totalSpent: parseMoney(spendEl),
      hires: text(q('[data-qa="client-hires"]', clientSection)),
      avgHourlyRate: parseMoney(rateEl),
      hoursWorked: text(hoursEl),
      memberSince: text(memberEl)?.replace(/Member since/i, '').trim() || null,
    };

    // Recent job history
    // Each [data-cy="job"] item contains:
    //   [data-cy="job-title"]     — job title (may be an <a> link)
    //   .air3-rating              — freelancer's rating for this job
    //   a[href*="/freelancers/"]  — freelancer link(s)
    //   .air3-truncation          — freelancer feedback (if any)
    //   [data-cy="date"]          — wrapper: div:first-child = date range, [data-cy="stats"] = pay
    //     <div class="text-body-sm">Feb 2026 - <span>Sep 2026</span></div>
    //     <div data-cy="stats">
    //       <span><strong>10 hrs <span>@ $22.00/hr</span></strong><span> Billed: $242.00</span></span>  (hourly)
    //       <span>Fixed-price <span>$800.00</span></span>                                               (fixed)
    //     </div>
    const recentJobs = qa('.extra-jobs-cards [data-cy="job"]').map(jobEl => {
      const dateWrap = q('[data-cy="date"]', jobEl);
      const statsEl = q('[data-cy="stats"]', jobEl);

      // Pay type + amount — separate spans for fixed vs hourly
      let payType = null, payAmount = null, billed = null;
      if (statsEl) {
        const span = statsEl.querySelector('span');
        const t = text(span);
        if (t.startsWith('Fixed-price')) {
          payType = 'Fixed-price';
          const m = t.match(/Fixed-price\s*\$?([\d,]+(?:\.\d+)?)/);
          if (m) payAmount = parseFloat(m[1].replace(',', ''));
        } else {
          // hourly — extract "10 hrs @ $22.00/hr"
          const m = t.match(/([\d,]+(?:\.\d+)?)\s*hrs?\s*@\s*\$?([\d,]+(?:\.\d+)?)/i);
          if (m) {
            payType = 'Hourly';
            payAmount = parseFloat(m[2].replace(',', ''));
          }
        }
        // Billed amount is in a nested span: "Billed: $242.00"
        const billedSpan = statsEl.querySelector('span > span');
        if (billedSpan && billedSpan.textContent.includes('Billed:')) {
          const bm = billedSpan.textContent.match(/Billed:\s*\$?([\d,]+(?:\.\d+)?)/i);
          if (bm) billed = parseFloat(bm[1].replace(',', ''));
        }
      }

      // Freelancer feedback — truncated review text
      const feedbackEl = q('.air3-truncation', jobEl);
      const feedback = feedbackEl ? text(feedbackEl) : null;

      // Job title + URL from the <a> inside [data-cy="job-title"]
      const titleLink = q('[data-cy="job-title"]', jobEl);
      const jobTitle = titleLink ? text(titleLink) : text(q('.text-base', jobEl));
      const jobLinkEl = titleLink?.tagName === 'A' ? titleLink : q('a', titleLink);
      const jobUrl = jobLinkEl
        ? 'https://www.upwork.com' + jobLinkEl.getAttribute('href')
        : null;
      const jobUid = jobUrl ? jobUrl.match(/~([A-F0-9]+)/)?.[1] || null : null;

      return {
        title: jobTitle,
        jobUrl,
        jobUid,
        freelancer: qa('a[href*="/freelancers/"]', jobEl).map(a => a.textContent.trim()).join(', '),
        freelancerUrl: qa('a[href*="/freelancers/"]', jobEl).map(a => 'https://www.upwork.com' + a.getAttribute('href')).join(', '),
        rating: parseRating(q('.air3-rating', jobEl)),
        feedback,
        hours: text(q('[data-cy="stats"] strong', jobEl)),
        payType,
        payAmount,
        billed,
        dates: dateWrap ? text(q(':scope > div:first-child', dateWrap)) : null,
      };
    });

    return {
      uid, url, title, posted, location: locationText,
      proposalConnects, availableConnects,
      summary,
      hourlyRate: hourlyRateLow != null && hourlyRateHigh != null
        ? { low: hourlyRateLow, high: hourlyRateHigh }
        : null,
      hoursPerWeek, duration, experienceLevel, projectType, contractToHire,
      skills, activity,
      bidRange: (bidHigh || bidAvg || bidLow) ? { high: bidHigh, avg: bidAvg, low: bidLow } : null,
      client, recentJobs,
    };
  }

  // Try immediately, then watch for the job card if not found yet
  window.__upworkJobData = extractJob() || null;

  if (!window.__upworkJobData) {
    const observer = new MutationObserver(() => {
      const data = extractJob();
      if (data) {
        window.__upworkJobData = data;
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
})();
