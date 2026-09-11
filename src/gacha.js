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
  const rate = result.rateUp ? ' ✨ RATE UP' : '';
  return `${rarityStars(result.rarity)} **${result.name}**${rate}`;
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
        signal: AbortSignal.timeout(3000),
        headers: { 'User-Agent': 'Fanservice-Gacha/1.0' }
      });
      if (!response.ok) return null;
      const html = await response.text();
      const matches = html.match(/https?:\/\/media\.gametora\.com\/umamusume\/characters\/[^"'\\s]+/g) || [];
      return matches.find(url => /\.png(?:\?|$)/i.test(url)) || null;
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
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return `data:image/png;base64,${buffer.toString('base64')}`;
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

function cardSvg(result, image, x, y, width, height) {
  const border = result.rarity === 3 ? '#f2c94c' : result.rarity === 2 ? '#d9e3ef' : '#e4e4e4';
  const glow = result.rarity === 3 ? `filter="url(#glow)"` : '';
  const stars = `${'★'.repeat(result.rarity)}${'☆'.repeat(3 - result.rarity)}`;
  const bonus = result.rarity === 3 ? 'x90' : result.rarity === 2 ? 'x10' : 'x5';
  const bonusText = result.rarity === 3 ? 'Bonus' : 'Bonus';
  const innerX = x + 10;
  const innerY = y + 10;
  const innerW = width - 20;
  const innerH = width - 20;
  const clipId = `clip${x}${y}`;

  return `
    <defs><clipPath id="${clipId}"><rect x="${innerX}" y="${innerY}" width="${innerW}" height="${innerH}" rx="18"/></clipPath></defs>
    ${result.rarity === 3 ? `<rect x="${x-5}" y="${y-5}" width="${width+10}" height="${height+10}" rx="25" fill="none" stroke="#ffe36e" stroke-width="8" opacity=".8" ${glow}/>` : ''}
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="22" fill="#f9fbff" stroke="${border}" stroke-width="5"/>
    ${image ? `<image href="${image}" x="${innerX}" y="${innerY}" width="${innerW}" height="${innerH}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>` : `<rect x="${innerX}" y="${innerY}" width="${innerW}" height="${innerH}" rx="18" fill="#dcecff"/>`}
    <text x="${x + width/2}" y="${y + height - 36}" text-anchor="middle" font-size="28" font-weight="700" fill="#f5b900" stroke="#6b5200" stroke-width="1">${stars}</text>
    <text x="${x + width/2}" y="${y + height - 8}" text-anchor="middle" font-size="18" font-weight="700" fill="#8b4b22">${escapeXml(result.name)}</text>
    ${result.rateUp ? `<rect x="${x+6}" y="${y+6}" width="108" height="30" rx="8" fill="#ff4f6d"/><text x="${x+60}" y="${y+28}" text-anchor="middle" font-size="16" font-weight="800" fill="white">RATE UP</text>` : ''}
    <rect x="${x+8}" y="${y+height+7}" width="70" height="28" rx="8" fill="#ffffff" stroke="#9b8c78" stroke-width="2"/>
    <text x="${x+43}" y="${y+27+height}" text-anchor="middle" font-size="18" font-weight="700" fill="#7b4b26">♟ x${result.rarity === 3 ? '3' : result.rarity === 2 ? '3' : '1'}</text>
    <rect x="${x+width-105}" y="${y+height+7}" width="105" height="28" rx="7" fill="#ff5266"/>
    <text x="${x+width-52}" y="${y+height+20}" text-anchor="middle" font-size="13" font-weight="800" fill="white">${bonusText}</text>
    <text x="${x+width-52}" y="${y+height+42}" text-anchor="middle" font-size="21" font-weight="800" fill="#8b4b22">${bonus}</text>
  `;
}

async function renderResults(results, totalPulls) {
  const images = await Promise.all(results.map(result => fetchImageData(result.name)));
  const width = 1000;
  const cardW = 250;
  const cardH = 250;
  const gap = 28;
  const rows = results.length === 10 ? [3, 2, 3, 2] : results.length <= 3 ? [results.length] : [Math.min(3, results.length)];
  let y = 205;
  let index = 0;
  let svgCards = '';

  for (const count of rows) {
    const rowWidth = count * cardW + (count - 1) * gap;
    const startX = (width - rowWidth) / 2;
    for (let col = 0; col < count && index < results.length; col++) {
      svgCards += cardSvg(results[index], images[index], startX + col * (cardW + gap), y, cardW, cardH);
      index++;
    }
    y += 315;
  }

  const height = y + 235;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5ecbff"/><stop offset="1" stop-color="#d9f5ff"/></linearGradient>
      <linearGradient id="grass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8ed54d"/><stop offset="1" stop-color="#4f9d37"/></linearGradient>
      <filter id="glow"><feGaussianBlur stdDeviation="8" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <rect width="1000" height="${height}" fill="url(#sky)"/>
    <circle cx="90" cy="85" r="55" fill="white" opacity=".75"/><circle cx="155" cy="70" r="75" fill="white" opacity=".65"/><circle cx="885" cy="90" r="65" fill="white" opacity=".75"/>
    <path d="M0 ${height-420} Q500 ${height-520} 1000 ${height-390} L1000 ${height} L0 ${height}Z" fill="url(#grass)"/>
    <path d="M0 ${height-395} L260 ${height-450} L300 ${height} L0 ${height}Z" fill="#7e9099" opacity=".7"/>
    <path d="M0 135 L1000 135 L970 185 L30 185Z" fill="#ffffff" stroke="#7fd22d" stroke-width="8"/>
    <text x="500" y="168" text-anchor="middle" font-family="Arial, sans-serif" font-size="38" font-weight="800" fill="#70401f">Scout Results</text>
    ${svgCards}
    <rect x="210" y="${height-190}" width="580" height="55" rx="8" fill="#ffffff" opacity=".94"/>
    <text x="235" y="${height-154}" font-family="Arial, sans-serif" font-size="25" font-weight="700" fill="#70401f">Trainee Exchange Pts</text>
    <text x="665" y="${height-154}" font-family="Arial, sans-serif" font-size="28" font-weight="800" fill="#70401f">${totalPulls}</text>
    <text x="730" y="${height-154}" font-family="Arial, sans-serif" font-size="26" fill="#777">▶</text>
    <text x="765" y="${height-154}" font-family="Arial, sans-serif" font-size="28" font-weight="800" fill="#e08a36">${totalPulls + 10}</text>
    <text x="500" y="${height-105}" text-anchor="middle" font-family="Arial, sans-serif" font-size="21" font-weight="700" fill="#70401f">Trainees you've already scouted grant Goddess Statues instead.</text>
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
  return { content: panel.embeds[0].data.description, embeds: [panel.embeds[0]], files: [attachment], components: panel.components };
}

function handleCommand(interaction) {
  if (interaction.commandName !== 'uma-gacha') return false;
  return interaction.reply(buildPanel(interaction.user.id));
}

async function handleButton(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith('gacha_')) return false;
  const s = getSession(interaction.user.id);

  if (interaction.customId === 'gacha_reset') {
    s.pulls = 0; s.last = [];
    return interaction.update(buildPanel(interaction.user.id, '♻️ Simulator reset.'));
  }

  if (interaction.customId === 'gacha_last') {
    if (!s.last.length) return interaction.reply({ content: 'No pulls yet. Hit **1 Pull** or **10 Pulls** first.', ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    const payload = await sendResults(interaction, s.last, s.pulls);
    return interaction.editReply(payload);
  }

  const count = interaction.customId === 'gacha_10' ? 10 : 1;
  const results = pull(count);
  s.pulls += count;
  s.last = results;

  await interaction.deferUpdate();
  const payload = await sendResults(interaction, results, s.pulls);
  return interaction.editReply(payload);
}

module.exports = { handleCommand, handleButton };
