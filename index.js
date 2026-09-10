require('dotenv').config();
const http = require('http');

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder
} = require('discord.js');

const { getPureDbProfile } = require('./src/pureDb');
const { getChronoGenesisSearch, SEARCH_URL } = require('./src/chronoGenesis');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

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

function resultLines(results) {
  const seen = new Set();
  const lines = [];
  for (const result of results || []) {
    const text = String(result.text || '').replace(/\s+/g, ' ').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    const id = text.match(/\b\d{9,12}\b/);
    const label = id ? `**${id[0]}**` : text.slice(0, 180);
    lines.push(result.href ? `[${label}](${result.href})` : label);
    if (lines.length >= 8) break;
  }
  return lines;
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
      const search = await getChronoGenesisSearch(filters);
      const lines = resultLines(search.results);
      const embed = new EmbedBuilder()
        .setTitle('🔎 ChronoGenesis Spark / Legacy Search')
        .setDescription(lines.length ? lines.join('\n') : 'No readable results were returned. ChronoGenesis may have changed its page layout or returned no matches.')
        .addFields(
          { name: 'Filters applied', value: search.applied.length ? search.applied.join('\n') : 'None detected' },
          { name: 'Source', value: `[Open ChronoGenesis](${search.url || SEARCH_URL})` }
        )
        .setFooter({ text: 'Fanservice • live ChronoGenesis search' });
      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('uma-find error:', error);
      return interaction.editReply(`⚠️ ChronoGenesis search failed. You can still open the live search here: ${SEARCH_URL}`);
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
