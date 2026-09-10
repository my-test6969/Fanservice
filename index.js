const http = require('http');

// Bind Render's web port immediately so the platform can detect the service
// before Discord/Playwright finish loading.
const port = Number(process.env.PORT) || 10000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Fanservice is online.');
});
server.listen(port, '0.0.0.0', () => console.log(`Health server listening on port ${port}`));

require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const { getUmaMoeProfile } = require('./src/umaMoe');
const { getPureDbProfile, getPureDbSearch, SEARCH_URL } = require('./src/pureDb');

process.on('unhandledRejection', error => console.error('Unhandled promise rejection:', error));
process.on('uncaughtException', error => console.error('Uncaught exception:', error));

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const searchPages = new Map();
const PAGE_SIZE = 5;
const PAGE_TTL = 10 * 60 * 1000;
const LOOKUP_TIMEOUT = 45 * 1000;

const commands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check whether Fanservice is responding.'),
  new SlashCommandBuilder()
    .setName('uma-profile')
    .setDescription('Look up a Global Uma Musume trainer by Trainer ID.')
    .addStringOption(option => option.setName('trainer_id').setDescription('Your 9–12 digit Global Trainer ID').setRequired(true)),
  new SlashCommandBuilder()
    .setName('uma-find')
    .setDescription('Search Global trainers/legacies for sparks and support cards.')
    .addStringOption(option => option.setName('uma').setDescription('Representative Uma name'))
    .addStringOption(option => option.setName('blue').setDescription('Blue spark, e.g. Speed 3'))
    .addStringOption(option => option.setName('red').setDescription('Red/pink spark, e.g. Turf 3'))
    .addStringOption(option => option.setName('green').setDescription('Green spark / unique'))
    .addIntegerOption(option => option.setName('white_min').setDescription('Minimum total white sparks').setMinValue(1).setMaxValue(18))
    .addBooleanOption(option => option.setName('mlb_support').setDescription('Prefer an MLB support card'))
].map(command => command.toJSON());

function validTrainerId(value) {
  return /^\d{9,12}$/.test(value.trim());
}

function field(name, value) {
  const text = String(value ?? '').trim() || 'Not available';
  return { name: String(name).slice(0, 256), value: text.slice(0, 1024), inline: true };
}

