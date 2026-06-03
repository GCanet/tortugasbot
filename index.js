require('dotenv').config();
const {
  Client, GatewayIntentBits, ChannelType, EmbedBuilder,
  ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ButtonBuilder, ButtonStyle,
} = require('discord.js');
const bossData = require('./bosses.json');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// ─── Channel IDs ───────────────────────────────────────────────────────────
const MVP_CHANNEL_ID          = process.env.MVP_CHANNEL_ID;
const MARKET_CHANNEL_ID       = process.env.MARKET_CHANNEL_ID;
const GUILDCHAT_CHANNEL_ID    = process.env.GUILDCHAT_CHANNEL_ID;
const INSTANCES_FORUM_CHANNEL_ID = process.env.INSTANCES_FORUM_CHANNEL_ID;

// ─── Shared config ─────────────────────────────────────────────────────────
const SERVER_HEALTH_URL = process.env.SERVER_HEALTH_URL || 'https://revenantelegy.com/api/v1.0/serverhealth/';
const LAUNCH_TIMESTAMP  = Math.floor(new Date('2026-06-12T19:00:00Z').getTime() / 1000);

async function fetchServerHealth() {
  const res = await fetch(SERVER_HEALTH_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function statusIcon(online) {
  return online ? '🟢 Online' : '🔴 Offline';
}

// ═══════════════════════════════════════════════════════════════════════════
//  MVP BOT
// ═══════════════════════════════════════════════════════════════════════════

const MVP_LEGEND = [
  '`<boss name>` — register kill & start timer',
  '`!current` — list all active timers',
  '`!remove <name>` — delete a timer',
  '`!edit <name>` — reset kill time to now',
].join('\n');

// ─── Build boss lookup ─────────────────────────────────────────────────────
const bossLookup = new Map();

function mvpNormalize(str) {
  return str.toLowerCase().trim().replace(/\s+/g, ' ');
}

for (const boss of bossData.bosses) {
  const keys = [mvpNormalize(boss.bossName), ...boss.alias.map(mvpNormalize)];
  for (const key of keys) {
    if (!bossLookup.has(key)) bossLookup.set(key, []);
    bossLookup.get(key).push(boss);
  }
}

const activeTimers  = new Map();
const pendingDisambig = new Map();

function formatHp(hp) { return hp.toLocaleString(); }

function buildTimerEmbed(boss, killTime, minSpawn, maxSpawn) {
  const killTs = Math.floor(killTime / 1000);
  const minTs  = Math.floor(minSpawn / 1000);
  const maxTs  = Math.floor(maxSpawn / 1000);

  return new EmbedBuilder()
    .setTitle(`☠️ ${boss.bossName} :tortugas:`)
    .setColor(0xe74c3c)
    .setThumbnail(`https://static.divine-pride.net/images/mobs/png/${boss.ID}.png`)
    .addFields(
      { name: '📍 Map',        value: boss.location || 'Unknown',                        inline: true  },
      { name: '⚔️ Killed at',  value: `<t:${killTs}:T>`,                                 inline: true  },
      { name: '\u200B',        value: '\u200B',                                           inline: true  },
      { name: '🔁 Min Spawn',  value: `<t:${minTs}:F> (<t:${minTs}:R>)`,                 inline: true  },
      { name: '🔁 Max Spawn',  value: `<t:${maxTs}:F> (<t:${maxTs}:R>)`,                 inline: true  },
      { name: '\u200B',        value: '\u200B',                                           inline: true  },
      { name: '📋 Commands',   value: MVP_LEGEND,                                         inline: false }
    )
    .setFooter({ text: `${boss.race} • ${boss.property} • HP: ${formatHp(boss.HP)} | 🐢 TORTUGAS` })
    .setTimestamp();
}

function buildCurrentListEmbed(timers) {
  const base = new EmbedBuilder()
    .setColor(0x3498db)
    .addFields({ name: '📋 Commands', value: MVP_LEGEND, inline: false });

  if (timers.length === 0) {
    return base.setTitle('📋 Current MVP Timers :tortugas:').setDescription('No active timers. Go hunt something, TORTUGAS! 🐢');
  }

  const now = Date.now();
  const lines = timers.map(({ boss, minSpawn, maxSpawn }) => {
    const minTs  = Math.floor(minSpawn / 1000);
    const maxTs  = Math.floor(maxSpawn / 1000);
    const isUp   = now >= minSpawn;
    const status = isUp ? '🟢 **UP NOW**' : `⏳ <t:${minTs}:R>`;
    return `**${boss.bossName}** (${boss.location || '?'})\n${status} — max <t:${maxTs}:t>`;
  });

  return base
    .setTitle(`📋 Current MVP Timers :tortugas: (${timers.length})`)
    .setDescription(lines.join('\n\n'));
}

function scheduleSpawnReminder(boss, minSpawn, killerId, channel) {
  const delay = minSpawn - 10 * 60 * 1000 - Date.now();
  if (delay <= 0) return null;
  return setTimeout(async () => {
    try {
      const minTs = Math.floor(minSpawn / 1000);
      const button = new ButtonBuilder()
        .setCustomId(`killed_again_${boss.bossName}_${boss.location}`)
        .setLabel('KILLED AGAIN')
        .setStyle(ButtonStyle.Danger);
      const row = new ActionRowBuilder().addComponents(button);
      await channel.send({
        content: `<@${killerId}> ⏰ **${boss.bossName}** is spawning in ~10 minutes! :tortugas:\nMap: \`${boss.location || 'Unknown'}\` — <t:${minTs}:T>`,
        components: [row],
      });
    } catch (e) {
      console.error('Failed to send reminder:', e.message);
    }
  }, delay);
}

function registerBossKill(boss, killTime, killerId, channel) {
  const key = `${boss.bossName}_${boss.location}`;
  if (activeTimers.has(key)) {
    const old = activeTimers.get(key);
    if (old.timerId) clearTimeout(old.timerId);
  }
  const minSpawn = killTime + boss.minRespawnTimeScheduleInSeconds * 1000;
  const maxSpawn = killTime + boss.maxRespawnTimeScheduleInSeconds * 1000;
  const timerId  = scheduleSpawnReminder(boss, minSpawn, killerId, channel);
  activeTimers.set(key, { boss, killTime, minSpawn, maxSpawn, killerId, timerId });
  return { minSpawn, maxSpawn };
}

function findTimerByName(query) {
  const lower = mvpNormalize(query);
  for (const [key, timer] of activeTimers.entries()) {
    if (mvpNormalize(timer.boss.bossName) === lower) return { key, timer };
    if (timer.boss.alias && timer.boss.alias.some(a => mvpNormalize(a) === lower)) return { key, timer };
  }
  for (const [key, timer] of activeTimers.entries()) {
    if (mvpNormalize(timer.boss.bossName).includes(lower)) return { key, timer };
  }
  return null;
}

async function handleMvpMessage(message) {
  const content = message.content.trim();
  const userId  = message.author.id;

  if (content.toLowerCase() === '!current') {
    const timers = Array.from(activeTimers.values()).sort((a, b) => a.minSpawn - b.minSpawn);
    return message.reply({ embeds: [buildCurrentListEmbed(timers)] });
  }

  if (content.toLowerCase().startsWith('!remove')) {
    const query = content.slice(7).trim();
    if (!query) return message.reply('❌ Usage: `!remove <boss name>`');
    const found = findTimerByName(query);
    if (!found) return message.reply(`❌ No active timer found for \`${query}\`.`);
    if (found.timer.timerId) clearTimeout(found.timer.timerId);
    activeTimers.delete(found.key);
    return message.reply(`✅ Timer for **${found.timer.boss.bossName}** removed. :tortugas:`);
  }

  if (content.toLowerCase().startsWith('!edit')) {
    const query = content.slice(5).trim();
    if (!query) return message.reply('❌ Usage: `!edit <boss name>`');
    const found = findTimerByName(query);
    if (!found) return message.reply(`❌ No active timer found for \`${query}\`. Register the kill first by typing the boss name.`);
    const { boss, killerId } = found.timer;
    if (found.timer.timerId) clearTimeout(found.timer.timerId);
    const killTime = Date.now();
    const { minSpawn, maxSpawn } = registerBossKill(boss, killTime, killerId, message.channel);
    const embed = buildTimerEmbed(boss, killTime, minSpawn, maxSpawn);
    return message.reply({ content: `✅ Timer for **${boss.bossName}** reset to now. :tortugas:`, embeds: [embed] });
  }

  // Disambiguation reply
  if (pendingDisambig.has(userId)) {
    const { matches } = pendingDisambig.get(userId);
    const choice = parseInt(content.trim());
    if (!isNaN(choice) && choice >= 1 && choice <= matches.length) {
      pendingDisambig.delete(userId);
      const boss = matches[choice - 1];
      if (!boss.minRespawnTimeScheduleInSeconds)
        return message.reply(`⚠️ **${boss.bossName}** has no standard respawn timer (instance/event boss).`);
      const killTime = message.createdTimestamp;
      const { minSpawn, maxSpawn } = registerBossKill(boss, killTime, userId, message.channel);
      return message.reply({ embeds: [buildTimerEmbed(boss, killTime, minSpawn, maxSpawn)] });
    } else {
      return message.reply(`❌ Invalid choice. Reply with a number between 1 and ${matches.length}.`);
    }
  }

  // Boss name detection
  const lower = mvpNormalize(content);
  let matches = bossLookup.get(lower) || [];

  if (matches.length === 0) {
    for (const [key, bosses] of bossLookup.entries()) {
      if (key.includes(lower) || lower.includes(key)) matches = matches.concat(bosses);
    }
    const seen = new Set();
    matches = matches.filter((b) => {
      const k = `${b.bossName}_${b.location}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  if (matches.length === 0) return;

  if (matches.length === 1) {
    const boss = matches[0];
    if (!boss.minRespawnTimeScheduleInSeconds)
      return message.reply(`⚠️ **${boss.bossName}** has no standard respawn timer (instance/event boss).`);
    const killTime = message.createdTimestamp;
    const { minSpawn, maxSpawn } = registerBossKill(boss, killTime, userId, message.channel);
    return message.reply({ embeds: [buildTimerEmbed(boss, killTime, minSpawn, maxSpawn)] });
  }

  // Disambiguation
  pendingDisambig.set(userId, { matches });
  setTimeout(() => pendingDisambig.delete(userId), 60000);
  const options = matches.map((b, i) => `\`${i + 1}\` — **${b.bossName}** (${b.location || 'unknown map'})`).join('\n');
  return message.reply(`🤔 Multiple bosses found for **"${content}"**. Which one died, TORTUGAS? :tortugas:\n\n${options}\n\nReply with the number.`);
}

// ═══════════════════════════════════════════════════════════════════════════
//  INSTANCE BOT
// ═══════════════════════════════════════════════════════════════════════════

const PARTY_SIZE = 14;
const reminderTimers = new Map();

const INSTANCE_TEMPLATES = {
  ifirth: {
    fullName: 'Ifrit',
    slots: [
      { role: 'MENTAL',   player: null, userId: null },
      { role: 'SNIPER 1', player: null, userId: null },
      { role: 'SNIPER 2', player: null, userId: null },
      { role: 'DEVO',     player: null, userId: null },
      { role: 'HW',       player: null, userId: null },
      { role: 'PROF',     player: null, userId: null },
      { role: 'CHEM DD',  player: null, userId: null },
      { role: 'GYPSY',    player: null, userId: null },
      { role: 'CLOWN',    player: null, userId: null },
      { role: 'LINKER',   player: null, userId: null },
      { role: 'HP 1',     player: null, userId: null },
      { role: 'HP 2',     player: null, userId: null },
      { role: 'FILL SPOT',player: null, userId: null },
      { role: 'FILL SPOT',player: null, userId: null },
    ],
    hasFillSpots: true,
  },
  valk: {
    fullName: 'Valkyrie Randgris',
    slots: [
      { role: 'MENTAL',   player: null, userId: null },
      { role: 'SNIPER 1', player: null, userId: null },
      { role: 'SNIPER 2', player: null, userId: null },
      { role: 'DEVO',     player: null, userId: null },
      { role: 'HW',       player: null, userId: null },
      { role: 'PROF',     player: null, userId: null },
      { role: 'CHEM DD',  player: null, userId: null },
      { role: 'GYPSY',    player: null, userId: null },
      { role: 'CLOWN',    player: null, userId: null },
      { role: 'LINKER',   player: null, userId: null },
      { role: 'HP 1',     player: null, userId: null },
      { role: 'HP 2',     player: null, userId: null },
      { role: 'FILL SPOT',player: null, userId: null },
      { role: 'FILL SPOT',player: null, userId: null },
    ],
    hasFillSpots: true,
  },
  bio3: {
    fullName: 'Biolabs 3',
    slots: [
      { role: 'CHEM DD',  player: null, userId: null },
      { role: 'HW',       player: null, userId: null },
      { role: 'SNIPER',   player: null, userId: null },
      { role: 'PALA',     player: null, userId: null },
      { role: 'CLOWN',    player: null, userId: null },
      { role: 'PROF',     player: null, userId: null },
      { role: 'HP',       player: null, userId: null },
      { role: 'FILL SPOT',player: null, userId: null },
      { role: 'FILL SPOT',player: null, userId: null },
      { role: 'FILL SPOT',player: null, userId: null },
      { role: 'FILL SPOT',player: null, userId: null },
      { role: 'FILL SPOT',player: null, userId: null },
      { role: 'FILL SPOT',player: null, userId: null },
      { role: 'FILL SPOT',player: null, userId: null },
    ],
    hasFillSpots: true,
  },
  et: {
    fullName: 'Endless Tower',
    slots: [
      { role: 'MENTAL',   player: null, userId: null },
      { role: 'SNIPER 1', player: null, userId: null },
      { role: 'SNIPER 2', player: null, userId: null },
      { role: 'DEVO',     player: null, userId: null },
      { role: 'HW',       player: null, userId: null },
      { role: 'PROF',     player: null, userId: null },
      { role: 'CHEM DD',  player: null, userId: null },
      { role: 'GYPSY',    player: null, userId: null },
      { role: 'CLOWN',    player: null, userId: null },
      { role: 'LINKER',   player: null, userId: null },
      { role: 'HP 1',     player: null, userId: null },
      { role: 'HP 2',     player: null, userId: null },
      { role: 'FILL SPOT',player: null, userId: null },
      { role: 'FILL SPOT',player: null, userId: null },
    ],
    hasFillSpots: true,
  },
  'sealed shrine': {
    fullName: 'Sealed Shrine',
    slots: [
      { role: 'MENTAL',   player: null, userId: null },
      { role: 'SNIPER 1', player: null, userId: null },
      { role: 'SNIPER 2', player: null, userId: null },
      { role: 'DEVO',     player: null, userId: null },
      { role: 'HW',       player: null, userId: null },
      { role: 'PROF',     player: null, userId: null },
      { role: 'CHEM DD',  player: null, userId: null },
      { role: 'GYPSY',    player: null, userId: null },
      { role: 'CLOWN',    player: null, userId: null },
      { role: 'LINKER',   player: null, userId: null },
      { role: 'HP 1',     player: null, userId: null },
      { role: 'HP 2',     player: null, userId: null },
      { role: 'FILL SPOT',player: null, userId: null },
      { role: 'FILL SPOT',player: null, userId: null },
    ],
    hasFillSpots: true,
  },
  bee: {
    fullName: 'Beelzebub',
    slots: [
      { role: 'MENTAL',   player: null, userId: null },
      { role: 'SNIPER 1', player: null, userId: null },
      { role: 'SNIPER 2', player: null, userId: null },
      { role: 'DEVO',     player: null, userId: null },
      { role: 'HW',       player: null, userId: null },
      { role: 'PROF',     player: null, userId: null },
      { role: 'CHEM DD',  player: null, userId: null },
      { role: 'GYPSY',    player: null, userId: null },
      { role: 'CLOWN',    player: null, userId: null },
      { role: 'LINKER',   player: null, userId: null },
      { role: 'HP 1',     player: null, userId: null },
      { role: 'HP 2',     player: null, userId: null },
      { role: 'FILL SPOT',player: null, userId: null },
      { role: 'FILL SPOT',player: null, userId: null },
    ],
    hasFillSpots: true,
  },
  captain: {
    fullName: 'Ghost Ship Captain',
    slots: [
      { role: 'FA 1',     player: null, userId: null },
      { role: 'FA 2',     player: null, userId: null },
      { role: 'FA 3',     player: null, userId: null },
      { role: 'FA 4',     player: null, userId: null },
      { role: 'FA 5',     player: null, userId: null },
      { role: 'CHAMP',    player: null, userId: null },
      { role: 'PROF',     player: null, userId: null },
      { role: 'CLOWN',    player: null, userId: null },
      { role: 'LINKER',   player: null, userId: null },
      { role: 'LINKER',   player: null, userId: null },
      { role: 'HP 1',     player: null, userId: null },
      { role: 'HP 2',     player: null, userId: null },
      { role: 'FILL SPOT',player: null, userId: null },
      { role: 'FILL SPOT',player: null, userId: null },
    ],
    hasFillSpots: true,
  },
  open: {
    fullName: 'Open Party',
    slots: Array.from({ length: 14 }, () => ({ role: 'FILL SPOT', player: null, userId: null })),
    hasFillSpots: true,
  },
  party: {
    fullName: 'Custom Party',
    slots: [
      { role: 'MOBBER',     player: null, userId: null },
      { role: 'MOBBER',     player: null, userId: null },
      { role: 'MOBBER',     player: null, userId: null },
      { role: 'MOBBER',     player: null, userId: null },
      { role: 'CLOWN',      player: null, userId: null },
      { role: 'GYPSY',      player: null, userId: null },
      { role: 'HP',         player: null, userId: null },
      { role: 'HP',         player: null, userId: null },
      { role: 'HW',         player: null, userId: null },
      { role: 'ICEBREAKER', player: null, userId: null },
      { role: 'FILL SPOT',  player: null, userId: null },
      { role: 'FILL SPOT',  player: null, userId: null },
      { role: 'FILL SPOT',  player: null, userId: null },
      { role: 'FILL SPOT',  player: null, userId: null },
    ],
    hasFillSpots: true,
  },
};

const INSTANCE_ALIASES = {
  ifrith: 'ifirth', ifrit: 'ifirth', ifirth: 'ifirth',
  valkyrie: 'valk', valk: 'valk', 'valkyrie randgris': 'valk',
  biolabs: 'bio3', bio3: 'bio3', 'biolabs 3': 'bio3',
  'endless tower': 'et', et: 'et',
  'sealed shrine': 'sealed shrine', ss: 'sealed shrine',
  beelzebub: 'bee', bee: 'bee',
  captain: 'captain', 'ghost ship': 'captain', 'ghost ship captain': 'captain',
  open: 'open', 'open party': 'open',
};

const activeInstances = new Map();

function deepCopySlots(slots) { return slots.map((s) => ({ ...s })); }

function resolveInstanceKey(input) {
  return INSTANCE_ALIASES[input.toLowerCase().trim()] || null;
}

function getDefaultFridayHour() {
  const now = new Date();
  const currentDay = now.getUTCDay();
  let friday = new Date(now);
  if (currentDay === 5) {
    friday.setUTCHours(22, 0, 0, 0);
    if (now < friday) return Math.floor(friday.getTime() / 1000);
  }
  const daysToAdd = currentDay <= 5 ? 5 - currentDay : 12 - currentDay;
  friday.setUTCDate(friday.getUTCDate() + daysToAdd);
  friday.setUTCHours(22, 0, 0, 0);
  return Math.floor(friday.getTime() / 1000);
}

function buildPartyEmbed(instanceKey, slots, hour, creatorId) {
  const tpl    = INSTANCE_TEMPLATES[instanceKey];
  const filled = slots.filter((s) => s.player !== null).length;
  const isFull = filled === PARTY_SIZE;

  const lines = slots.map((s, i) => {
    const num    = `\`${String(i + 1).padStart(2, '0')}.\``;
    const player = s.player ? `<@${s.userId}>` : '—';
    return `${num} **${s.role}**: ${player}`;
  });

  const commands = [
    '`$clear <number>` — (creator) clear a slot',
    '`$rename <number> <name>` — (creator) rename a slot',
    '`$hournew <unix_timestamp>` — set instance time',
    '`$hour help` for info',
    '`!repost` — repost current setup',
    '↕️ Use the **dropdown below** to pick your role',
  ].join('\n');

  const embed = new EmbedBuilder()
    .setTitle(`${tpl.fullName} Party :tortugas:${isFull ? ' ✅ FULL' : ''}`)
    .setColor(isFull ? 0x00ff00 : 0x5865f2)
    .setDescription(lines.join('\n'))
    .addFields(
      { name: 'Spots',      value: `${filled}/${PARTY_SIZE}`, inline: true },
      { name: 'Created by', value: `<@${creatorId}>`,         inline: true }
    );

  if (hour) {
    embed.addFields({
      name: '🕐 Instance Time',
      value: `<t:${hour}:F> (<t:${hour}:R>)`,
      inline: false,
    });
  }

  embed.addFields({ name: '📋 Commands', value: commands });
  return embed;
}

function buildDropdown(instanceKey, slots) {
  const options = slots.map((s, i) => {
    const taken = s.player !== null;
    const label = `${String(i + 1).padStart(2, '0')}. ${s.role}${taken ? ` (${s.player})` : ''}`;
    return new StringSelectMenuOptionBuilder()
      .setLabel(label.slice(0, 100))
      .setValue(String(i))
      .setDescription(taken ? `Taken by ${s.player}` : 'Available')
      .setEmoji(taken ? '🔴' : '🟢');
  });
  const menu = new StringSelectMenuBuilder()
    .setCustomId('instance_signup')
    .setPlaceholder('Select a role to sign up...')
    .addOptions(options);
  return new ActionRowBuilder().addComponents(menu);
}

function buildSignOutButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('instance_signout')
      .setLabel('Sign Out')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🚪')
  );
}

function getRegisteredMentions(slots) {
  return slots.filter(s => s.userId).map(s => `<@${s.userId}>`).join(' ');
}

function scheduleReminders(thread, state) {
  if (!state.hour) return;
  const existing = reminderTimers.get(thread.id);
  if (existing) existing.forEach(t => clearTimeout(t));
  const now      = Date.now();
  const eventMs  = state.hour * 1000;
  const reminders = [];

  const firstDelay = (eventMs - 24 * 60 * 60 * 1000) - now;
  if (firstDelay > 0) {
    reminders.push(setTimeout(async () => {
      try {
        const mentions = getRegisteredMentions(state.slots);
        await thread.send(`⏰ Tomorrow instance at <t:${state.hour}:F> :tortugas:\n${mentions}`);
      } catch (e) { console.error('24h reminder failed:', e); }
    }, firstDelay));
  }

  const secondDelay = (eventMs - 10 * 60 * 1000) - now;
  if (secondDelay > 0) {
    reminders.push(setTimeout(async () => {
      try {
        const mentions = getRegisteredMentions(state.slots);
        await thread.send(`🔥 It's time to log in, TORTUGAS! :tortugas:\n${mentions}`);
      } catch (e) { console.error('10m reminder failed:', e); }
    }, secondDelay));
  }

  reminderTimers.set(thread.id, reminders);
}

async function updateMainMessage(thread, state) {
  try {
    const msg      = await thread.messages.fetch(state.mainMessageId);
    const dropdown = buildDropdown(state.instanceKey, state.slots);
    const signout  = buildSignOutButton();
    await msg.edit({
      embeds:     [buildPartyEmbed(state.instanceKey, state.slots, state.hour, state.creatorId)],
      components: [dropdown, signout],
    });
  } catch (e) {
    console.error('Failed to update main message:', e.message);
  }
}

function findSlotByRole(slots, roleInput) {
  const lower = roleInput.toLowerCase().replace(/\s+/g, '');
  for (let i = 0; i < slots.length; i++) {
    if (slots[i].role.toLowerCase().replace(/\s+/g, '') === lower) return i;
  }
  return -1;
}

async function handleInstanceCommand(message) {
  const content = message.content.trim();

  if (content.toLowerCase() === '!launch') {
    return message.reply(
      `🚀 **Revenant Elegy Launch** :tortugas:\n📅 <t:${LAUNCH_TIMESTAMP}:F>\n⏳ <t:${LAUNCH_TIMESTAMP}:R>`
    );
  }

  if (content.toLowerCase() === '!server') {
    try {
      const health = await fetchServerHealth();
      return message.reply(
        `**🖥️ Server Status** :tortugas:\n` +
        `Login: ${statusIcon(health.login)} | Char: ${statusIcon(health.char)} | Map: ${statusIcon(health.map)}\n` +
        `👥 Players online: **${health.count}** (${health.unique} unique, ${health.multiclients} multiclient)\n` +
        `🛒 Autotraders/merchants: **${health.autotraders}**`
      );
    } catch (e) {
      return message.reply('❌ Could not reach the server health API.');
    }
  }

  if (content.toLowerCase() === '!players') {
    try {
      const health = await fetchServerHealth();
      return message.reply(
        `👥 **Players online:** ${health.count} (${health.unique} unique, ${health.multiclients} multiclient)\n` +
        `🛒 **Autotraders/merchants:** ${health.autotraders} :tortugas:`
      );
    } catch (e) {
      return message.reply('❌ Could not reach the server health API.');
    }
  }

  if (content.toLowerCase().startsWith('!instance')) {
    const args = content.slice('!instance'.length).trim();
    if (!args) {
      return message.reply('❌ Available: `ifirth`, `valk`, `bio3`, `et`, `sealed shrine`, `bee`, `captain`, `open` :tortugas:');
    }

    const instanceKey = resolveInstanceKey(args);

    if (!instanceKey) {
      // Free-text instance name
      let forumChannel;
      try { forumChannel = await client.channels.fetch(INSTANCES_FORUM_CHANNEL_ID); }
      catch (e) { return message.reply('❌ Could not find the forum channel.'); }
      if (forumChannel.type !== ChannelType.GuildForum)
        return message.reply('❌ INSTANCES_FORUM_CHANNEL_ID is not a forum channel.');

      const slots       = Array.from({ length: 14 }, () => ({ role: 'FILL SPOT', player: null, userId: null }));
      const defaultHour = getDefaultFridayHour();
      const freeKey     = '__freetext__';
      if (!INSTANCE_TEMPLATES[freeKey]) INSTANCE_TEMPLATES[freeKey] = { fullName: args, slots: [], hasFillSpots: true };
      INSTANCE_TEMPLATES[freeKey].fullName = args;

      const embed    = buildPartyEmbed(freeKey, slots, defaultHour, message.author.id);
      const dropdown = buildDropdown(freeKey, slots);
      const signout  = buildSignOutButton();

      let thread;
      try {
        thread = await forumChannel.threads.create({
          name: args,
          message: { embeds: [embed], components: [dropdown, signout] },
        });
      } catch (e) { console.error(e); return message.reply('❌ Failed to create thread.'); }

      const firstMessage = await thread.fetchStarterMessage();
      const instanceState = { instanceKey: freeKey, slots, creatorId: message.author.id, hour: defaultHour, mainMessageId: firstMessage.id };
      activeInstances.set(thread.id, instanceState);
      scheduleReminders(thread, instanceState);
      return message.reply(`✅ Party thread created :tortugas: ${thread.url}`);
    }

    const tpl = INSTANCE_TEMPLATES[instanceKey];
    let forumChannel;
    try { forumChannel = await client.channels.fetch(INSTANCES_FORUM_CHANNEL_ID); }
    catch (e) { return message.reply('❌ Could not find the forum channel.'); }
    if (forumChannel.type !== ChannelType.GuildForum)
      return message.reply('❌ INSTANCES_FORUM_CHANNEL_ID is not a forum channel.');

    const slots       = deepCopySlots(tpl.slots);
    const defaultHour = getDefaultFridayHour();
    const embed       = buildPartyEmbed(instanceKey, slots, defaultHour, message.author.id);
    const dropdown    = buildDropdown(instanceKey, slots);
    const signout     = buildSignOutButton();

    let thread;
    try {
      thread = await forumChannel.threads.create({
        name: tpl.fullName,
        message: { embeds: [embed], components: [dropdown, signout] },
      });
    } catch (e) { console.error(e); return message.reply('❌ Failed to create thread.'); }

    const firstMessage  = await thread.fetchStarterMessage();
    const instanceState = { instanceKey, slots, creatorId: message.author.id, hour: defaultHour, mainMessageId: firstMessage.id };
    activeInstances.set(thread.id, instanceState);
    scheduleReminders(thread, instanceState);
    return message.reply(`✅ Instance thread created :tortugas: ${thread.url}`);
  }

  if (content.toLowerCase().startsWith('!party')) {
    const args = content.slice('!party'.length).trim();
    if (!args) return message.reply('❌ Usage: `!party <name>`');

    let forumChannel;
    try { forumChannel = await client.channels.fetch(INSTANCES_FORUM_CHANNEL_ID); }
    catch (e) { return message.reply('❌ Could not find the forum channel.'); }
    if (forumChannel.type !== ChannelType.GuildForum)
      return message.reply('❌ INSTANCES_FORUM_CHANNEL_ID is not a forum channel.');

    const slots       = deepCopySlots(INSTANCE_TEMPLATES.party.slots);
    const defaultHour = getDefaultFridayHour();
    const embed       = buildPartyEmbed('party', slots, defaultHour, message.author.id);
    const dropdown    = buildDropdown('party', slots);
    const signout     = buildSignOutButton();

    let thread;
    try {
      thread = await forumChannel.threads.create({
        name: args,
        message: { embeds: [embed], components: [dropdown, signout] },
      });
    } catch (e) { console.error(e); return message.reply('❌ Failed to create thread.'); }

    const firstMessage  = await thread.fetchStarterMessage();
    const instanceState = { instanceKey: 'party', slots, creatorId: message.author.id, hour: defaultHour, mainMessageId: firstMessage.id };
    activeInstances.set(thread.id, instanceState);
    scheduleReminders(thread, instanceState);
    return message.reply(`✅ Party thread created :tortugas: ${thread.url}`);
  }
}

async function handleThreadMessage(message) {
  const content  = message.content.trim();
  const thread   = message.channel;
  const state    = activeInstances.get(thread.id);
  if (!state) return;

  const { slots, instanceKey, creatorId } = state;
  const tpl      = INSTANCE_TEMPLATES[instanceKey];
  const userId   = message.author.id;
  const username = message.member?.displayName || message.author.username;

  if (content.toLowerCase() === '!repost') {
    const dropdown = buildDropdown(state.instanceKey, state.slots);
    const signout  = buildSignOutButton();
    return thread.send({
      embeds:     [buildPartyEmbed(state.instanceKey, state.slots, state.hour, state.creatorId)],
      components: [dropdown, signout],
    });
  }

  if (content.toLowerCase() === '$hour help') {
    return message.reply(
      '**How to set the instance time:**\n' +
      'Get a Unix timestamp at https://www.unixtimestamp.com\n' +
      'Then type: `$hournew <timestamp>`'
    );
  }

  if (content.toLowerCase().startsWith('$hournew')) {
    if (userId !== creatorId) return message.reply('❌ Only the instance creator can change the time.');
    const ts = parseInt(content.split(/\s+/)[1]);
    if (isNaN(ts)) return message.reply('❌ Invalid timestamp.');
    state.hour = ts;
    scheduleReminders(thread, state);
    await updateMainMessage(thread, state);
    return message.reply(`✅ Instance time set to <t:${ts}:F> :tortugas:`);
  }

  if (content.toLowerCase() === '$out') {
    const idx = slots.findIndex(s => s.userId === userId);
    if (idx === -1) return message.reply("❌ You're not signed up.");
    slots[idx].player = null;
    slots[idx].userId = null;
    await updateMainMessage(thread, state);
    return message.reply(`✅ ${username} removed from slot ${idx + 1}. :tortugas:`);
  }

  if (content.toLowerCase().startsWith('$clear')) {
    if (userId !== creatorId) return message.reply('❌ Only the instance creator can clear slots.');
    const num = parseInt(content.split(/\s+/)[1]);
    if (isNaN(num) || num < 1 || num > PARTY_SIZE)
      return message.reply(`❌ Invalid slot number (1-${PARTY_SIZE}).`);
    const idx = num - 1;
    const was = slots[idx].player;
    slots[idx].player = null;
    slots[idx].userId = null;
    await updateMainMessage(thread, state);
    return message.reply(`✅ Cleared slot ${num}${was ? ` (was ${was})` : ''}. :tortugas:`);
  }

  if (content.toLowerCase() === '$fill') {
    if (!tpl.hasFillSpots) return message.reply('❌ This instance has no fill spots.');
    const fillIdx = slots.findIndex(s => s.role === 'FILL SPOT' && s.player === null);
    if (fillIdx === -1) return message.reply('❌ All fill spots are taken!');
    const existing = slots.findIndex(s => s.userId === userId);
    if (existing !== -1) return message.reply(`❌ You're already in slot ${existing + 1}.`);
    slots[fillIdx].player = username;
    slots[fillIdx].userId = userId;
    await updateMainMessage(thread, state);
    const filled = slots.filter(s => s.player !== null).length;
    let reply = `✅ Signed up as **FILL SPOT** (slot ${fillIdx + 1}). :tortugas:`;
    if (filled === PARTY_SIZE) {
      reply += '\n🎉 Party is full!';
      await thread.send('🎉 Party is now full! :tortugas:');
    }
    return message.reply(reply);
  }

  if (content.toLowerCase().startsWith('$swap')) {
    const swapArg   = content.slice(5).trim().replace(/^\$/, '');
    if (!swapArg) return message.reply('❌ Usage: `$swap $job` or `$swap $number`');
    const existingIdx = slots.findIndex(s => s.userId === userId);
    if (existingIdx === -1) return message.reply("❌ You're not signed up yet.");
    let targetIdx = parseInt(swapArg);
    if (isNaN(targetIdx)) { targetIdx = findSlotByRole(slots, swapArg); }
    else { targetIdx -= 1; }
    if (targetIdx < 0 || targetIdx >= PARTY_SIZE) return message.reply('❌ Invalid slot.');
    if (slots[targetIdx].player !== null && slots[targetIdx].userId !== userId)
      return message.reply(`❌ Slot ${targetIdx + 1} is taken.`);
    slots[existingIdx].player = null;
    slots[existingIdx].userId = null;
    slots[targetIdx].player   = username;
    slots[targetIdx].userId   = userId;
    await updateMainMessage(thread, state);
    return message.reply(`✅ Moved to slot ${targetIdx + 1} (**${slots[targetIdx].role}**). :tortugas:`);
  }

  if (content.toLowerCase().startsWith('$rename')) {
    if (userId !== creatorId) return message.reply('❌ Only the instance creator can rename slots.');
    const parts   = content.split(/\s+/);
    const num     = parseInt(parts[1]);
    const newName = parts.slice(2).join(' ').toUpperCase().trim();
    if (isNaN(num) || num < 1 || num > PARTY_SIZE)
      return message.reply(`❌ Invalid slot number (1-${PARTY_SIZE}).`);
    if (!newName) return message.reply('❌ Usage: `$rename <slot number> <new name>`');
    if (newName.length > 20) return message.reply('❌ Name too long (max 20 characters).');
    const idx = num - 1;
    slots[idx].role = newName;
    await updateMainMessage(thread, state);
    return message.reply(`✅ Slot ${num} renamed to **${newName}**. :tortugas:`);
  }

  if (content.startsWith('$')) {
    const arg = content.slice(1).trim().toLowerCase();
    if (!arg) return;
    const filledCount = slots.filter(s => s.player !== null).length;
    if (filledCount === PARTY_SIZE) return message.reply('❌ The party is full!');
    const existingIdx = slots.findIndex(s => s.userId === userId);
    let targetIdx     = parseInt(arg);
    if (!isNaN(targetIdx)) { targetIdx -= 1; }
    else { targetIdx = findSlotByRole(slots, arg); }
    if (targetIdx < 0 || targetIdx >= PARTY_SIZE) return message.reply('❌ Invalid slot/role.');
    if (slots[targetIdx].role === 'FILL SPOT') return message.reply('❌ Use `$fill` for fill spots.');
    if (slots[targetIdx].player !== null && slots[targetIdx].userId !== userId)
      return message.reply(`❌ Slot taken by <@${slots[targetIdx].userId}>.`);
    if (existingIdx !== -1 && existingIdx !== targetIdx) {
      slots[existingIdx].player = null;
      slots[existingIdx].userId = null;
    }
    slots[targetIdx].player = username;
    slots[targetIdx].userId = userId;
    await updateMainMessage(thread, state);
    const newFilled = slots.filter(s => s.player !== null).length;
    let reply = `✅ Signed up as **${slots[targetIdx].role}** (slot ${targetIdx + 1}). :tortugas:`;
    if (newFilled === PARTY_SIZE) {
      reply += '\n🎉 Party is full!';
      await thread.send('🎉 The party is now full! :tortugas:');
    }
    return message.reply(reply);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  MARKET BOT
// ═══════════════════════════════════════════════════════════════════════════

const BASE_URL        = 'https://revenantelegy.com/api/v1.0/market';
const DB_URL          = 'https://revenantelegy.com/api/v1.0';
const ITEM_PAGE_BASE  = 'https://revenantelegy.com/market/item';
const DB_ITEM_PAGE_BASE = 'https://revenantelegy.com/database/item';
const SCAN_INTERVAL_MS  = (parseInt(process.env.SCAN_INTERVAL_MINUTES) || 15) * 60 * 1000;
const DEAL_THRESHOLD    = 0.10; // 90% off

const MARKET_LEGEND = [
  '`$ws <name or id>` — who sells (accepts options)',
  '`$ph <name or id>` — historical pricing',
  '`$ii <name or id>` — item info',
  '`$wd <name or id>` — who drops this item',
  '`$mi <name or id>` — monster info',
  '`$ol` — list all random option IDs & names',
].join('\n');

const OPTION_MAP = {
  1: 'HP', 2: 'SP', 3: 'STR', 4: 'AGI', 5: 'VIT', 6: 'INT', 7: 'DEX', 8: 'LUK',
  16: 'ASPD %', 17: 'ATK', 18: 'HIT', 19: 'MATK', 20: 'DEF', 21: 'MDEF',
  23: 'Perfect Dodge', 24: 'Crit Chance', 164: '% Crit Damage',
  168: 'Healing Effectiveness', 170: 'Cast Time Reduction', 171: 'After Cast Delay',
  255: 'Freeze Resist', 256: 'Stone Curse Resist', 172: 'SP Consumption',
  150: '% Resist Boss', 167: '% Resist Long Range', 193: '% Resist All Elements',
  257: '% Resist All Sizes', 258: '% Resist All Races',
  160: '% Resist Small', 161: '% Resist Medium', 162: '% Resist Large',
  25: '% Resist Neutral Element', 26: '% Resist Water Element', 27: '% Resist Earth Element',
  28: '% Resist Fire Element', 29: '% Resist Wind Element', 30: '% Resist Poison Element',
  31: '% Resist Holy Element', 32: '% Resist Shadow Element', 33: '% Resist Ghost Element',
  87: '% Resist Formless Race', 88: '% Resist Undead Race', 89: '% Resist Brute Race',
  90: '% Resist Plant Race', 91: '% Resist Insect Race', 92: '% Resist Fish Race',
  93: '% Resist Demon Race', 94: '% Resist Demi-Human Race', 95: '% Resist Angel Race',
  96: '% Resist Dragon Race',
  37: '% Physical Damage to Neutral', 39: '% Physical Damage to Water',
  41: '% Physical Damage to Earth', 43: '% Physical Damage to Fire',
  45: '% Physical Damage to Wind', 47: '% Physical Damage to Poison',
  49: '% Physical Damage to Holy', 51: '% Physical Damage to Shadow',
  53: '% Physical Damage to Ghost', 55: '% Physical Damage to Undead (element)',
  57: '% Magical Damage to Neutral', 59: '% Magical Damage to Water',
  61: '% Magical Damage to Earth', 63: '% Magical Damage to Fire',
  65: '% Magical Damage to Wind', 67: '% Magical Damage to Poison',
  69: '% Magical Damage to Holy', 71: '% Magical Damage to Shadow',
  73: '% Magical Damage to Ghost', 75: '% Magical Damage to Undead (element)',
  97: '% Physical Damage to Formless', 98: '% Physical Damage to Undead (race)',
  99: '% Physical Damage to Brute', 100: '% Physical Damage to Plant',
  101: '% Physical Damage to Insect', 102: '% Physical Damage to Fish',
  103: '% Physical Damage to Demon', 104: '% Physical Damage to Demi-Human',
  105: '% Physical Damage to Angel', 106: '% Physical Damage to Dragon',
  107: '% Magical Damage to Formless', 108: '% Magical Damage to Undead (race)',
  109: '% Magical Damage to Brute', 110: '% Magical Damage to Plant',
  111: '% Magical Damage to Insect', 112: '% Magical Damage to Fish',
  113: '% Magical Damage to Demon', 114: '% Magical Damage to Demi-Human',
  115: '% Magical Damage to Angel', 116: '% Magical Damage to Dragon',
  279: '% Incoming Healing', 280: 'Movement Speed',
};

const OPTION_ALIASES = {
  'hp': 1, 'sp': 2, 'str': 3, 'agi': 4, 'vit': 5, 'int': 6, 'dex': 7, 'luk': 8,
  'aspd': 16, 'atk': 17, 'hit': 18, 'matk': 19, 'def': 20, 'mdef': 21,
  'pdodge': 23, 'crit': 24, 'critdmg': 164, 'heal': 168,
  'cast': 170, 'delay': 171, 'freeze': 255, 'sc': 256, 'stone': 256,
  'spcons': 172, 'boss': 150, 'long': 167, 'allres': 193,
  'allsize': 257, 'allrace': 258, 'small': 160, 'medium': 161, 'large': 162,
};

const nameCache     = new Map();
const nameToId      = new Map();
let mobCache        = [];
let mobCacheLoaded  = false;
let mobCacheLoading = false;
let itemIndex       = new Map();
let itemNameIndex   = new Map();
let alertedDealsThisCycle = new Set();

function mNormalize(str) { return str.toLowerCase().trim(); }

function median(prices) {
  if (prices.length === 0) return 0;
  const sorted = [...prices].sort((a, b) => a - b);
  const mid    = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function formatPrice(p) {
  if (p >= 1_000_000) return `${(p / 1_000_000).toFixed(2)}M z`;
  if (p >= 1_000)     return `${(p / 1_000).toFixed(1)}k z`;
  return `${p} z`;
}

function formatDropRate(rate) { return `${(rate / 100).toFixed(2)}%`; }
function itemImageUrl(nameid)  { return `https://static.divine-pride.net/images/items/item/${nameid}.png`; }
function itemPageUrl(nameid)   { return `${ITEM_PAGE_BASE}/${nameid}`; }
function dbItemPageUrl(nameid) { return `${DB_ITEM_PAGE_BASE}/${nameid}`; }
function mobPageUrl(mobId)     { return `https://revenantelegy.com/database/monster/${mobId}`; }

function parseWsQuery(fullQuery) {
  const parts   = fullQuery.trim().split(/\s+/);
  const filters = [];
  let itemParts = [];
  for (let i = 0; i < parts.length; i++) {
    const part  = parts[i];
    const num   = parseInt(part);
    if (!isNaN(num) && OPTION_MAP[num]) {
      const value = parseInt(parts[i + 1]);
      if (!isNaN(value)) { filters.push({ id: num, value }); i++; continue; }
    }
    const aliasId = OPTION_ALIASES[mNormalize(part)];
    if (aliasId !== undefined) {
      const value = parseInt(parts[i + 1]);
      if (!isNaN(value)) { filters.push({ id: aliasId, value }); i++; continue; }
    }
    const lower = mNormalize(part);
    let found = false;
    for (const [idStr, label] of Object.entries(OPTION_MAP)) {
      if (mNormalize(label).includes(lower)) {
        const value = parseInt(parts[i + 1]);
        if (!isNaN(value)) { filters.push({ id: parseInt(idStr), value }); i++; found = true; break; }
      }
    }
    if (!found) itemParts.push(part);
  }
  return { itemQuery: itemParts.join(' '), filters };
}

function hasAllFilters(listing, targetFilters) {
  if (!targetFilters || targetFilters.length === 0) return true;
  if (!Array.isArray(listing.options) || listing.options.length === 0) return false;
  return targetFilters.every(f => listing.options.some(o => o.id === f.id && o.value >= f.value));
}

function buildListingBlock(listing, opts = {}) {
  const { nameid, item_name, medianPrice, discount, isWs = false } = opts;
  const lines = [];
  const refinePrefix  = listing.refine ? `+${listing.refine} ` : '';
  const displayName   = item_name || listing.item_name || `Item #${nameid}`;
  const url           = itemPageUrl(nameid || listing.nameid);
  lines.push(`${refinePrefix}[${displayName}](${url})`);
  if (Array.isArray(listing.cards) && listing.cards.length > 0)
    lines.push(`🃏 ${listing.cards.map(c => c.name).join(' | ')}`);
  if (Array.isArray(listing.options) && listing.options.length > 0) {
    lines.push('🎲 Options:');
    for (const o of listing.options) lines.push(`↳ ${o.label} ${o.value}`);
  }
  lines.push('');
  if (!isWs && discount !== undefined) lines.push(`🏷️ Discount: **-${discount}%**`);
  if (isWs) {
    lines.push(`💰 **${formatPrice(listing.price)}** x${listing.amount || 1}`);
  } else {
    lines.push(`💰 Sale Price: **${formatPrice(listing.price)}**`);
    lines.push(`📊 Average Price: **${formatPrice(medianPrice)}**`);
  }
  lines.push('');
  const shop = listing.shop_title || listing.char_name || 'Unknown';
  const navi = listing.map ? `/navi ${listing.map} ${listing.x} ${listing.y}` : '';
  lines.push(`🏪 ${shop}${navi ? ` \`${navi}\`` : ''}`);
  return lines;
}

async function fetchPage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchItemListings(nameid) {
  let page = 1;
  const listings = [];
  while (true) {
    const data    = await fetchPage(`${BASE_URL}/?nameid=${nameid}&page=${page}&page_size=50`);
    const results = data.results || data;
    if (!Array.isArray(results) || results.length === 0) break;
    listings.push(...results);
    if (!data.pages || page >= data.pages) break;
    page++;
    if (page > 20) break;
  }
  return listings;
}

async function* fetchAllListingsPages() {
  let page = 1;
  while (true) {
    let data;
    try { data = await fetchPage(`${BASE_URL}/?page=${page}&page_size=50`); }
    catch (e) { console.error(`Error fetching page ${page}:`, e.message); break; }
    const results = data.results || data;
    if (!Array.isArray(results) || results.length === 0) break;
    yield results;
    if (!data.pages || page >= data.pages) break;
    page++;
  }
}

async function buildNameCache() {
  console.log('[Market] Building name cache...');
  let count = 0;
  for await (const page of fetchAllListingsPages()) {
    for (const item of page) {
      if (item.nameid && item.item_name) {
        nameCache.set(item.nameid, item.item_name);
        nameToId.set(mNormalize(item.item_name), item.nameid);
      }
    }
    if (++count >= 10) break;
  }
  console.log(`[Market] Name cache: ${nameCache.size} items`);
}

async function loadMobCache() {
  if (mobCacheLoaded || mobCacheLoading) return;
  mobCacheLoading = true;
  console.log('[Market] Loading full mob DB...');
  try {
    const first      = await fetchPage(`${DB_URL}/mobs/?page=1&page_size=50`);
    const totalPages = first.pages || 1;
    console.log(`[Market] Mob DB: ${first.total} mobs across ${totalPages} pages`);
    mobCache.push(...(first.results || []));
    for (let p = 2; p <= totalPages; p += 5) {
      const batch = [];
      for (let b = p; b < p + 5 && b <= totalPages; b++)
        batch.push(fetchPage(`${DB_URL}/mobs/?page=${b}&page_size=50`));
      const results = await Promise.all(batch);
      for (const r of results) mobCache.push(...(r.results || []));
    }
    for (const mob of mobCache) {
      const allDrops = [...(mob.Drops || []), ...(mob.MvpDrops || [])];
      for (const drop of allDrops) {
        if (!drop.item_id || !drop.item_name) continue;
        if (!itemIndex.has(drop.item_id)) {
          itemIndex.set(drop.item_id, { id: drop.item_id, name: drop.item_name, slots: drop.item_slots || 0 });
          const key = mNormalize(drop.item_name);
          if (!itemNameIndex.has(key)) itemNameIndex.set(key, []);
          itemNameIndex.get(key).push(drop.item_id);
        }
      }
    }
    mobCacheLoaded = true;
    console.log(`[Market] Mob DB loaded: ${mobCache.length} mobs, ${itemIndex.size} unique items indexed`);
  } catch (e) {
    console.error('[Market] Failed to load mob DB:', e.message);
    mobCacheLoading = false;
  }
}

function resolveItem(query) {
  const asNum = parseInt(query);
  if (!isNaN(asNum)) return asNum;
  const exactId = nameToId.get(mNormalize(query));
  if (exactId) return exactId;
  const fromIndex = itemNameIndex.get(mNormalize(query));
  if (fromIndex && fromIndex.length > 0) return fromIndex[0];
  const lowerQ = mNormalize(query);
  for (const [name, id] of nameToId.entries()) { if (name.includes(lowerQ)) return id; }
  for (const [name, ids] of itemNameIndex.entries()) { if (name.includes(lowerQ)) return ids[0]; }
  return null;
}

function searchItems(query) {
  const asNum = parseInt(query);
  if (!isNaN(asNum)) { const item = itemIndex.get(asNum); return item ? [item] : []; }
  const lowerQ = mNormalize(query);
  const seen = new Set(); const results = [];
  for (const [name, ids] of itemNameIndex.entries()) {
    if (name === lowerQ) { for (const id of ids) { if (!seen.has(id)) { seen.add(id); results.push(itemIndex.get(id)); } } }
  }
  for (const [name, ids] of itemNameIndex.entries()) {
    if (name !== lowerQ && name.includes(lowerQ)) { for (const id of ids) { if (!seen.has(id)) { seen.add(id); results.push(itemIndex.get(id)); } } }
  }
  return results.filter(Boolean);
}

function findMobDrops(query) {
  const asNum  = parseInt(query);
  const lowerQ = mNormalize(query);
  const results = [];
  for (const mob of mobCache) {
    for (const drop of (mob.Drops || [])) {
      if ((!isNaN(asNum) && drop.item_id === asNum) || (isNaN(asNum) && mNormalize(drop.item_name || '').includes(lowerQ)))
        results.push({ mob, drop, isMvp: false });
    }
    for (const drop of (mob.MvpDrops || [])) {
      if ((!isNaN(asNum) && drop.item_id === asNum) || (isNaN(asNum) && mNormalize(drop.item_name || '').includes(lowerQ)))
        results.push({ mob, drop, isMvp: true });
    }
  }
  results.sort((a, b) => b.drop.rate - a.drop.rate);
  return results;
}

async function scanForDeals(channel) {
  console.log('[Market] Scanning for deals...');
  alertedDealsThisCycle = new Set();
  const byItem = new Map();
  for await (const page of fetchAllListingsPages()) {
    for (const item of page) {
      if (!item.nameid || !item.price || !item.amount) continue;
      if (item.item_name) { nameCache.set(item.nameid, item.item_name); nameToId.set(mNormalize(item.item_name), item.nameid); }
      if (!byItem.has(item.nameid)) byItem.set(item.nameid, { item_name: item.item_name || `Item #${item.nameid}`, prices: [], cheapest: null });
      const entry = byItem.get(item.nameid);
      entry.prices.push(item.price);
      if (!entry.cheapest || item.price < entry.cheapest.price) entry.cheapest = item;
    }
  }
  const deals = [];
  for (const [nameid, entry] of byItem.entries()) {
    if (entry.prices.length < 2) continue;
    const med = median(entry.prices);
    if (med <= 0) continue;
    const minPrice = Math.min(...entry.prices);
    if (minPrice <= med * DEAL_THRESHOLD) {
      const dealKey = `${nameid}_${minPrice}`;
      if (!alertedDealsThisCycle.has(dealKey)) {
        alertedDealsThisCycle.add(dealKey);
        deals.push({ nameid, item_name: entry.item_name, minPrice, medianPrice: med, cheapest: entry.cheapest });
      }
    }
  }
  if (deals.length === 0) { console.log('[Market] No deals found.'); return; }
  deals.sort((a, b) => (a.minPrice / a.medianPrice) - (b.minPrice / b.medianPrice));
  const dealBlocks = deals.map(({ nameid, item_name, minPrice, medianPrice, cheapest }) => {
    const discount = Math.round((1 - minPrice / medianPrice) * 100);
    return buildListingBlock(cheapest, { nameid, item_name, medianPrice, discount, isWs: false }).join('\n');
  });
  const chunks = [];
  let current = '';
  for (const block of dealBlocks) {
    const candidate = current ? current + '\n\n' + block : block;
    if (candidate.length > 3800) { chunks.push(current); current = block; }
    else current = candidate;
  }
  if (current) chunks.push(current);
  for (let i = 0; i < chunks.length; i++) {
    const embed = new EmbedBuilder()
      .setTitle(i === 0 ? `🔥 Market Deals :tortugas: (${deals.length})` : `🔥 Market Deals :tortugas: (cont.)`)
      .setColor(0xf1c40f)
      .setDescription(chunks[i])
      .setTimestamp();
    if (i === chunks.length - 1) embed.addFields({ name: '📋 Commands', value: MARKET_LEGEND });
    await channel.send({ embeds: [embed] });
    await new Promise(r => setTimeout(r, 1500));
  }
}

async function handleWhoSells(message, fullQuery) {
  const { itemQuery, filters } = parseWsQuery(fullQuery);
  if (!itemQuery) return message.reply('❌ Please specify an item name or ID.');
  const nameid = resolveItem(itemQuery);
  if (!nameid) return message.reply(`❌ Item \`${itemQuery}\` not found.`);
  let listings;
  try { listings = await fetchItemListings(nameid); }
  catch (e) { return message.reply('❌ Failed to fetch market data.'); }
  const item_name = listings[0]?.item_name || nameCache.get(nameid) || itemIndex.get(nameid)?.name || `Item #${nameid}`;
  if (listings.length === 0) return message.reply(`📦 No one is selling **${item_name}** right now. :tortugas:`);
  let filtered = filters.length > 0 ? listings.filter(l => hasAllFilters(l, filters)) : listings;
  if (filters.length > 0 && filtered.length === 0) {
    const ft = filters.map(f => `${OPTION_MAP[f.id] || f.id} ≥ ${f.value}`).join(', ');
    return message.reply(`📦 No listings for **${item_name}** with filters: **${ft}** :tortugas:`);
  }
  const sorted     = filtered.sort((a, b) => a.price - b.price).slice(0, 8);
  const med        = median(filtered.map(l => l.price));
  const filterText = filters.length > 0 ? ` [${filters.map(f => `${OPTION_MAP[f.id] || f.id} ≥ ${f.value}`).join(' + ')}]` : '';
  const embed = new EmbedBuilder()
    .setTitle(`🛒 ${item_name} (${nameid})${filterText}`)
    .setURL(itemPageUrl(nameid))
    .setColor(0x2ecc71)
    .setThumbnail(itemImageUrl(nameid))
    .setDescription(sorted.map(l => buildListingBlock(l, { nameid, item_name, isWs: true }).join('\n')).join('\n\n'))
    .addFields(
      { name: '📊 Average Price',  value: formatPrice(med),       inline: true },
      { name: '📦 Total Listings', value: `${filtered.length}`,   inline: true },
      { name: '📋 Commands',       value: MARKET_LEGEND,           inline: false }
    )
    .setFooter({ text: `Showing cheapest ${sorted.length} of ${filtered.length} | 🐢 TORTUGAS` });
  return message.reply({ embeds: [embed] });
}

async function handlePriceHistory(message, query) {
  const nameid = resolveItem(query);
  if (!nameid) return message.reply(`❌ Item \`${query}\` not found.`);
  let history;
  try {
    const res = await fetch(`${BASE_URL}/history/?nameid=${nameid}`);
    history   = await res.json();
  } catch (e) { return message.reply('❌ Failed to fetch price history.'); }
  const item_name = nameCache.get(nameid) || itemIndex.get(nameid)?.name || `Item #${nameid}`;
  const results   = history.results || history;
  if (!Array.isArray(results) || results.length === 0)
    return message.reply(`📦 No price history for **[${item_name}](${itemPageUrl(nameid)})**. :tortugas:`);
  const recent = results.slice(0, 10);
  const prices = recent.map(r => r.price);
  const med    = median(prices);
  const embed  = new EmbedBuilder()
    .setTitle(`📈 Price History: ${item_name} (${nameid})`)
    .setURL(itemPageUrl(nameid))
    .setColor(0x9b59b6)
    .setThumbnail(itemImageUrl(nameid))
    .setDescription(recent.map(r => {
      const date = r.listed_at ? `<t:${Math.floor(new Date(r.listed_at).getTime() / 1000)}:d>` : '?';
      return `**${formatPrice(r.price)}** x${r.amount || 1} — ${date}`;
    }).join('\n'))
    .addFields(
      { name: '📊 Median',   value: formatPrice(med),               inline: true },
      { name: '📉 Lowest',   value: formatPrice(Math.min(...prices)),inline: true },
      { name: '📈 Highest',  value: formatPrice(Math.max(...prices)),inline: true },
      { name: '📋 Commands', value: MARKET_LEGEND,                   inline: false }
    )
    .setFooter({ text: `Last ${recent.length} sales | 🐢 TORTUGAS` });
  return message.reply({ embeds: [embed] });
}

async function handleItemInfo(message, query) {
  if (!mobCacheLoaded) {
    await message.reply('⏳ Item database is still loading, please try again in a few seconds. :tortugas:');
    return;
  }
  const matches = searchItems(query);
  if (matches.length === 0) {
    const nameid = resolveItem(query);
    if (!nameid) return message.reply(`❌ Item \`${query}\` not found.`);
    const name = nameCache.get(nameid) || `Item #${nameid}`;
    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle(`📦 ${name} (${nameid})`)
        .setURL(dbItemPageUrl(nameid))
        .setColor(0x3498db)
        .setThumbnail(itemImageUrl(nameid))
        .addFields(
          { name: 'Item ID',    value: `${nameid}`,   inline: true },
          { name: '📋 Commands',value: MARKET_LEGEND, inline: false }
        )
    ]});
  }
  if (matches.length > 1) {
    const lines = matches.slice(0, 25).map(item => {
      const slots = item.slots > 0 ? ` [${item.slots}]` : '';
      return `• **[${item.name}${slots}](${dbItemPageUrl(item.id)})** — ID: \`${item.id}\``;
    });
    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle(`🔍 Items matching "${query}" (${matches.length})`)
        .setColor(0x3498db)
        .setDescription(lines.join('\n'))
        .addFields({ name: '📋 Commands', value: MARKET_LEGEND })
        .setFooter({ text: matches.length > 25 ? `Showing 25 of ${matches.length} — use item ID for exact match` : `${matches.length} results` })
    ]});
  }
  const item  = matches[0];
  const slots = item.slots > 0 ? ` [${item.slots}]` : '';
  return message.reply({ embeds: [
    new EmbedBuilder()
      .setTitle(`📦 ${item.name}${slots}`)
      .setURL(dbItemPageUrl(item.id))
      .setColor(0x3498db)
      .setThumbnail(itemImageUrl(item.id))
      .addFields(
        { name: 'Item ID',    value: `${item.id}`, inline: true },
        { name: 'Slots',      value: `${item.slots}`, inline: true },
        { name: '📋 Commands',value: MARKET_LEGEND,   inline: false }
      )
  ]});
}

