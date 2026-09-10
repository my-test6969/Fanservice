const BASE_URL = 'https://uma.moe/api/v3/search';

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function sparkList(value) {
  if (!Array.isArray(value)) return '';
  return value.map(item => String(item)).join(', ');
}

function pickRecord(body, trainerId) {
  const items = Array.isArray(body?.items) ? body.items : [];
  return items.find(item => String(item?.account_id ?? item?.trainer_id ?? '') === String(trainerId)) || items[0] || null;
}

async function getUmaMoeProfile(trainerId) {
  const params = new URLSearchParams({
    search_type: 'inheritance',
    trainer_id: String(trainerId),
    page: '0',
    limit: '20',
    // uma.moe defaults searches to <=999 followers. A direct Trainer ID
    // lookup must not silently exclude a valid account above that limit.
    max_follower_num: '2147483647'
  });

  const headers = {
    Accept: 'application/json',
    'User-Agent': 'Fanservice/1.0 (+Discord Uma Musume trainer lookup)'
  };

  // If the hosted API requires credentials, Render can supply either one
  // without putting secrets in the repository.
  if (process.env.UMA_MOE_API_KEY) headers['X-API-Key'] = process.env.UMA_MOE_API_KEY;
  if (process.env.UMA_MOE_BROWSER_PROOF) headers['X-Browser-Proof'] = process.env.UMA_MOE_BROWSER_PROOF;

  const response = await fetch(`${BASE_URL}?${params}`, {
    headers,
    signal: AbortSignal.timeout(12000)
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`uma.moe API returned HTTP ${response.status}${body ? `: ${body.slice(0, 180)}` : ''}`);
  }

  const body = await response.json();
  const record = pickRecord(body, trainerId);
  if (!record) return null;

  const inheritance = record.inheritance || record;
  const support = record.support_card || record.supportCard || null;
  const accountId = String(record.account_id ?? record.trainer_id ?? trainerId);

  return {
    name: clean(record.trainer_name ?? record.name),
    rank: '',
    fans: record.follower_num == null ? '' : String(record.follower_num),
    representativeUma: inheritance?.main_parent_id ? `Character ID ${inheritance.main_parent_id}` : '',
    supportCard: support?.support_card_id ? `Support Card ID ${support.support_card_id}${support.limit_break_count != null ? ` • LB ${support.limit_break_count}` : ''}` : '',
    blueSparks: sparkList(inheritance?.blue_sparks),
    redSparks: sparkList(inheritance?.pink_sparks),
    greenSparks: sparkList(inheritance?.green_sparks),
    whiteSparks: sparkList(inheritance?.white_sparks),
    inheritance: [
      inheritance?.parent_left_id ? `Parent 1: ${inheritance.parent_left_id}` : '',
      inheritance?.parent_right_id ? `Parent 2: ${inheritance.parent_right_id}` : '',
      inheritance?.win_count != null ? `Wins: ${inheritance.win_count}` : '',
      inheritance?.white_count != null ? `White factors: ${inheritance.white_count}` : ''
    ].filter(Boolean).join(' • '),
    url: `https://uma.moe/database?trainer_id=${encodeURIComponent(accountId)}`,
    image: '',
    source: 'uma.moe'
  };
}

module.exports = { getUmaMoeProfile };
