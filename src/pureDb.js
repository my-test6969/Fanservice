const cheerio = require('cheerio');

process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
const { chromium } = require('playwright');

const SEARCH_URL = 'https://uma.pure-db.com/en-us/search';
const REGISTER_URL = 'https://uma.pure-db.com/en-us/register';
const BASE = 'https://uma.pure-db.com/en-us/user/global';

function clean(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function linesFrom(html) {
  const $ = cheerio.load(html);
  $('script, style, noscript, template').remove();
  return $('body').text().split('\n').map(clean).filter(Boolean);
}

function isNotFound(lines) {
  return lines.some(x => /^user not found$/i.test(x));
}

function after(lines, labels) {
  for (const label of labels) {
    const i = lines.findIndex(x => x.toLowerCase() === label.toLowerCase());
    if (i >= 0 && lines[i + 1]) return lines[i + 1];
  }
  return '';
}

function section(lines, labels, stops) {
  const start = lines.findIndex(x => labels.some(l => x.toLowerCase() === l.toLowerCase()));
  if (start < 0) return '';
  const out = [];
  for (let i = start + 1; i < Math.min(lines.length, start + 40); i++) {
    if (stops.some(s => lines[i].toLowerCase() === s.toLowerCase())) break;
    out.push(lines[i]);
  }
  return out.slice(0, 16).join(' • ');
}

async function fetchPage(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 Fanservice/1.0', Accept: 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(15000)
  });
  return r.ok ? r.text() : null;
}

function parseProfile(html, trainerId, url) {
  const $ = cheerio.load(html);
  $('script, style, noscript, template').remove();
  const lines = $('body').text().split('\n').map(clean).filter(Boolean);
  if (isNotFound(lines)) return null;
  if (!lines.some(x => x === trainerId)) return null;

  const i = lines.findIndex(x => x === trainerId);
  const profile = {
    name: i > 0 ? lines[i - 1] : '',
    rank: after(lines, ['Trainer Rank', 'Rank']),
    fans: after(lines, ['Fans', 'Total Fans', 'Fan Count']),
    representativeUma: after(lines, ['Representative Horse Girl', 'Representative Uma', 'Representative']),
    supportCard: after(lines, ['Support Card', 'Representative Support Card']),
    blueSparks: '', redSparks: '', greenSparks: '', whiteSparks: '',
    inheritance: section(lines, ['Inheritance1', 'Inheritance 1'], ['Inheritance2', 'Inheritance 2', 'Skills']),
    image: $('img').toArray().map(x => $(x).attr('src')).find(x => x && /^https?:/.test(x)) || '',
    url
  };

  // Pure DB renders the actual factor rows as text. Keep the parser conservative
  // instead of mixing unrelated skills into the spark fields.
  const factorLines = lines.filter(x => /★\d+/.test(x));
  profile.blueSparks = factorLines.filter(x => /speed|stamina|power|guts|wit/i.test(x)).slice(0, 12).join(' • ') || 'Not available';
  profile.redSparks = factorLines.filter(x => /sprint|mile|medium|long|turf|dirt|aptitude/i.test(x)).slice(0, 12).join(' • ') || 'Not available';
  profile.greenSparks = factorLines.filter(x => !/speed|stamina|power|guts|wit|sprint|mile|medium|long|turf|dirt|aptitude/i.test(x)).slice(0, 12).join(' • ') || 'Not available';
  profile.whiteSparks = factorLines.slice(0, 20).join(' • ') || 'Not available';
  return profile;
}

async function extractProfileFromPage(page, trainerId) {
  const html = await page.content();
  const parsed = parseProfile(html, trainerId, page.url());
  if (parsed) return parsed;

  const links = await page.locator('a').evaluateAll((anchors, id) => anchors.map(a => ({
    text: (a.innerText || a.textContent || '').trim(),
    href: a.href || ''
  })).filter(x => x.href.includes(id)), trainerId);

  for (const link of links) {
    try {
      const html = await fetchPage(link.href);
      const p = html && parseProfile(html, trainerId, link.href);
      if (p) return p;
    } catch (_) {}
  }
  return null;
}