function resultItems(results) {
  const seen = new Set();
  const items = [];
  for (const result of results || []) {
    const text = String(result.text || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const id = result.trainerId || text.match(/\b\d{9,12}\b/)?.[0];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    items.push({ ...result, trainerId: id });
    if (items.length >= 8) break;
  }
  return items;
}

function buildSearchMessage(search, items, page) {
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const start = safePage * PAGE_SIZE;
  const visible = items.slice(start, start + PAGE_SIZE);
  const lines = visible.map(result => {
    const label = `**${result.trainerId}**`;
    return result.href ? `[${label}](${result.href})` : label;
  });

  const embed = new EmbedBuilder()
    .setTitle('🔎 Umamusume DB Spark / Legacy Search')
    .setDescription(lines.length ? lines.join('\n') : 'No indexed trainers matched the filters, or Pure DB returned no readable result rows.')
    .addFields(
      { name: 'Filters applied', value: String(search.applied?.join('\n') || 'None detected').slice(0, 1024) },
      { name: 'Results', value: `${items.length ? start + 1 : 0}-${Math.min(start + PAGE_SIZE, items.length)} of ${items.length}` },
      { name: 'Source', value: `[Open Umamusume DB](${search.url || SEARCH_URL})` }
    )
    .setFooter({ text: `Fanservice • Page ${safePage + 1}/${totalPages} • 5 users per page` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('fanservice_prev').setLabel('◀ Previous').setStyle(ButtonStyle.Secondary).setDisabled(safePage === 0),
    new ButtonBuilder().setCustomId('fanservice_next').setLabel('Next ▶').setStyle(ButtonStyle.Primary).setDisabled(safePage >= totalPages - 1)
  );

  return { embeds: [embed], components: [row], page: safePage };
}

function cleanupSearchPages() {
  const now = Date.now();
  for (const [key, value] of searchPages) {
    if (value.expiresAt <= now) searchPages.delete(key);
  }
}

async function withTimeout(promise, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${LOOKUP_TIMEOUT / 1000}s.`)), LOOKUP_TIMEOUT);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

client.once('clientReady', async () => {
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    const route = process.env.GUILD_ID
      ? Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID)
      : Routes.applicationCommands(client.user.id);
    await rest.put(route, { body: commands });
    console.log(`Fanservice online as ${client.user.tag}`);
    console.log(`Registered ${commands.length} slash commands using ${process.env.GUILD_ID ? 'guild' : 'global'} registration.`);
  } catch (error) {
    console.error('Command registration error:', error);
  }
});

client.on('interactionCreate', async interaction => {
  console.log(`Interaction received: ${interaction.type} ${interaction.commandName || interaction.customId || 'unknown'}`);

  if (interaction.isButton()) {
    if (!['fanservice_prev', 'fanservice_next'].includes(interaction.customId)) return;
    cleanupSearchPages();
    const state = searchPages.get(interaction.message.id);
    if (!state) return interaction.reply({ content: '⚠️ This search page has expired. Run `/uma-find` again.', ephemeral: true });
    const direction = interaction.customId === 'fanservice_next' ? 1 : -1;
    const totalPages = Math.max(1, Math.ceil(state.items.length / PAGE_SIZE));
    state.page = Math.min(Math.max(state.page + direction, 0), totalPages - 1);
    state.expiresAt = Date.now() + PAGE_TTL;
    const message = buildSearchMessage(state.search, state.items, state.page);
    return interaction.update({ embeds: message.embeds, components: message.components });
  }

  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'ping') {
    return interaction.reply({ content: '🏓 Pong! Fanservice is online.' });
  }

  if (interaction.commandName === 'uma-profile') {
    const trainerId = interaction.options.getString('trainer_id', true).trim();
    if (!validTrainerId(trainerId)) return interaction.reply({ content: '❌ Please enter the 9–12 digit numeric Global Trainer ID.', ephemeral: true });

    try {
      await interaction.deferReply();
    } catch (error) {
      console.error('uma-profile defer failed:', error);
      return;
    }

    try {
      // Primary source: uma.moe's V3 unified search API. It supports direct
      // trainer_id filtering and is much faster/reliable than automating Pure DB.
      let profile = null;
      try {
        console.log(`Trying uma.moe Trainer ID lookup: ${trainerId}`);
        profile = await getUmaMoeProfile(trainerId);
      } catch (error) {
        console.warn(`uma.moe lookup failed for ${trainerId}: ${error.message}`);
      }

      // Secondary source: Pure DB, kept as a fallback for accounts that are
      // present there but not in uma.moe.
      if (!profile) {
        console.log(`Trying Pure DB fallback for Trainer ID: ${trainerId}`);
        profile = await getPureDbProfile(trainerId);
      }

      if (!profile) return interaction.editReply(`❌ I couldn't find **${trainerId}** in the indexed Global databases.`);

      const embed = new EmbedBuilder()
        .setTitle(`🐎 ${String(profile.name || 'Trainer Profile').slice(0, 240)}`)
        .setDescription(`**Trainer ID:** ${trainerId}`)
        .addFields(
          field('Trainer Rank', profile.rank), field('Fans / Followers', profile.fans),
          field('Representative Uma', profile.representativeUma), field('Support Card', profile.supportCard),
          field('Blue Sparks', profile.blueSparks), field('Red Sparks', profile.redSparks),
          field('Green Sparks', profile.greenSparks), field('White Sparks', profile.whiteSparks),
          field('Inheritance', profile.inheritance)
        )
        .setFooter({ text: `Fanservice • ${profile.source || 'Global indexed data'}` });
      if (profile.url) embed.setURL(profile.url);
      if (profile.image) embed.setThumbnail(profile.image);
      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('uma-profile error:', error);
      return interaction.editReply(`⚠️ Profile lookup failed: ${String(error.message || error).slice(0, 1500)}`);
    }
  }

  if (interaction.commandName === 'uma-find') {
    try {
      await interaction.deferReply();
    } catch (error) {
      console.error('uma-find defer failed:', error);
      return;
    }

    const filters = {
      uma: interaction.options.getString('uma'),
      blue: interaction.options.getString('blue'),
      red: interaction.options.getString('red'),
      green: interaction.options.getString('green'),
      whiteMin: interaction.options.getInteger('white_min'),
      mlbSupport: interaction.options.getBoolean('mlb_support')
    };

    if (!Object.values(filters).some(Boolean)) return interaction.editReply('❌ Give me at least one search filter, such as `blue: Speed 3` or `red: Turf 3`.');

    try {
      console.log('Starting Pure DB search:', JSON.stringify(filters));
      const search = await withTimeout(getPureDbSearch(filters), 'Pure DB search');
      const items = resultItems(search.results);
      const message = buildSearchMessage(search, items, 0);
      const sent = await interaction.editReply({ embeds: message.embeds, components: message.components });
      searchPages.set(sent.id, { search, items, page: 0, expiresAt: Date.now() + PAGE_TTL });
      cleanupSearchPages();
      return sent;
    } catch (error) {
      console.error('uma-find error:', error);
      return interaction.editReply(`⚠️ Pure DB search failed: ${String(error.message || error).slice(0, 1500)}`);
    }
  }
});

client.on('error', error => console.error('Discord client error:', error));
client.on('warn', message => console.warn('Discord warning:', message));

client.login(process.env.DISCORD_TOKEN).catch(error => console.error('Discord login failed:', error));
