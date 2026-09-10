require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder
} = require('discord.js');

const { getPureDbProfile } = require('./src/pureDb');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder()
    .setName('uma-profile')
    .setDescription('Look up a Global Uma Musume trainer by Trainer ID.')
    .addStringOption(option =>
      option.setName('trainer_id')
        .setDescription('Your 9–12 digit Global Trainer ID')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('uma-find')
    .setDescription('Find Global trainers/legacies by representative Uma and spark criteria.')
    .addStringOption(option => option.setName('uma').setDescription('Representative Uma name'))
    .addStringOption(option => option.setName('blue').setDescription('Blue spark, e.g. Speed 3'))
    .addStringOption(option => option.setName('red').setDescription('Red spark, e.g. Turf 3'))
    .addStringOption(option => option.setName('green').setDescription('Green spark / unique'))
    .addIntegerOption(option => option.setName('white_min').setDescription('Minimum total white sparks').setMinValue(1).setMaxValue(18))
    .addBooleanOption(option => option.setName('mlb_support').setDescription('Prefer trainers with an MLB support card'))
].map(command => command.toJSON());

function validTrainerId(value) {
  return /^\d{9,12}$/.test(value.trim());
}

function field(name, value) {
  return { name, value: value || 'Not available', inline: true };
}

client.once('ready', async () => {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const route = process.env.GUILD_ID
    ? Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID)
    : Routes.applicationCommands(client.user.id);

  await rest.put(route, { body: commands });
  console.log(`Fanservice online as ${client.user.tag}`);
  console.log(`Commands registered ${process.env.GUILD_ID ? 'for guild ' + process.env.GUILD_ID : 'globally'}.`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'uma-profile') {
    const trainerId = interaction.options.getString('trainer_id', true).trim();

    if (!validTrainerId(trainerId)) {
      return interaction.reply({
        content: '❌ That does not look like a valid Trainer ID. Please enter the 9–12 digit numeric ID from Global.',
        ephemeral: true
      });
    }

    await interaction.deferReply();

    try {
      const profile = await getPureDbProfile(trainerId);

      if (!profile) {
        return interaction.editReply({
          content: `❌ I couldn't find **${trainerId}** in the indexed Global databases.\n\nThe trainer may not have registered/uploaded their data yet.`
        });
      }

      const embed = new EmbedBuilder()
        .setTitle(`🐎 ${profile.name || 'Trainer Profile'}`)
        .setDescription(`**Trainer ID:** ${trainerId}`)
        .addFields(
          field('Trainer Rank', profile.rank),
          field('Fans', profile.fans),
          field('Representative Uma', profile.representativeUma),
          field('Support Card', profile.supportCard),
          field('Blue Sparks', profile.blueSparks),
          field('Red Sparks', profile.redSparks),
          field('Green Sparks', profile.greenSparks),
          field('White Sparks', profile.whiteSparks),
          field('Inheritance', profile.inheritance)
        )
        .setFooter({ text: 'Fanservice • Global indexed data' });

      if (profile.url) embed.setURL(profile.url);
      if (profile.image) embed.setThumbnail(profile.image);

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('uma-profile error:', error);
      await interaction.editReply('⚠️ The profile lookup failed while contacting the public database. Please try again later.');
    }
  }

  if (interaction.commandName === 'uma-find') {
    const uma = interaction.options.getString('uma');
    const blue = interaction.options.getString('blue');
    const red = interaction.options.getString('red');
    const green = interaction.options.getString('green');
    const whiteMin = interaction.options.getInteger('white_min');
    const mlb = interaction.options.getBoolean('mlb_support');

    const filters = [];
    if (uma) filters.push(`Uma: **${uma}**`);
    if (blue) filters.push(`Blue: **${blue}**`);
    if (red) filters.push(`Red: **${red}**`);
    if (green) filters.push(`Green: **${green}**`);
    if (whiteMin) filters.push(`White sparks: **${whiteMin}+**`);
    if (mlb) filters.push('MLB support: **preferred**');

    const description = filters.length ? filters.join('\n') : 'No filters supplied.';

    const embed = new EmbedBuilder()
      .setTitle('🔎 Uma Legacy / Spark Search')
      .setDescription(description)
      .addFields(
        { name: 'Pure DB', value: '[Open Global advanced friend search](https://uma-global.pure-db.com/#/search)' },
        { name: 'uma.moe', value: '[Open trainer / inheritance search](https://uma.moe/)' },
        { name: 'ChronoGenesis', value: '[Open trainer search](https://chronogenesis.net/)' }
      )
      .setFooter({ text: 'Fanservice • search sources' });

    await interaction.reply({ embeds: [embed] });
  }
});

client.login(process.env.DISCORD_TOKEN);
