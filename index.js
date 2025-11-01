// index.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Partials,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  ChannelType, PermissionFlagsBits, EmbedBuilder,
  ComponentType, Events } = require('discord.js');

const DATA_PATH = path.join(__dirname, 'tickets.json');
const TRANSCRIPTS_DIR = path.join(__dirname, 'transcripts');
if (!fs.existsSync(TRANSCRIPTS_DIR)) fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });

// ----- CONFIG from you -----
const CONFIG = {
  // Category IDs
  categories: {
    general: '1364076316437254176',
    deputy: '1364077708178493501',
    command: '1364619789305380947'
  },
  // Roles to ping (can be arrays or single string)
  pings: {
    general: ['1364076309856387072'],
    deputy: ['1363515128829579324','1363514952908013638'],
    command: ['1363512208348413982']
  },
  // Channel name format: ticket-[type]-[number]
  channelName: (type, number) => `ticket-${type}-${String(number).padStart(3,'0')}`,
  // Optional: id of channel where to post transcripts (null -> posts in ticket channel)
  transcriptLogChannel: null
};
// ---------------------------

// load or create ticket counters
let counters = { general: 0, deputy: 0, command: 0 };
try {
  if (fs.existsSync(DATA_PATH)) {
    counters = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    counters.general ??= 0;
    counters.deputy ??= 0;
    counters.command ??= 0;
  } else {
    fs.writeFileSync(DATA_PATH, JSON.stringify(counters, null, 2));
  }
} catch (err) {
  console.error('Failed to read or create tickets.json', err);
}

function saveCounters() {
  fs.writeFileSync(DATA_PATH, JSON.stringify(counters, null, 2));
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// Helper: build the initial support embed + buttons (you can call this from a command or run once)
function buildSupportMessage() {
  const embed = new EmbedBuilder()
    .setTitle("Los Angeles County Sheriff's Department - Support")
    .setDescription("If you need any help from the Los Angeles County Sheriff's Department support team, please open a ticket using the buttons menu below. All information and types of things we handle are listed below, Please read over the options before opening the ticket so you know that the correct designated team can help you with any issues.\n\n**General Tickets**\n> • Questions\n> • Tech Support\n\n**Deputy Report/Punishment Appeal**\n> • SOP Violations\n> • Misconduct\n> • Blacklists\n> • Disciplinary Actions\n\n**Command Staff**\n> • Emergency's\n> • Reporting a Captain+\n")
    .setColor(0x602a79) // your color (6305800)
    .setThumbnail('https://upload.wikimedia.org/wikipedia/commons/thumb/4/45/Badge_of_the_Sheriff_of_Los_Angeles_County.png/250px-Badge_of_the_Sheriff_of_Los_Angeles_County.png')
    .setImage('https://media.discordapp.net/attachments/1423628867113058304/1425370168196071556/Add_a_heading.png')
    ;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_general')
      .setLabel('General')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('ticket_deputy')
      .setLabel('Deputy Report/Punishment Appeal')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('ticket_command')
      .setLabel('Command')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row] };
}

// Create a modal for ticket input
function buildTicketModal(type) {
  const modal = new ModalBuilder()
    .setCustomId(`ticket_modal|${type}`)
    .setTitle(type === 'general' ? 'General Support Request' :
              type === 'deputy' ? 'Deputy Report / Punishment Appeal' :
              'Command Staff Request');

  const input = new TextInputBuilder()
    .setCustomId('issue_desc')
    .setLabel('Briefly Describe Your Issue')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setPlaceholder('Describe the issue in as much detail as you can.');

  const row = new ActionRowBuilder().addComponents(input);
  modal.addComponents(row);
  return modal;
}

