const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const sharp = require('sharp');

const sessions = new Map();
const imageCache = new Map();
const BANNER = {
  name: 'Trainee Gacha',
  rateUp: ['Tamamo Cross', 'Inari One']
};

const TRAINEES = [
  ['Special Week',1],['Silence Suzuka',1],['Tokai Teio',1],['Maruzensky',1],['Fuji Kiseki',1],['Oguri Cap',1],['Gold Ship',1],['Vodka',1],['Daiwa Scarlet',1],['Taiki Shuttle',1],['Grass Wonder',1],['Hishi Amazon',1],['Mejiro McQueen',1],['El Condor Pasa',1],['T.M. Opera O',1],['Symboli Rudolf',1],['Air Groove',1],['Agnes Digital',1],['Seiun Sky',1],['Tamamo Cross',1],['Inari One',1],['Winning Ticket',1],['Haru Urara',1],['Matikanefukukitaru',1],
  ['Nice Nature',2],['Mejiro Ryan',2],['King Halo',2],['Mayano Top Gun',2],['Mihono Bourbon',2],['Biwa Hayahide',2],['Narita Brian',2],['Rice Shower',2],['Aston Machan',2],['Sakura Bakushin O',2],['Smart Falcon',2],['Fine Motion',2],['Kitasan Black',2],['Satono Diamond',2],['Twin Turbo',2],['Ikuno Dictus',2],
  ['Kitasan Black (Festival)',3],['Satono Diamond (Festival)',3],['Daiwa Scarlet (Wedding)',3],['Grass Wonder (Fantasy)',3],['Mejiro McQueen (End of the Line)',3],['Tamamo Cross',3],['Inari One',3],['Tokai Teio (Anime)',3],['Oguri Cap (Cookout)',3],['Special Week (Summer)',3]
];

function rollRarity(forceMin2 = false) {
  const r = Math.random();
  if (r < 0.03) return 3;
  if (r < 0.21 || forceMin2) return 2;
  return 1;
}

function rollTrainee(rarity) {
  const pool = TRAINEES.filter(x => x[1] === rarity);
  const name = pool[Math.floor(Math.random() * pool.length)][0];
  return { name, rarity, rateUp: rarity === 3 && BANNER.rateUp.includes(name) };
}

function pull(count) {
  const results = [];
  for (let i = 0; i < count; i++) {
    const rarity = rollRarity(count === 10 && i === 9 && !results.some(x => x.rarity >= 2));
    results.push(rollTrainee(rarity));
  }
  return results;
}

function rarityStars(rarity) {
  return '★'.repeat(rarity) + '☆'.repeat(3 - rarity);
}

function resultLine(result) {
  return `${rarityStars(result.rarity)} **${result.name}**${result.rateUp ? ' ✨ RATE UP' : ''}`;
}

function slugify(name) {
  return name
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\./g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

async function fetchImageUrl(name) {
  const baseName = name.replace(/\s*\([^)]*\)/g, '').trim();
  if (imageCache.has(baseName)) return imageCache.get(baseName);

  const promise = (async () => {
    try {
      const slug = slugify(baseName);
      const response = await fetch(`https://gametora.com/umamusume/characters/${slug}`, {
        signal: AbortSignal.timeout(4000),
        headers: { 'User-Agent': 'Fanservice-Gacha/1.0' }
      });
      if (!response.ok) return null;
      const html = await response.text();

      const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
      if (og && og[1]) return og[1].replace(/&amp;/g, '&');

      const images = html.match(/https?:\/\/gametora\.com\/images\/umamusume\/characters\/[^"'\\s]+\.png/gi) || [];
      return images[0] || null;
    } catch (_) {
      return null;
    }
  })();

  imageCache.set(baseName, promise);
  return promise;
}

async function fetchImageData(name) {
  const url = await fetchImageUrl(name);
  if (!url) return null;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(4000),
      headers: { 'User-Agent': 'Fanservice-Gacha/1.0' }
    });
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch (_) {
    return null;
  }
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function starPolygon(cx, cy, outer, inner, filled, key) {
  const points = [];
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + i * Math.PI / 5;
    const radius = i % 2 === 0 ? outer : inner;
    points.push(`${cx + Math.cos(angle) * radius},${cy + Math.sin(angle) * radius}`);
  }
  return `<polygon key="${key}" points="${points.join(' ')}" fill="${filled ? '#ffc928' : '#d7dce2'}" stroke="#8b6412" stroke-width="2"/>`;
}

