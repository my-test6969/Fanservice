const BASE_URL = 'https://chronogenesis.net/friend_search';

function buildChronoGenesisUrl() {
  return BASE_URL;
}

async function getChronoGenesisSearch() {
  // ChronoGenesis is a JavaScript-driven friend database. Its public
  // search page is the authoritative UI for spark/legacy filtering.
  // We deliberately do not invent undocumented API parameters here.
  return {
    url: buildChronoGenesisUrl(),
    source: 'ChronoGenesis',
    supports: [
      'blue sparks',
      'red/pink sparks',
      'green sparks',
      'white factors',
      'legacy/parent Uma search',
      'support card filters',
      'trainer/friend ID results'
    ]
  };
}

module.exports = { getChronoGenesisSearch, buildChronoGenesisUrl };