async function handleWhoDrops(message, query) {
  if (!mobCacheLoaded) {
    await message.reply('⏳ Monster database is still loading, please try again in a few seconds. :tortugas:');
    return;
  }
  const results = findMobDrops(query);
  if (results.length === 0) return message.reply(`❌ No monsters found dropping \`${query}\`. :tortugas:`);
  const itemName = results[0].drop.item_name || query;
  const itemId   = results[0].drop.item_id;
  const mvpDrops    = results.filter(r => r.isMvp);
  const normalDrops = results.filter(r => !r.isMvp);
  const formatEntry = ({ mob, drop }) =>
    `**[${mob.Name}](<${mobPageUrl(mob.Id)}>)** (ID: ${mob.Id}) — **${formatDropRate(drop.rate)}**${drop.steal_protected ? ' 🔒' : ''}`;
  const lines = [];
  if (mvpDrops.length > 0) { lines.push('**⭐ MVP Drops:**'); lines.push(...mvpDrops.map(formatEntry)); lines.push(''); }
  if (normalDrops.length > 0) { lines.push(`**🗡️ Normal Drops (${normalDrops.length}):**`); lines.push(...normalDrops.map(formatEntry)); }
  const description = lines.join('\n');
  const truncated   = description.length > 3900;
  const embed = new EmbedBuilder()
    .setTitle(`🎯 Who Drops: ${itemName} (${itemId})`)
    .setURL(dbItemPageUrl(itemId))
    .setColor(0xe67e22)
    .setThumbnail(itemImageUrl(itemId))
    .setDescription(truncated ? description.slice(0, 3900) + '\n...' : description)
    .addFields({ name: '📋 Commands', value: MARKET_LEGEND })
    .setFooter({ text: `${results.length} monster(s) | 🔒 steal protected | ⭐ MVP drop | 🐢 TORTUGAS` });
  return message.reply({ embeds: [embed] });
}