function starsSvg(rarity, cx, cy, size = 25) {
  let out = '';
  const start = cx - size * 2.1;
  for (let i = 0; i < 3; i++) {
    out += starPolygon(start + i * size * 2.1, cy, size, size * 0.45, i < rarity, `${cx}-${cy}-${i}`);
  }
  return out;
}

function cardSvg(result, image, x, y, width) {
  const imageSize = width - 24;
  const cardHeight = imageSize + 62;
  const border = result.rarity === 3 ? '#f3cf5b' : '#cfd7e2';
  const glow = result.rarity === 3
    ? `<rect x="${x - 8}" y="${y - 8}" width="${width + 16}" height="${cardHeight + 16}" rx="25" fill="none" stroke="#ffe56d" stroke-width="8" opacity=".8" filter="url(#glow)"/>`
    : '';
  const clipId = `card-${x}-${y}`;
  const img = image
    ? `<image href="data:image/png;base64,${image.toString('base64')}" x="${x + 12}" y="${y + 12}" width="${imageSize}" height="${imageSize}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>`
    : `<rect x="${x + 12}" y="${y + 12}" width="${imageSize}" height="${imageSize}" rx="18" fill="#dbeafa"/>`;
  const bonus = result.rarity === 3 ? 90 : result.rarity === 2 ? 10 : 5;
  const fragments = result.rarity >= 2 ? 3 : 1;

  return `
    <defs><clipPath id="${clipId}"><rect x="${x + 12}" y="${y + 12}" width="${imageSize}" height="${imageSize}" rx="18"/></clipPath></defs>
    ${glow}
    <rect x="${x}" y="${y}" width="${width}" height="${cardHeight}" rx="22" fill="#f8fafc" stroke="${border}" stroke-width="4"/>
    ${img}
    ${starsSvg(result.rarity, x + width / 2, y + cardHeight + 22, 21)}
    ${result.rateUp ? `<rect x="${x + 5}" y="${y + 5}" width="105" height="29" rx="7" fill="#ff5068"/><text x="${x + 57}" y="${y + 25}" text-anchor="middle" font-family="Arial,sans-serif" font-size="16" font-weight="800" fill="#fff">RATE UP</text>` : ''}
    <text x="${x + 28}" y="${y + cardHeight + 51}" font-family="Arial,sans-serif" font-size="18" font-weight="800" fill="#70401f">♟ x${fragments}</text>
    <rect x="${x + width - 92}" y="${y + cardHeight + 36}" width="92" height="22" rx="5" fill="#ff5365"/>
    <text x="${x + width - 46}" y="${y + cardHeight + 52}" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" font-weight="800" fill="#fff">Bonus</text>
    <text x="${x + width - 46}" y="${y + cardHeight + 75}" text-anchor="middle" font-family="Arial,sans-serif" font-size="20" font-weight="800" fill="#70401f">x${bonus}</text>
  `;
}

