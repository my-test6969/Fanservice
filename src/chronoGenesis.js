const { chromium } = require('playwright');

const SEARCH_URL = 'https://chronogenesis.net/friend_search';

function normalise(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function filterText(value) {
  return normalise(value).toLowerCase();
}

async function fillBestMatch(page, keywords, value) {
  if (!value) return false;
  const inputs = page.locator('input, textarea, select');
  const count = await inputs.count();

  for (let i = 0; i < count; i++) {
    const el = inputs.nth(i);
    const meta = await el.evaluate(node => ({
      tag: node.tagName,
      name: node.getAttribute('name') || '',
      id: node.id || '',
      placeholder: node.getAttribute('placeholder') || '',
      aria: node.getAttribute('aria-label') || '',
      title: node.getAttribute('title') || ''
    }));

    const haystack = filterText(Object.values(meta).join(' '));
    if (!keywords.some(keyword => haystack.includes(keyword))) continue;

    try {
      if (meta.tag === 'SELECT') {
        const options = await el.locator('option').allTextContents();
        const wanted = filterText(value);
        const option = options.find(text => filterText(text).includes(wanted));
        if (option) await el.selectOption({ label: option });
        else await el.selectOption({ label: value });
      } else {
        await el.fill(String(value));
      }
      return true;
    } catch (_) {}
  }
  return false;
}

async function clickSearch(page) {
  const candidates = page.getByRole('button', { name: /search|find|filter|apply/i });
  if (await candidates.count()) {
    await candidates.first().click();
    return true;
  }
  const submit = page.locator('button[type="submit"], input[type="submit"]');
  if (await submit.count()) {
    await submit.first().click();
    return true;
  }
  return false;
}

async function getChronoGenesisSearch({ uma, blue, red, green, whiteMin, mlbSupport }) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ userAgent: 'Fanservice/1.0 Discord Uma Musume search bot' });

  try {
    await page.goto(SEARCH_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);
    const applied = [];

    if (uma && await fillBestMatch(page, ['representative', 'uma', 'horse girl', 'character', 'main parent'], uma)) applied.push(`Uma: ${uma}`);
    if (blue && await fillBestMatch(page, ['blue', 'speed', 'stamina', 'power', 'guts', 'wit'], blue)) applied.push(`Blue: ${blue}`);
    if (red && await fillBestMatch(page, ['red', 'pink', 'turf', 'dirt', 'mile', 'medium', 'long', 'sprint'], red)) applied.push(`Red: ${red}`);
    if (green && await fillBestMatch(page, ['green', 'unique'], green)) applied.push(`Green: ${green}`);
    if (whiteMin && await fillBestMatch(page, ['white', 'factor', 'white count'], whiteMin)) applied.push(`White: ${whiteMin}+`);
    if (mlbSupport && await fillBestMatch(page, ['support', 'limit break', 'mlb'], 'MLB')) applied.push('MLB support');

    await clickSearch(page);
    await page.waitForTimeout(2000);

    const results = await page.locator('a, tr, [role="row"], [class*="result"], [class*="card"]').evaluateAll(nodes => nodes.map(node => ({
      text: (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim(),
      href: node.href || null
    })).filter(x => x.text && x.text.length >= 8).slice(0, 30));

    return { url: page.url(), applied, results, source: 'ChronoGenesis' };
  } finally {
    await browser.close();
  }
}

module.exports = { getChronoGenesisSearch, SEARCH_URL };