async function getProfileWithBrowser(trainerId) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ userAgent: 'Mozilla/5.0 Fanservice/1.0' });
  try {
    // The real Pure DB page explicitly exposes this as Register/Refresh Trainer ID.
    // Do not guess field IDs: this is a React/Base UI page with generated IDs.
    await page.goto(REGISTER_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1200);

    const inputs = page.locator('input');
    const candidates = [];
    for (let i = 0; i < await inputs.count(); i++) {
      const el = inputs.nth(i);
      const info = await el.evaluate(node => ({
        type: node.type || '',
        value: node.value || '',
        placeholder: node.getAttribute('placeholder') || '',
        aria: node.getAttribute('aria-label') || '',
        name: node.getAttribute('name') || '',
        visible: !!(node.offsetWidth || node.offsetHeight || node.getClientRects().length)
      })).catch(() => null);
      if (info && info.visible && !['hidden','submit','button'].includes(info.type)) candidates.push({ el, info });
    }

    // On /register the first control is the Game Server selector and the
    // Trainer ID is the following text/search input. Prefer a field whose
    // metadata says trainer/id; otherwise use the last visible text input.
    let trainerInput = candidates.find(x => /trainer|user.*id|id.*trainer/i.test(`${x.info.placeholder} ${x.info.aria} ${x.info.name}`));
    if (!trainerInput) trainerInput = [...candidates].reverse().find(x => /text|search|number/.test(x.info.type) || !x.info.type);
    if (!trainerInput) throw new Error('Pure DB Trainer ID input was not found');

    await trainerInput.el.fill(trainerId);

    const button = page.getByRole('button', { name: /Register\/Refresh Trainer ID/i });
    if (!(await button.count())) throw new Error('Pure DB Register/Refresh button was not found');
    await button.first().click({ timeout: 10000 });

    // Registration can navigate to the generated /user/global/<id>/<suffix>
    // profile, or update the current DOM with a profile link.
    await page.waitForTimeout(3500);
    let profile = await extractProfileFromPage(page, trainerId);
    if (profile) return profile;

    // If registration leaves us on another page, search the main page again.
    await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1200);
    profile = await extractProfileFromPage(page, trainerId);
    if (profile) return profile;
  } finally {
    await browser.close();
  }
  return null;
}

async function getPureDbProfile(trainerId) {
  // Fast path for known profile URLs.
  try {
    const html = await fetchPage(`${BASE}/${trainerId}`);
    if (html) {
      const parsed = parseProfile(html, trainerId, `${BASE}/${trainerId}`);
      if (parsed) return parsed;
    }
  } catch (e) {
    console.warn(`Pure DB direct lookup failed: ${e.message}`);
  }

  // Correct fallback: use Pure DB's actual Register/Refresh Trainer ID page.
  return getProfileWithBrowser(trainerId);
}

function filterText(value) { return clean(value).toLowerCase(); }

async function setControl(page, keywords, value) {
  if (value === null || value === undefined || value === '') return false;
  const controls = page.locator('input, textarea, select');
  for (let i = 0; i < await controls.count(); i++) {
    const el = controls.nth(i);
    const meta = await el.evaluate(node => ({
      tag: node.tagName, type: node.type || '', name: node.name || '', id: node.id || '',
      placeholder: node.getAttribute('placeholder') || '', aria: node.getAttribute('aria-label') || ''
    })).catch(() => null);
    if (!meta) continue;
    const hay = filterText([meta.name, meta.id, meta.placeholder, meta.aria].join(' '));
    if (!keywords.some(k => hay.includes(filterText(k)))) continue;
    try {
      if (meta.tag === 'SELECT') await el.selectOption({ label: String(value) });
      else await el.fill(String(value));
      return true;
    } catch (_) {}
  }
  return false;
}

async function clickPureDbSearch(page) {
  const button = page.getByRole('button', { name: /^Search$/i });
  if (await button.count()) { await button.last().click({ force: true }); return true; }
  return false;
}

async function getPureDbSearch(filters) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ userAgent: 'Mozilla/5.0 Fanservice/1.0' });
  try {
    await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);
    const applied = [];
    if (filters.uma && await setControl(page, ['representative horse girl','representative uma'], filters.uma)) applied.push(`Uma: ${filters.uma}`);
    if (filters.blue && await setControl(page, ['blue factor','blue'], filters.blue)) applied.push(`Blue: ${filters.blue}`);
    if (filters.red && await setControl(page, ['red factor','red'], filters.red)) applied.push(`Red: ${filters.red}`);
    if (filters.green && await setControl(page, ['green factor','green'], filters.green)) applied.push(`Green: ${filters.green}`);
    if (filters.whiteMin && await setControl(page, ['white factor total count','white factor'], filters.whiteMin)) applied.push(`White: ${filters.whiteMin}+`);
    await clickPureDbSearch(page);
    await page.waitForTimeout(2500);

    const results = await page.locator('a').evaluateAll(anchors => anchors.map(a => ({
      text: clean(a.innerText || a.textContent || ''), href: a.href || ''
    })).filter(x => /\b\d{9,12}\b/.test(x.text)).slice(0, 20));

    const unique = [];
    const seen = new Set();
    for (const item of results) {
      const id = item.text.match(/\b\d{9,12}\b/)?.[0];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      unique.push({ ...item, trainerId: id });
    }
    return { url: page.url(), applied, results: unique.slice(0, 8), source: 'Umamusume DB (Pure DB)' };
  } finally {
    await browser.close();
  }
}

module.exports = { getPureDbProfile, getPureDbSearch, SEARCH_URL };