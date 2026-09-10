const cheerio = require('cheerio');
const { chromium } = require('playwright');

const SEARCH_URL = 'https://uma.pure-db.com/en-us/search';
const BASE = 'https://uma.pure-db.com/en-us/user/global';

function clean(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function visibleLines(html) {
  const $ = cheerio.load(html);
  $('script, style, noscript, template').remove();
  return $('body').text().split('\n').map(clean).filter(Boolean);
}

function isNotFound(lines) {
  return lines.some(line => /^user not found$/i.test(line)) ||
    lines.some(line => /user not found/i.test(line) && line.length < 80);
}

function findAfter(lines, labels) {
  for (const label of labels) {
    const i = lines.findIndex(line => line.toLowerCase() === label.toLowerCase());
    if (i >= 0 && lines[i + 1]) return lines[i + 1];
  }
  return '';
}

function findSection(lines, labels, stopLabels = []) {
  const start = lines.findIndex(line => labels.some(label => line.toLowerCase() === label.toLowerCase()));
  if (start < 0) return '';
  const out = [];
  for (let i = start + 1; i < Math.min(lines.length, start + 35); i++) {
    if (stopLabels.some(label => lines[i].toLowerCase() === label.toLowerCase())) break;
    if (lines[i]) out.push(lines[i]);
  }
  return out.slice(0, 12).join(' • ');
}

async function fetchPage(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 Fanservice/1.0 (+Discord Uma Musume trainer lookup)',
      Accept: 'text/html,application/xhtml+xml'
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) return null;
  return response.text();
}

function parseProfile(html, trainerId, url) {
  const $ = cheerio.load(html);
  $('script, style, noscript, template').remove();
  const lines = $('body').text().split('\n').map(clean).filter(Boolean);

  // Pure DB's not-found page contains JavaScript which can include the searched
  // trainer ID. Never treat that script text as profile data.
  if (isNotFound(lines)) return null;
  if (!lines.some(line => line === trainerId || line.includes(trainerId))) return null;

  const profile = {
    name: '', rank: '', fans: '', representativeUma: '', supportCard: '',
    blueSparks: '', redSparks: '', greenSparks: '', whiteSparks: '',
    inheritance: '', image: '', url
  };

  const idIndex = lines.findIndex(line => line === trainerId || line.includes(trainerId));
  if (idIndex > 0) {
    const possibleName = lines[idIndex - 1];
    if (possibleName && possibleName !== trainerId) profile.name = possibleName;
  }

  profile.rank = findAfter(lines, ['Trainer Rank', 'Rank', 'Trainer rank']);
  profile.fans = findAfter(lines, ['Fans', 'Total Fans', 'Fan Count']);
  profile.representativeUma = findAfter(lines, ['Representative Horse Girl', 'Representative Uma', 'Representative']);
  profile.supportCard = findAfter(lines, ['Support Card', 'Representative Support Card']);
  profile.inheritance = findSection(lines, ['Inheritance1', 'Inheritance 1'], ['Inheritance2', 'Inheritance 2', 'Skills']);

  const sparkWords = lines.filter(line => /speed|stamina|power|guts|wit|sprint|mile|medium|long|turf|dirt|ura|factor|spark/i.test(line));
  profile.blueSparks = sparkWords.slice(0, 8).join(' • ') || 'Not available';
  profile.redSparks = sparkWords.slice(8, 14).join(' • ') || 'Not available';
  profile.greenSparks = sparkWords.slice(14, 20).join(' • ') || 'Not available';
  profile.whiteSparks = sparkWords.slice(20, 28).join(' • ') || 'Not available';

  const image = $('img').toArray().map(el => $(el).attr('src')).find(src => src && /^https?:/.test(src));
  profile.image = image || '';
  return profile;
}

async function getProfileWithBrowser(trainerId) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ userAgent: 'Mozilla/5.0 Fanservice/1.0' });
  try {
    await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);

    const links = await page.locator('a').evaluateAll((anchors, id) => anchors.map(a => ({
      text: (a.innerText || a.textContent || '').trim(),
      href: a.href || ''
    })).filter(x => x.href.includes(id)), trainerId);

    for (const link of links) {
      try {
        const html = await fetchPage(link.href);
        if (!html) continue;
        const parsed = parseProfile(html, trainerId, link.href);
        if (parsed) return parsed;
      } catch (_) {}
    }
  } finally {
    await browser.close();
  }
  return null;
}

async function getPureDbProfile(trainerId) {
  // Do not guess arbitrary Pure DB suffixes. A suffix such as /403 is not a
  // documented universal route and guessing it can produce a false not-found.
  const candidates = [
    `${BASE}/${trainerId}`
  ];

  for (const url of candidates) {
    try {
      const html = await fetchPage(url);
      if (!html) continue;
      const parsed = parseProfile(html, trainerId, url);
      if (parsed) return parsed;
    } catch (error) {
      console.warn(`Pure DB request failed for ${url}: ${error.message}`);
    }
  }

  return getProfileWithBrowser(trainerId);
}