async function handleOptionsList(message) {
  const entries = Object.entries(OPTION_MAP);
  const third   = Math.ceil(entries.length / 3);
  const col1    = entries.slice(0, third).map(([id, name]) => `\`${String(id).padStart(3)}\` ${name}`).join('\n');
  const col2    = entries.slice(third, third * 2).map(([id, name]) => `\`${String(id).padStart(3)}\` ${name}`).join('\n');
  const col3    = entries.slice(third * 2).map(([id, name]) => `\`${String(id).padStart(3)}\` ${name}`).join('\n');
  const embed   = new EmbedBuilder()
    .setTitle('🎲 Random Option IDs :tortugas:')
    .setColor(0x9b59b6)
    .setDescription('```ansi\n' + col1.padEnd(40) + '   ' + col2.padEnd(40) + '   ' + col3 + '\n```')
    .addFields(
      { name: '💡 Usage', value: '`$ws <item> <option_id> <min_value>` — e.g. `$ws knife 17 50` (ATK ≥ 50)\nAliases: `atk`, `hp`, `mdef`, `crit`, `sc`, `aspd`, etc.', inline: false },
      { name: '📋 Commands', value: MARKET_LEGEND }
    );
  return message.reply({ embeds: [embed] });
}

async function handleMobInfo(message, query) {
  if (!mobCacheLoaded) {
    await message.reply('⏳ Monster database is still loading, please try again in a few seconds. :tortugas:');
    return;
  }
  const asNum  = parseInt(query);
  const lowerQ = mNormalize(query);
  let matches  = [];
  if (!isNaN(asNum)) { matches = mobCache.filter(m => m.Id === asNum); }
  else { matches = mobCache.filter(m => mNormalize(m.Name).includes(lowerQ)); }
  if (matches.length === 0) return message.reply(`❌ No monster found for \`${query}\`. :tortugas:`);
  if (matches.length > 1) {
    const lines = matches.slice(0, 25).map(m =>
      `• **[${m.Name}](<${mobPageUrl(m.Id)}>)** — ID: \`${m.Id}\` | Lv.${m.Level} | ${m.Race} | ${m.Element} ${m.ElementLevel}`
    );
    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle(`🔍 Monsters matching "${query}" (${matches.length})`)
        .setColor(0xe74c3c)
        .setDescription(lines.join('\n'))
        .addFields({ name: '📋 Commands', value: MARKET_LEGEND })
        .setFooter({ text: matches.length > 25 ? `Showing 25 of ${matches.length} — use mob ID for exact match` : `${matches.length} results` })
    ]});
  }
  const mob = matches[0];
  const formatDropLine = (drop, isMvp = false) => {
    const star = isMvp ? '⭐ ' : '';
    const lock = drop.steal_protected ? ' 🔒' : '';
    return `${star}**[${drop.item_name}](<${dbItemPageUrl(drop.item_id)}>)** (${drop.item_id})${lock} — ${formatDropRate(drop.rate)}`;
  };
  const allDrops = [
    ...(mob.MvpDrops || []).map(d => formatDropLine(d, true)),
    ...(mob.Drops || []).map(d => formatDropLine(d, false)),
  ];
  const dropText  = allDrops.length > 0 ? allDrops.join('\n') : 'No drops';
  const statsText = [
    `STR: **${mob.Str ?? '?'}** | AGI: **${mob.Agi ?? '?'}** | VIT: **${mob.Vit ?? '?'}**`,
    `INT: **${mob.Int ?? '?'}** | DEX: **${mob.Dex ?? '?'}** | LUK: **${mob.Luk ?? '?'}**`,
    `ATK: **${mob.Attack ?? '?'}~${mob.Attack2 ?? '?'}** | DEF: **${mob.Defense ?? '?'}**`,
    `Range: **${mob.AttackRange ?? '?'}** | Size: **${mob.Size ?? '?'}**`,
    `Hit (100%): **${mob['100hit'] ?? '?'}** | Flee (95%): **${mob['95flee'] ?? '?'}**`,
  ].join('\n');
  const embed = new EmbedBuilder()
    .setTitle(`👾 ${mob.Name} (ID: ${mob.Id}) :tortugas:`)
    .setURL(mobPageUrl(mob.Id))
    .setColor(0xe74c3c)
    .setThumbnail(`https://static.divine-pride.net/images/mobs/png/${mob.Id}.png`)
    .addFields(
      { name: '📊 Level',   value: `${mob.Level ?? '?'}`,              inline: true },
      { name: '❤️ HP',      value: `${(mob.Hp ?? 0).toLocaleString()}`, inline: true },
      ...(mob.MvpExp > 0 ? [{ name: '✨ MVP EXP', value: `${mob.MvpExp.toLocaleString()}`, inline: true }] : []),
      { name: '🧪 Base EXP', value: `${(mob.BaseExp ?? 0).toLocaleString()}`, inline: true },
      { name: '💼 Job EXP',  value: `${(mob.JobExp ?? 0).toLocaleString()}`,  inline: true },
      { name: '🌍 Element',  value: `${mob.Element ?? '?'} ${mob.ElementLevel ?? ''}`, inline: true },
      { name: '🐾 Race',     value: mob.Race ?? '?',  inline: true },
      { name: '📐 Size',     value: mob.Size ?? '?',  inline: true },
      { name: '⚔️ Stats',    value: statsText,         inline: false },
      { name: `🎁 Drops (${allDrops.length})`, value: dropText.slice(0, 1020), inline: false },
      { name: '📋 Commands', value: MARKET_LEGEND,     inline: false }
    );
  return message.reply({ embeds: [embed] });
}