// When a button is clicked to create modal
client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isButton()) {
      const id = interaction.customId;
      if (id === 'ticket_general' || id === 'ticket_deputy' || id === 'ticket_command') {
        const type = id.split('_')[1]; // general/deputy/command
        const modal = buildTicketModal(type);
        await interaction.showModal(modal);
      }
      return;
    }

    // Modal submit
    if (interaction.isModalSubmit()) {
      if (!interaction.customId.startsWith('ticket_modal|')) return;
      await interaction.deferReply({ ephemeral: true });
      const [, type] = interaction.customId.split('|');
      const desc = interaction.fields.getTextInputValue('issue_desc').slice(0, 2000);

      // increment counter & save
      counters[type] = (counters[type] ?? 0) + 1;
      saveCounters();
      const ticketNumber = counters[type];

      // category to create channel under
      const categoryId = CONFIG.categories[type];
      if (!categoryId) {
        await interaction.editReply('Ticket category is not configured. Contact an admin.');
        return;
      }

      const guild = interaction.guild;
      if (!guild) { await interaction.editReply('Guild not found.'); return; }

      const channelName = CONFIG.channelName(type, ticketNumber);

      // Create channel under category. We'll let category overwrites determine which staff roles can view/send.
      const channel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: categoryId,
        topic: `Ticket Type: ${type} | Number: ${ticketNumber} | Created by: ${interaction.user.tag} (${interaction.user.id})`,
        permissionOverwrites: [
          {
            id: guild.id, // @everyone -> by default deny view
            deny: [PermissionFlagsBits.ViewChannel]
          },
          // ensure the ticket opener can see & send
          {
            id: interaction.user.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
          },
          // keep bot allowed
          {
            id: client.user.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels]
          }
        ]
      });

      // Now: we want staff roles that have access to the category to also see & send.
      // We'll copy "ViewChannel" and "SendMessages" from category overwrites for roles onto this channel.
      try {
        const category = guild.channels.cache.get(categoryId);
        if (category && category.permissionOverwrites) {
          for (const [targetId, overwrite] of category.permissionOverwrites.cache) {
            // apply role/ member overwrites that allow VIEW_CHANNEL onto the new channel
            const allowView = overwrite.allow.has(PermissionFlagsBits.ViewChannel);
            const allowSend = overwrite.allow.has(PermissionFlagsBits.SendMessages);
            // only replicate for roles (not @everyone which we already handled)
            if (targetId === guild.id) continue;
            // replicate role overwrites
            await channel.permissionOverwrites.edit(targetId, {
              ViewChannel: allowView ? true : null,
              SendMessages: allowSend ? true : null,
              ReadMessageHistory: allowView ? true : null
            }).catch(e => {
              // continue silently; some overwrites target members or special IDs
            });
          }
        }
      } catch (err) {
        console.warn('Failed to copy category overwrites:', err);
      }

      // Ping role(s) configured for this type (send as a message in the ticket and mention them)
      const pingRoles = (CONFIG.pings[type] || []).map(id => `<@&${id}>`).join(' ') || '';
      const openerMention = `<@${interaction.user.id}>`;

      // Initial message: show ticket info + claim/close buttons
      const ticketEmbed = new EmbedBuilder()
        .setTitle(`Ticket ${channelName}`)
        .addFields(
          { name: 'Type', value: type, inline: true },
          { name: 'Number', value: String(ticketNumber), inline: true },
          { name: 'Opened by', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: false },
          { name: 'Description', value: desc || 'No description provided.' }
        )
        .setFooter({ text: 'Use the Claim button to claim this ticket' })
        .setTimestamp();

      const ticketRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`claim_${type}_${ticketNumber}`)
          .setLabel('Claim Ticket')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`close_${type}_${ticketNumber}`)
          .setLabel('Close Ticket')
          .setStyle(ButtonStyle.Danger)
      );

      // send initial message in the ticket channel
      const createdMsg = await channel.send({ content: `${pingRoles} ${openerMention}\n\n**Ticket created — staff: please respond.**`, embeds: [ticketEmbed], components: [ticketRow] });

      // reply to user (ephemeral)
      await interaction.editReply({ content: `Your ticket has been created: ${channel.toString()}`, ephemeral: true });

      return;
    }

    // Button interactions for Claim / Close handled below
    if (interaction.isButton()) {
      // handle claim/close buttons inside ticket channel
      const id = interaction.customId;

      // Claim: format claim_<type>_<number>
      if (id.startsWith('claim_')) {
        await interaction.deferReply({ ephemeral: true });
        const parts = id.split('_');
        const type = parts[1];
        const number = parts[2];
        const channel = interaction.channel;
        if (!channel || !channel.isTextBased()) { await interaction.editReply('Claim must be used inside a ticket channel.'); return; }

        // Check if already claimed (we'll look for topic containing "Claimer:")
        const topic = channel.topic || '';
        if (topic.includes('Claimer:')) {
          await interaction.editReply('This ticket has already been claimed.');
          return;
        }

        // Restrict other staff to view-only, grant claimer send perms
        try {
          // iterate category overwrites (the channel parent)
          const category = channel.parent;
          if (category && category.permissionOverwrites) {
            for (const [targetId, overwrite] of category.permissionOverwrites.cache) {
              if (targetId === channel.guild.id) continue; // skip @everyone
              // If this overwrite allowed viewing, set role to view only (deny send)
              const isRole = channel.guild.roles.cache.has(targetId);
              if (isRole) {
                const roleOverwrite = overwrite;
                const allowedView = roleOverwrite.allow.has(PermissionFlagsBits.ViewChannel);
                if (allowedView) {
                  await channel.permissionOverwrites.edit(targetId, {
                    ViewChannel: true,
                    SendMessages: false,
                    ReadMessageHistory: true
                  }).catch(() => {});
                }
              }
            }
          }

          // allow the claimer to send
          await channel.permissionOverwrites.edit(interaction.user.id, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true
          });

          // ensure ticket author can still send (we assume first message had author id)
          // Find author id in topic string
          const authorMatch = (channel.topic || '').match(/Created by: .* \((\d+)\)/);
          if (authorMatch && authorMatch[1]) {
            const authorId = authorMatch[1];
            await channel.permissionOverwrites.edit(authorId, {
              ViewChannel: true,
              SendMessages: true,
              ReadMessageHistory: true
            }).catch(()=>{});
          }
        } catch (err) {
          console.warn('Error applying claim overwrites', err);
        }

        // update topic to indicate claimer
        const newTopic = `${channel.topic || ''} | Claimer: ${interaction.user.tag} (${interaction.user.id})`;
        await channel.setTopic(newTopic).catch(()=>{});

        await interaction.editReply({ content: `You have claimed this ticket. Only you and the ticket opener can send messages.`, ephemeral: true });

        // update the ticket message to indicate claimed status (edit first pinned or previous message if bot message found)
        try {
          const messages = await channel.messages.fetch({ limit: 20 });
          const botMsg = messages.find(m => m.author.id === client.user.id && m.components.length > 0);
          if (botMsg) {
            const embed = EmbedBuilder.from(botMsg.embeds[0] || {}).setFooter({ text: `Claimed by ${interaction.user.tag}` });
            await botMsg.edit({ embeds: [embed], components: botMsg.components });
          }
        } catch (err) {
          // ignore
        }

        return;
      }

      // Close: format close_<type>_<number>
      if (id.startsWith('close_')) {
        await interaction.deferReply({ ephemeral: true });
        const channel = interaction.channel;
        if (!channel || !channel.isTextBased()) { await interaction.editReply('Close must be used inside a ticket channel.'); return; }

        // gather messages for transcript
        let allMessages = [];
        try {
          let fetched = await channel.messages.fetch({ limit: 100 });
          allMessages = fetched.sort((a,b)=>a.createdTimestamp - b.createdTimestamp).map(m => {
            const time = new Date(m.createdTimestamp).toLocaleString();
            return `[${time}] ${m.author.tag}: ${m.content}${m.attachments.size ? ` [${m.attachments.map(a=>a.url).join(', ')}]` : ''}`;
          });
        } catch (err) {
          console.warn('Failed to fetch messages for transcript', err);
        }

        const transcriptText = allMessages.join('\n') || 'No messages in transcript.';
        const transcriptName = `transcript-${channel.id}.txt`;
        const transcriptPath = path.join(TRANSCRIPTS_DIR, transcriptName);
        fs.writeFileSync(transcriptPath, transcriptText, 'utf8');

        // send transcript file to transcript log channel if configured, else attach here
        if (CONFIG.transcriptLogChannel) {
          const logCh = channel.guild.channels.cache.get(CONFIG.transcriptLogChannel);
          if (logCh && logCh.isTextBased()) {
            await logCh.send({ content: `Transcript for ${channel.name}`, files: [transcriptPath] }).catch(()=>{});
          }
        } else {
          await channel.send({ content: `Transcript generated and attached:`, files: [transcriptPath] }).catch(()=>{});
        }

        // lock the channel: deny SEND_MESSAGES for @everyone and for roles that had send perms
        try {
          // Deny everyone send
          await channel.permissionOverwrites.edit(channel.guild.id, { ViewChannel: true, SendMessages: false }).catch(()=>{});

          // Deny all roles (we'll set view true but send false for roles that exist in overwrites)
          if (channel.parent && channel.parent.permissionOverwrites) {
            for (const [targetId, overwrite] of channel.parent.permissionOverwrites.cache) {
              if (targetId === channel.guild.id) continue;
              const isRole = channel.guild.roles.cache.has(targetId);
              if (isRole) {
                await channel.permissionOverwrites.edit(targetId, {
                  ViewChannel: true,
                  SendMessages: false
                }).catch(()=>{});
              }
            }
          }

          // keep ticket owner & claimer allowed to view (but send denied unless claimer)
          const topic = channel.topic || '';
          const authorMatch = topic.match(/Created by: .* \((\d+)\)/);
          if (authorMatch && authorMatch[1]) {
            await channel.permissionOverwrites.edit(authorMatch[1], {
              ViewChannel: true,
              SendMessages: false
            }).catch(()=>{});
          }
        } catch (err) {
          console.warn('Error locking channel on close:', err);
        }

        // rename channel to closed-...
        try {
          const newName = `closed-${channel.name}`;
          await channel.setName(newName).catch(()=>{});
        } catch (err) {}

        await interaction.editReply({ content: 'Ticket closed and transcript saved.', ephemeral: true });
        return;
      }
    }
  } catch (err) {
    console.error('InteractionCreate error:', err);
    try { if (interaction.deferred) await interaction.editReply({ content: 'An error occurred.' }); } catch {}
  }
});

// A simple slash command to post the support embed (so you can run /post-support to output it)
// We'll register a single application command on ready (guild-only for quicker)
client.on('ready', async () => {
  // register a guild command in the first available guild the bot is in (helpful for testing)
  try {
    const g = client.guilds.cache.first();
    if (g) {
      await g.commands.create({
        name: 'post-support',
        description: 'Post the support embed with ticket buttons'
      });
      console.log('Registered /post-support command in guild:', g.id);
    }
  } catch (err) { console.warn('Failed to register command:', err); }
});

// Handle slash command interaction
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'post-support') {
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
      await interaction.reply({ content: 'Bot needs Manage Channels permission to post.', ephemeral: true });
      return;
    }
    const payload = buildSupportMessage();
    await interaction.reply({ content: 'Support message posted.', ephemeral: true });
    await interaction.channel.send(payload);
  }
});

client.login(process.env.DISCORD_TOKEN);
