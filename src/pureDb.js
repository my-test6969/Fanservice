const cheerio = require('cheerio');

process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
const { chromium } = require('playwright');

const SEARCH_URL = 'https://uma.pure-db.com/en-us/search';
const REGISTER_URL = 'https://uma.pure-db.com/en-us/register';
const BASE = 'https://uma.pure-db.com/en-us/user/global';
const UMA_MOE_API = 'https://uma.moe/api/v3/search';

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
    signal: AbortSignal.timeout(12000)
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

  const factorLines = lines.filter(x => /★\d+/.test(x));
  profile.blueSparks = factorLines.filter(x => /speed|stamina|power|guts|wit/i.test(x)).slice(0, 12).join(' • ') || 'Not available';
  profile.redSparks = factorLines.filter(x => /sprint|mile|medium|long|turf|dirt|aptitude/i.test(x)).slice(0, 12).join(' • ') || 'Not available';
  profile.greenSparks = factorLines.filter(x => !/speed|stamina|power|guts|wit|sprint|mile|medium|long|turf|dirt|aptitude/i.test(x)).slice(0, 12).join(' • ') || 'Not available';
  profile.whiteSparks = factorLines.slice(0, 20).join(' • ') || 'Not available';
  return profile;
}

function normalizeUmaProfile(data, trainerId) {
  if (!data || typeof data !== 'object') return null;
  const item = Array.isArray(data.items) ? data.items.find(x => String(x.account_id ?? x.trainer_id ?? '') === trainerId) || data.items[0] : null;
  if (!item) return null;
  if (String(item.account_id ?? item.trainer_id ?? '') !== trainerId) return null;

  const inh = item.inheritance || item.inheritance_record || null;
  const support = item.support_card || item.supportCard || null;
  const factor = values => Array.isArray(values) ? values.filter(v => v !== null && v !== undefined).join(', ') : '';
  return {
    name: clean(item.trainer_name || item.name),
    rank: clean(item.trainer_rank || item.rank),
    fans: item.follower_num ?? item.fan_count ?? item.fans ?? '',
    representativeUma: clean(item.representative_uma || item.representative || item.main_character_name || ''),
    supportCard: support ? clean(support.name || support.card_name || `Support Card #${support.support_card_id ?? ''}`) : '',
    blueSparks: inh ? factor(inh.blue_sparks) : '',
    redSparks: inh ? factor(inh.pink_sparks) : '',
    greenSparks: inh ? factor(inh.green_sparks) : '',
    whiteSparks: inh ? factor(inh.white_sparks) : '',
    inheritance: inh ? `Main parent #${inh.main_parent_id ?? '?'} • Left #${inh.parent_left_id ?? '?'} • Right #${inh.parent_right_id ?? '?'}` : '',
    image: clean(item.image || item.avatar || ''),
    url: `https://uma.moe/search?trainer_id=${encodeURIComponent(trainerId)}`,
    source: 'uma.moe'
  };
}

async function getUmaMoeProfile(trainerId) {
  const urls = [
    `${UMA_MOE_API}?trainer_id=${encodeURIComponent(trainerId)}&page=0&limit=20`,
    `${UMA_MOE_API}?trainer_id=${encodeURIComponent(trainerId)}&search_type=inheritance&page=0&limit=20`
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Fanservice/1.0', Accept: 'application/json' },
        signal: AbortSignal.timeout(8000)
      });
      if (!r.ok) continue;
      const data = await r.json();
      const profile = normalizeUmaProfile(data, trainerId);
      if (profile) return profile;
    } catch (error) {
      console.warn(`uma.moe lookup failed: ${error.message}`);
    }
  }
  return null;
}

async function extractProfileFromPage(page, trainerId) {
  const html = await page.content();
  const parsed = parseProfile(html, trainerId, page.url());
  if (parsed) return parsed;
  return null;
}

async function getProfileWithBrowser(trainerId) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ userAgent: 'Mozilla/5.0 Fanservice/1.0' });
  try {
    await page.goto(REGISTER_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1000);

    const inputs = page.locator('input:not([type="range"]):not([type="hidden"]):not([disabled]):not([readonly])');
    let target = null;
    for (let i = 0; i < await inputs.count(); i++) {
      const el = inputs.nth(i);
      const info = await el.evaluate(node => {
        const parent = node.parentElement;
        const grand = parent?.parentElement;
        return [
          node.getAttribute('aria-label') || '', node.getAttribute('placeholder') || '',
          node.getAttribute('name') || '', node.getAttribute('id') || '',
          parent?.innerText || '', grand?.innerText || ''
        ].join(' ');
      }).catch(() => '');
      if (/trainer\s*id|trainerid/i.test(info)) { target = el; break; }
    }
    if (!target) throw new Error('Pure DB Trainer ID input was not found');

    await target.fill(String(trainerId));
    const button = page.getByRole('button', { name: /Register\s*\/\s*Refresh Trainer ID/i });
    if (!(await button.count())) throw new Error('Pure DB Register/Refresh button was not found');
    await button.first().click({ timeout: 8000 });
    await page.waitForTimeout(2500);
    return await extractProfileFromPage(page, trainerId);
  } finally {
    await browser.close();
  }
}

async function getPureDbProfile(trainerId) {
  // Primary source: direct uma.moe API. This must never fall through to the
  // Pure DB UI if the direct source returns a definitive no-result.
  const umaProfile = await getUmaMoeProfile(trainerId);
  if (umaProfile) return umaProfile;

  // Secondary source: a known public Pure DB profile route.
  try {
    const html = await fetchPage(`${BASE}/${trainerId}`);
    if (html) {
      const parsed = parseProfile(html, trainerId, `${BASE}/${trainerId}`);
      if (parsed) return parsed;
    }
  } catch (e) {
    console.warn(`Pure DB direct lookup failed: ${e.message}`);
  }

  // Last resort only. UI failures are treated as not-found rather than
  // breaking /uma-profile with a misleading button/selector error.
  try {
    return await getProfileWithBrowser(trainerId);
  } catch (e) {
    console.warn(`Pure DB browser fallback failed: ${e.message}`);
    return null;
  }
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
      else if (['text', 'search', 'number', ''].includes(meta.type)) await el.fill(String(value));
      else continue;
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