const cheerio = require('cheerio');
const { chromium } = require('playwright');

const SEARCH_URL = 'https://uma.pure-db.com/en-us/search';
const BASE = 'https://uma.pure-db.com/en-us/user/global';

function clean(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
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
  const lines = $('body').text().split('\n').map(clean).filter(Boolean);
  if (!lines.some(line => line.includes(trainerId))) return null;

  const profile = {
    name: '', rank: '', fans: '', representativeUma: '', supportCard: '',
    blueSparks: '', redSparks: '', greenSparks: '', whiteSparks: '',
    inheritance: '', image: '', url
  };

  const idIndex = lines.findIndex(line => line === trainerId || line.includes(trainerId));
  if (idIndex > 0) profile.name = lines[idIndex - 1];

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
  const candidates = [
    `${BASE}/${trainerId}`,
    `${BASE}/${trainerId}/403`,
    `${BASE}/${trainerId}/402`,
    `${BASE}/${trainerId}/401`
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

module.exports = { getPureDbProfile };