function filterText(value) {
  return clean(value).toLowerCase();
}

async function setControl(page, keywords, value) {
  if (value === null || value === undefined || value === '') return false;
  const wanted = filterText(value);
  const controls = page.locator('input, textarea, select');
  const count = await controls.count();

  for (let i = 0; i < count; i++) {
    const el = controls.nth(i);
    const meta = await el.evaluate(node => ({
      tag: node.tagName,
      type: node.getAttribute('type') || '',
      name: node.getAttribute('name') || '',
      id: node.id || '',
      placeholder: node.getAttribute('placeholder') || '',
      aria: node.getAttribute('aria-label') || '',
      title: node.getAttribute('title') || ''
    })).catch(() => null);
    if (!meta) continue;

    const haystack = filterText([meta.name, meta.id, meta.placeholder, meta.aria, meta.title].join(' '));
    if (!keywords.some(k => haystack.includes(filterText(k)))) continue;

    try {
      if (meta.tag === 'SELECT') {
        const options = await el.locator('option').allTextContents();
        const match = options.find(x => filterText(x).includes(wanted));
        if (match) {
          await el.selectOption({ label: match });
          return true;
        }
      } else if (meta.tag === 'INPUT' && ['text', 'search', 'number', ''].includes(meta.type)) {
        await el.fill(String(value));
        return true;
      }
    } catch (_) {}
  }
  return false;
}

async function clickPureDbSearch(page) {
  const exact = page.getByText('Search', { exact: true });
  const exactCount = await exact.count();
  if (exactCount) {
    for (let i = exactCount - 1; i >= 0; i--) {
      const el = exact.nth(i);
      if (await el.isVisible().catch(() => false)) {
        try {
          await el.click({ timeout: 5000, force: true });
          return true;
        } catch (_) {
          try {
            await el.evaluate(node => node.click());
            return true;
          } catch (_) {}
        }
      }
    }
  }

  const buttons = page.locator('button, input[type="submit"]');
  const count = await buttons.count();
  for (let i = 0; i < count; i++) {
    const el = buttons.nth(i);
    const text = filterText(await el.innerText().catch(() => ''));
    const aria = filterText(await el.getAttribute('aria-label').catch(() => ''));
    const title = filterText(await el.getAttribute('title').catch(() => ''));
    if (text.includes('search') || aria.includes('search') || title.includes('search')) {
      try {
        await el.click({ timeout: 5000, force: true });
        return true;
      } catch (_) {
        try {
          await el.evaluate(node => node.click());
          return true;
        } catch (_) {}
      }
    }
  }

  const forms = page.locator('form');
  if (await forms.count()) {
    try {
      await forms.first().evaluate(form => form.requestSubmit());
      return true;
    } catch (_) {}
  }

  try {
    await page.keyboard.press('Enter');
    return true;
  } catch (_) {}

  return false;
}

async function getPureDbSearch(filters) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ userAgent: 'Mozilla/5.0 Fanservice/1.0' });
  try {
    await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1800);

    const applied = [];
    if (filters.uma && await setControl(page, ['representative horse girl', 'representative uma', 'representative'], filters.uma)) applied.push(`Uma: ${filters.uma}`);
    if (filters.blue && await setControl(page, ['blue', 'blue factor', 'blue spark'], filters.blue)) applied.push(`Blue: ${filters.blue}`);
    if (filters.red && await setControl(page, ['red', 'pink', 'red factor', 'red spark'], filters.red)) applied.push(`Red: ${filters.red}`);
    if (filters.green && await setControl(page, ['green', 'green factor', 'green spark'], filters.green)) applied.push(`Green: ${filters.green}`);
    if (filters.whiteMin && await setControl(page, ['white factor total count', 'white factor', 'white'], filters.whiteMin)) applied.push(`White: ${filters.whiteMin}+`);

    if (!await clickPureDbSearch(page)) {
      throw new Error('Pure DB Search button was not found');
    }

    await page.waitForTimeout(2500);

    const results = await page.locator('a, tr, [role="row"], [class*="result"], [class*="card"]').evaluateAll(nodes => nodes.map(node => ({
      text: (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim(),
      href: node.href || null
    })).filter(x => /\b\d{9,12}\b/.test(x.text) && x.text.length >= 8).slice(0, 30));

    const unique = [];
    const seen = new Set();
    for (const item of results) {
      const id = item.text.match(/\b\d{9,12}\b/)?.[0];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      unique.push({ ...item, trainerId: id });
      if (unique.length >= 8) break;
    }

    return { url: page.url(), applied, results: unique, source: 'Umamusume DB (Pure DB)' };
  } finally {
    await browser.close();
  }
}

module.exports = { getPureDbProfile, getPureDbSearch, SEARCH_URL };
