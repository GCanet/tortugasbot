# 🐢 TORTUGAS Bot

A unified Discord bot for the **Tortugas** Ragnarok Online guild on [Revenant Elegy](https://revenantelegy.com). One process, three modules: MVP timers, guild instance signups, and market tools.

---

## Features

### ☠️ MVP Timers (`#mvp-timers`)
Track boss kills and get automatic spawn reminders.

| Command | Description |
|---|---|
| `<boss name>` | Register a kill and start the respawn timer |
| `!current` | List all active timers sorted by next spawn |
| `!remove <name>` | Delete a timer |
| `!edit <name>` | Reset a timer's kill time to now |
| `!launch` | Show the server launch event countdown |
| `!server` | Show live server status and player count |
| `!players` | Show player and merchant count |

- Fuzzy boss name matching with alias support
- Disambiguation menu when multiple bosses match
- **10-minute spawn reminder** sent automatically with a "Killed Again" button
- Boss thumbnails, race/element/HP in embed footer
- Data sourced from `bosses.json`

---

### 🏛️ Instance Signups (`#guildchat` → forum threads in instance forum)

Create party signup threads in the instances forum channel directly from guild chat.

**Create a thread:**
```
!instance ifirth
!instance valk
!instance bio3
!instance et
!instance bee
!instance captain
!instance open
!instance <any custom name>
!party <name>
```

**Inside a thread:**

| Command | Description |
|---|---|
| `$<role>` | Sign up for a role (e.g. `$hp`, `$sniper`) |
| `$<number>` | Sign up by slot number (e.g. `$3`) |
| `$fill` | Take any available fill spot |
| `$out` | Sign yourself out |
| `$swap $<role or number>` | Move to a different slot |
| `$clear <number>` | (creator) Clear a slot |
| `$rename <number> <name>` | (creator) Rename a slot |
| `$hournew <unix_timestamp>` | (creator) Set the instance time |
| `$hour help` | How to get a Unix timestamp |
| `!repost` | Repost the current party embed |

- Dropdown UI for signing up without typing
- Sign Out button on every embed
- **24-hour** and **10-minute** reminders ping all registered players
- Party full detection with auto-announcement

**Available templates:** Ifrit, Valkyrie Randgris, Biolabs 3, Endless Tower, Sealed Shrine, Beelzebub, Ghost Ship Captain, Open Party, Custom Party

Also available in `#guildchat`: `!launch`, `!server`, `!players`

---

### 📈 Market Tools (`#market`)

| Command | Description |
|---|---|
| `$ws <item>` | Who is selling — sorted by price, with shop location |
| `$ws <item> <option> <value>` | Filter by random option (e.g. `$ws knife atk 50`) |
| `$ph <item>` | Price history — median, lowest, highest |
| `$ii <item>` | Item info and database link |
| `$wd <item>` | Which monsters drop this item and at what rate |
| `$mi <monster>` | Monster info — stats, element, race, all drops |
| `$ol` | List all random option IDs and aliases |

- Accepts item/mob name or numeric ID
- **Automatic deal scanner** runs every 15 minutes — alerts when items are listed at ≥90% below market median
- Builds and caches the full mob/item DB on startup for fast lookups
- Random option filter aliases: `atk`, `hp`, `mdef`, `crit`, `aspd`, `str`, `agi`, `vit`, `int`, `dex`, `luk`, `sc`, `cast`, `delay`, `boss`, `long`, and more

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/yourname/tortugasbot.git
cd tortugasbot
npm install
```

### 2. Configure environment

Create a `.env` file:

```env
DISCORD_TOKEN=your_bot_token

# Channel IDs
MVP_CHANNEL_ID=
MARKET_CHANNEL_ID=
GUILDCHAT_CHANNEL_ID=
INSTANCES_FORUM_CHANNEL_ID=

# Optional
SERVER_HEALTH_URL=https://revenantelegy.com/api/v1.0/serverhealth/
SCAN_INTERVAL_MINUTES=15
```

### 3. Run

```bash
npm start
```

---

## Required Bot Permissions

- Read Messages / Send Messages
- Embed Links
- Use External Emojis
- Create Public Threads (for instance forum)
- Read Message History
- View Channels

**Privileged intents required** (enable in Discord Developer Portal):
- `Message Content Intent`
- `Server Members Intent`

---

## File Structure

```
tortugasbot/
├── index.js       # Unified bot (MVP + Instance + Market)
├── bosses.json    # MVP boss data (name, aliases, respawn times, location)
├── package.json
└── .env           # Not committed
```

---

## Boss Data (`bosses.json`)

Each entry supports:

```json
{
  "bossName": "Ifrit",
  "alias": ["ifirth", "ifrit"],
  "ID": 1272,
  "location": "in_sphinx5",
  "race": "Demon",
  "property": "Fire",
  "HP": 3823000,
  "minRespawnTimeScheduleInSeconds": 7200,
  "maxRespawnTimeScheduleInSeconds": 10800
}
```

---

## Dependencies

- [discord.js](https://discord.js.org/) v14
- [dotenv](https://github.com/motdotla/dotenv)
- Node.js 18+