// ═══════════════════════════════════════════════════════════════════════════
//  INTERACTION HANDLER (instance dropdown/buttons)
// ═══════════════════════════════════════════════════════════════════════════

client.on('interactionCreate', async (interaction) => {
  // ── MVP "KILLED AGAIN" button ──────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('killed_again_')) {
    const payload = interaction.customId.slice('killed_again_'.length);
    let foundKey  = null;
    for (const [key] of activeTimers.entries()) {
      if (payload === key) { foundKey = key; break; }
    }
    if (!foundKey) {
      for (const [key, timer] of activeTimers.entries()) {
        if (payload.startsWith(timer.boss.bossName)) { foundKey = key; break; }
      }
    }
    if (!foundKey)
      return interaction.reply({ content: '❌ Could not find an active timer for this boss.', ephemeral: true });

    const existing = activeTimers.get(foundKey);
    const { boss, killerId } = existing;
    if (existing.timerId) clearTimeout(existing.timerId);
    const killTime = Date.now();
    const { minSpawn, maxSpawn } = registerBossKill(boss, killTime, killerId, interaction.channel);
    const embed = buildTimerEmbed(boss, killTime, minSpawn, maxSpawn);
    const disabledButton = new ButtonBuilder()
      .setCustomId(interaction.customId)
      .setLabel('KILLED AGAIN')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(true);
    const disabledRow = new ActionRowBuilder().addComponents(disabledButton);
    await interaction.update({ components: [disabledRow] });
    return interaction.followUp({ content: `🔁 **${boss.bossName}** killed again by <@${interaction.user.id}>! Timer reset. :tortugas:`, embeds: [embed] });
  }

  // ── Instance interactions ──────────────────────────────────────────────
  if (!interaction.channel?.isThread()) return;

  const state = activeInstances.get(interaction.channel.id);
  if (!state) {
    return interaction.reply({ content: '❌ This instance is no longer active.', ephemeral: true });
  }

  const { slots }  = state;
  const userId     = interaction.user.id;
  const username   = interaction.member?.displayName || interaction.user.username;

  if (interaction.isButton() && interaction.customId === 'instance_signout') {
    const idx = slots.findIndex(s => s.userId === userId);
    if (idx === -1)
      return interaction.reply({ content: "❌ You're not signed up in this party.", ephemeral: true });
    slots[idx].player = null;
    slots[idx].userId = null;
    await updateMainMessage(interaction.channel, state);
    return interaction.reply({ content: '✅ You have signed out. :tortugas:', ephemeral: true });
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'instance_signup') {
    const targetIdx  = parseInt(interaction.values[0]);
    const filledCount = slots.filter(s => s.player !== null).length;
    if (filledCount === PARTY_SIZE)
      return interaction.reply({ content: '❌ The party is full!', ephemeral: true });

    if (slots[targetIdx].role === 'FILL SPOT') {
      const existing = slots.findIndex(s => s.userId === userId);
      if (existing !== -1)
        return interaction.reply({ content: `❌ You're already in slot ${existing + 1}.`, ephemeral: true });
      if (slots[targetIdx].player !== null)
        return interaction.reply({ content: '❌ That fill spot is taken.', ephemeral: true });
      slots[targetIdx].player = username;
      slots[targetIdx].userId = userId;
    } else {
      if (slots[targetIdx].player !== null && slots[targetIdx].userId !== userId)
        return interaction.reply({ content: `❌ **${slots[targetIdx].role}** is taken by <@${slots[targetIdx].userId}>.`, ephemeral: true });
      const existingIdx = slots.findIndex(s => s.userId === userId);
      if (existingIdx !== -1 && existingIdx !== targetIdx) {
        slots[existingIdx].player = null;
        slots[existingIdx].userId = null;
      }
      slots[targetIdx].player = username;
      slots[targetIdx].userId = userId;
    }

    await updateMainMessage(interaction.channel, state);
    const newFilled = slots.filter(s => s.player !== null).length;
    let reply = `✅ Signed up as **${slots[targetIdx].role}** (slot ${targetIdx + 1}). :tortugas:`;
    if (newFilled === PARTY_SIZE) {
      reply += '\n🎉 Party is full!';
      await interaction.channel.send('🎉 The party is now full! :tortugas:');
    }
    return interaction.reply({ content: reply, ephemeral: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  MESSAGE HANDLER — route by channel
// ═══════════════════════════════════════════════════════════════════════════

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const channelId = message.channelId;

  // ── MVP channel ────────────────────────────────────────────────────────
  if (channelId === MVP_CHANNEL_ID) {
    return handleMvpMessage(message);
  }

  // ── Market channel ─────────────────────────────────────────────────────
  if (channelId === MARKET_CHANNEL_ID) {
    const content  = message.content.trim();
    const wsMatch  = content.match(/^\$ws\s+(.+)/i);
    if (wsMatch)  return handleWhoSells(message, wsMatch[1].trim());
    const phMatch  = content.match(/^\$ph\s+(.+)/i);
    if (phMatch)  return handlePriceHistory(message, phMatch[1].trim());
    const iiMatch  = content.match(/^\$ii\s+(.+)/i);
    if (iiMatch)  return handleItemInfo(message, iiMatch[1].trim());
    const wdMatch  = content.match(/^\$(whodrops|wd)\s+(.+)/i);
    if (wdMatch)  return handleWhoDrops(message, wdMatch[2].trim());
    const miMatch  = content.match(/^\$mi\s+(.+)/i);
    if (miMatch)  return handleMobInfo(message, miMatch[1].trim());
    if (content.match(/^\$(optionslist|ol)$/i)) return handleOptionsList(message);
    return;
  }

  // ── Guild chat channel — instance commands + shared commands ───────────
  if (channelId === GUILDCHAT_CHANNEL_ID) {
    return handleInstanceCommand(message);
  }

  // ── Instance forum threads ─────────────────────────────────────────────
  if (message.channel.isThread()) {
    return handleThreadMessage(message);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  READY
// ═══════════════════════════════════════════════════════════════════════════

client.once('ready', async () => {
  console.log(`[TORTUGAS Bot] Logged in as ${client.user.tag}`);
  await buildNameCache().catch(console.error);
  loadMobCache().catch(console.error);
  const marketChannel = await client.channels.fetch(MARKET_CHANNEL_ID).catch(() => null);
  if (!marketChannel) { console.error('[TORTUGAS Bot] Market channel not found!'); return; }
  await scanForDeals(marketChannel).catch(console.error);
  setInterval(() => scanForDeals(marketChannel).catch(console.error), SCAN_INTERVAL_MS);
  console.log(`[TORTUGAS Bot] Market scanning every ${SCAN_INTERVAL_MS / 60000} min.`);
});

client.login(process.env.DISCORD_TOKEN);
