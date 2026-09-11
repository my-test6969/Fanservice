const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

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
        signal: AbortSignal.timeout(2500)
      });
      if (!response.ok) return null;
      const html = await response.text();
      const match = html.match(/https?:\/\/media\.gametora\.com\/umamusume\/characters\/profile\/\d+\.png/);
      return match ? match[0] : null;
    } catch (_) {
      return null;
    }
  })();

  imageCache.set(baseName, promise);
  return promise;
}

async function buildResultEmbeds(results, totalPulls) {
  const urls = await Promise.all(results.map(result => fetchImageUrl(result.name)));
  return results.map((result, index) => {
    const rate = result.rateUp ? ' ✨ RATE UP' : '';
    const embed = new EmbedBuilder()
      .setTitle(`${rarityStars(result.rarity)} ${result.name}${rate}`)
      .setDescription(result.rarity === 3 ? '★★★ SSR / 3★' : result.rarity === 2 ? '★★☆ SR / 2★' : '★☆☆ R / 1★');
    if (urls[index]) embed.setThumbnail(urls[index]);
    if (index === 0) embed.setFooter({ text: `Banner: ${BANNER.name} • Rate Up: ${BANNER.rateUp.join(' / ')} • Total pulls: ${totalPulls}` });
    return embed;
  });
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
    const embeds = await buildResultEmbeds(s.last, s.pulls);
    return interaction.editReply({ embeds });
  }

  const count = interaction.customId === 'gacha_10' ? 10 : 1;
  const results = pull(count);
  s.pulls += count;
  s.last = results;

  await interaction.deferUpdate();
  const resultEmbeds = await buildResultEmbeds(results, s.pulls);
  const row = buildPanel(interaction.user.id).components;
  const summary = `**${count === 10 ? '10-PULL RESULTS' : 'PULL RESULT'}**\n${results.map(resultLine).join('\n')}\n\n🎯 Total simulated pulls: **${s.pulls}**`;
  return interaction.editReply({ content: summary, embeds: resultEmbeds, components: row });
}

module.exports = { handleCommand, handleButton };
