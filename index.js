require('dotenv').config();
const http = require('http');

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

const { getPureDbProfile, getPureDbSearch, SEARCH_URL } = require('./src/pureDb');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const searchPages = new Map();
const PAGE_SIZE = 5;
const PAGE_TTL = 10 * 60 * 1000;

const commands = [
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
  return { name, value: value || 'Not available', inline: true };
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
    .setDescription(lines.length
      ? lines.join('\n')
      : 'No indexed trainers matched the filters, or Pure DB returned no readable result rows.')
    .addFields(
      { name: 'Filters applied', value: search.applied.length ? search.applied.join('\n') : 'None detected' },
      { name: 'Results', value: `${items.length ? start + 1 : 0}-${Math.min(start + PAGE_SIZE, items.length)} of ${items.length}` },
      { name: 'Source', value: `[Open Umamusume DB](${search.url || SEARCH_URL})` }
    )
    .setFooter({ text: `Fanservice • Page ${safePage + 1}/${totalPages} • 5 users per page` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('fanservice_prev')
      .setLabel('◀ Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage === 0),
    new ButtonBuilder()
      .setCustomId('fanservice_next')
      .setLabel('Next ▶')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(safePage >= totalPages - 1)
  );

  return { embeds: [embed], components: [row], page: safePage };
}

function cleanupSearchPages() {
  const now = Date.now();
  for (const [key, value] of searchPages) {
    if (value.expiresAt <= now) searchPages.delete(key);
  }
}

client.once('clientReady', async () => {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const route = process.env.GUILD_ID
    ? Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID)
    : Routes.applicationCommands(client.user.id);
  await rest.put(route, { body: commands });
  console.log(`Fanservice online as ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  if (interaction.isButton()) {
    if (!['fanservice_prev', 'fanservice_next'].includes(interaction.customId)) return;

    cleanupSearchPages();
    const state = searchPages.get(interaction.message.id);
    if (!state) {
      return interaction.reply({ content: '⚠️ This search page has expired. Run `/uma-find` again.', ephemeral: true });
    }

    const direction = interaction.customId === 'fanservice_next' ? 1 : -1;
    const totalPages = Math.max(1, Math.ceil(state.items.length / PAGE_SIZE));
    state.page = Math.min(Math.max(state.page + direction, 0), totalPages - 1);
    state.expiresAt = Date.now() + PAGE_TTL;

    const message = buildSearchMessage(state.search, state.items, state.page);
    return interaction.update({ embeds: message.embeds, components: message.components });
  }

  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'uma-profile') {
    const trainerId = interaction.options.getString('trainer_id', true).trim();
    if (!validTrainerId(trainerId)) {
      return interaction.reply({ content: '❌ Please enter the 9–12 digit numeric Global Trainer ID.', ephemeral: true });
    }

    await interaction.deferReply();
    try {
      const profile = await getPureDbProfile(trainerId);
      if (!profile) return interaction.editReply(`❌ I couldn't find **${trainerId}** in the indexed Global databases.`);

      const embed = new EmbedBuilder()
        .setTitle(`🐎 ${profile.name || 'Trainer Profile'}`)
        .setDescription(`**Trainer ID:** ${trainerId}`)
        .addFields(
          field('Trainer Rank', profile.rank), field('Fans', profile.fans),
          field('Representative Uma', profile.representativeUma), field('Support Card', profile.supportCard),
          field('Blue Sparks', profile.blueSparks), field('Red Sparks', profile.redSparks),
          field('Green Sparks', profile.greenSparks), field('White Sparks', profile.whiteSparks),
          field('Inheritance', profile.inheritance)
        )
        .setFooter({ text: 'Fanservice • Global indexed data' });
      if (profile.url) embed.setURL(profile.url);
      if (profile.image) embed.setThumbnail(profile.image);
      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('uma-profile error:', error);
      return interaction.editReply('⚠️ The profile lookup failed.');
    }
  }

  if (interaction.commandName === 'uma-find') {
    const filters = {
      uma: interaction.options.getString('uma'),
      blue: interaction.options.getString('blue'),
      red: interaction.options.getString('red'),
      green: interaction.options.getString('green'),
      whiteMin: interaction.options.getInteger('white_min'),
      mlbSupport: interaction.options.getBoolean('mlb_support')
    };

    if (!Object.values(filters).some(Boolean)) {
      return interaction.reply({ content: '❌ Give me at least one search filter, such as `blue: Speed 3` or `red: Turf 3`.', ephemeral: true });
    }

    await interaction.deferReply();
    try {
      const search = await getPureDbSearch(filters);
      const items = resultItems(search.results);
      const message = buildSearchMessage(search, items, 0);

      const sent = await interaction.editReply({ embeds: message.embeds, components: message.components });
      searchPages.set(sent.id, {
        search,
        items,
        page: 0,
        expiresAt: Date.now() + PAGE_TTL
      });
      cleanupSearchPages();
      return sent;
    } catch (error) {
      console.error('uma-find error:', error);
      return interaction.editReply('⚠️ Pure DB search failed. Please try the search again.');
    }
  }
});

const port = Number(process.env.PORT) || 10000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Fanservice is online.');
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Health server listening on port ${port}`);
});

client.login(process.env.DISCORD_TOKEN);
