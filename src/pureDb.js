const cheerio = require('cheerio');

const BASE = 'https://uma.pure-db.com/en-us/user/global';

function clean(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function extractStarSpark(text) {
  const matches = clean(text).match(/(?:★\s*\d+|\d+\s*★)/g);
  return matches ? matches.join(', ') : '';
}

async function fetchPage(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Fanservice/1.0 (+Discord Uma Musume trainer lookup)'
    },
    signal: AbortSignal.timeout(12000)
  });

  if (!response.ok) return null;
  return response.text();
}

function parseProfile(html, trainerId, url) {
  const $ = cheerio.load(html);
  const bodyText = clean($('body').text());

  if (!bodyText || !bodyText.includes(trainerId)) return null;

  const lines = $('body').text().split('\n').map(clean).filter(Boolean);
  const indexOf = value => lines.findIndex(line => line.toLowerCase() === value.toLowerCase());
  const valueAfter = label => {
    const i = indexOf(label);
    return i >= 0 ? lines[i + 1] || '' : '';
  };

  const profile = {
    name: '',
    rank: '',
    fans: '',
    representativeUma: '',
    supportCard: '',
    blueSparks: '',
    redSparks: '',
    greenSparks: '',
    whiteSparks: '',
    inheritance: '',
    image: '',
    url
  };

  const idIndex = lines.findIndex(line => line === trainerId);
  if (idIndex > 0) profile.name = lines[idIndex - 1];

  const repIndex = indexOf('Representative Horse Girl');
  if (repIndex >= 0) profile.representativeUma = lines[repIndex + 1] || '';

  const supportIndex = indexOf('Support Card');
  if (supportIndex >= 0) profile.supportCard = lines[supportIndex + 1] || '';

  const inheritanceIndex = lines.findIndex(line => line === 'Inheritance1');
  if (inheritanceIndex >= 0) {
    const parentLines = lines.slice(inheritanceIndex + 1, inheritanceIndex + 45);
    profile.inheritance = parentLines.filter(line => /★\d+|\d+\s*★/.test(line)).slice(0, 8).join(' • ');
  }

  const sparkLines = lines.filter(line => /^(Speed|Stamina|Power|Guts|Wit|Sprint|Mile|Medium|Long|Turf|Dirt|Front|Pace|Late|End|★\d+)/i.test(line));
  const starText = extractStarSpark(sparkLines.join(' '));
  profile.blueSparks = starText || 'See inheritance details';

  const image = $('img').toArray().map(el => $(el).attr('src')).find(src => src && src.includes('uma-cdn.pure-db.com'));
  profile.image = image || '';

  // Pure DB profile pages expose representative/inheritance data, but not every
  // trainer statistic is guaranteed to be present in the public HTML.
  profile.rank = valueAfter('Trainer Rank') || valueAfter('Rank');
  profile.fans = valueAfter('Fans') || valueAfter('Total Fans');

  return profile;
}

async function getPureDbProfile(trainerId) {
  // The public profile route is currently versioned with a representative-card
  // suffix. Try the plain route first, then a small set of common suffixes.
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

  return null;
}

module.exports = { getPureDbProfile };