async function renderResults(results, totalPulls) {
  const images = await Promise.all(results.map(result => fetchImageData(result.name)));
  const width = 1000;
  const cardW = 245;
  const rowGap = 92;
  const colGap = 32;
  const rows = results.length === 10 ? [3, 2, 3, 2] : [results.length];
  let y = 185;
  let index = 0;
  let cards = '';

  for (const count of rows) {
    const rowWidth = count * cardW + (count - 1) * colGap;
    const startX = (width - rowWidth) / 2;
    for (let col = 0; col < count && index < results.length; col++) {
      cards += cardSvg(results[index], images[index], startX + col * (cardW + colGap), y, cardW);
      index++;
    }
    y += 365 + rowGap;
  }

  const height = y + 210;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#57c8fa"/><stop offset="1" stop-color="#d9f5ff"/></linearGradient>
      <linearGradient id="grass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8ed44d"/><stop offset="1" stop-color="#4f9d37"/></linearGradient>
      <filter id="glow"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <rect width="1000" height="${height}" fill="url(#sky)"/>
    <circle cx="100" cy="70" r="55" fill="#fff" opacity=".7"/><circle cx="165" cy="55" r="75" fill="#fff" opacity=".6"/><circle cx="880" cy="70" r="70" fill="#fff" opacity=".65"/>
    <path d="M0 ${height - 520} Q500 ${height - 600} 1000 ${height - 500} L1000 ${height} L0 ${height}Z" fill="url(#grass)"/>
    <path d="M0 ${height - 490} L235 ${height - 540} L285 ${height} L0 ${height}Z" fill="#71848d" opacity=".72"/>
    <path d="M0 105 L1000 105 L970 155 L30 155Z" fill="#fff" stroke="#7bd32c" stroke-width="8"/>
    <text x="500" y="139" text-anchor="middle" font-family="Arial,sans-serif" font-size="36" font-weight="800" fill="#70401f">Scout Results</text>
    ${cards}
    <rect x="205" y="${height - 175}" width="590" height="52" rx="8" fill="#fff" opacity=".95"/>
    <text x="230" y="${height - 141}" font-family="Arial,sans-serif" font-size="24" font-weight="700" fill="#70401f">Trainee Exchange Pts</text>
    <text x="665" y="${height - 141}" font-family="Arial,sans-serif" font-size="27" font-weight="800" fill="#70401f">${totalPulls}</text>
    <text x="725" y="${height - 141}" font-family="Arial,sans-serif" font-size="25" fill="#777">▶</text>
    <text x="760" y="${height - 141}" font-family="Arial,sans-serif" font-size="27" font-weight="800" fill="#e08a36">${totalPulls + 10}</text>
    <text x="500" y="${height - 94}" text-anchor="middle" font-family="Arial,sans-serif" font-size="20" font-weight="700" fill="#70401f">Trainees you've already scouted grant Goddess Statues instead.</text>
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

function getSession(userId) {
  if (!sessions.has(userId)) sessions.set(userId, { pulls: 0, last: [] });
  return sessions.get(userId);
}

function buildPanel(userId, notice = '') {
  const s = getSession(userId);
  const embed = new EmbedBuilder()
    .setTitle('🎴 UMA MUSUME — TRAINEE GACHA')
    .setDescription(`**Banner:** ${BANNER.name}\n**Rate Up:** ${BANNER.rateUp.join(' / ')}\n\n**Rates**\n★★★ 3%\n★★☆ 18%\n★☆☆ 79%\n\n**Pulls:** ${s.pulls}\n${notice || 'Choose a pull below. This is a free simulator — no Carrats are spent.'}`)
    .setFooter({ text: '10-pull guarantees at least ★★ • Fanservice Gacha Simulator' });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('gacha_1').setLabel('1 Pull').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('gacha_10').setLabel('10 Pulls').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('gacha_last').setLabel('Last Results').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('gacha_reset').setLabel('Reset').setStyle(ButtonStyle.Danger)
  );
  return { embeds: [embed], components: [row] };
}

async function sendResults(interaction, results, totalPulls) {
  const png = await renderResults(results, totalPulls);
  const attachment = new AttachmentBuilder(png, { name: 'gacha-results.png' });
  const panel = buildPanel(interaction.user.id, `**${results.length === 10 ? '10-PULL RESULTS' : 'PULL RESULT'}**\n${results.map(resultLine).join('\n')}\n\n🎯 Total simulated pulls: **${totalPulls}**`);
  panel.embeds[0].setImage('attachment://gacha-results.png');
  return { embeds: [panel.embeds[0]], files: [attachment], components: panel.components };
}

function handleCommand(interaction) {
  if (interaction.commandName !== 'uma-gacha') return false;
  return interaction.reply(buildPanel(interaction.user.id));
}

async function handleButton(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith('gacha_')) return false;
  const s = getSession(interaction.user.id);

  if (interaction.customId === 'gacha_reset') {
    s.pulls = 0;
    s.last = [];
    return interaction.update(buildPanel(interaction.user.id, '♻️ Simulator reset.'));
  }

  if (interaction.customId === 'gacha_last') {
    if (!s.last.length) return interaction.reply({ content: 'No pulls yet. Hit **1 Pull** or **10 Pulls** first.', ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    return interaction.editReply(await sendResults(interaction, s.last, s.pulls));
  }

  const count = interaction.customId === 'gacha_10' ? 10 : 1;
  const results = pull(count);
  s.pulls += count;
  s.last = results;

  await interaction.deferUpdate();
  return interaction.editReply(await sendResults(interaction, results, s.pulls));
}

module.exports = { handleCommand, handleButton };
