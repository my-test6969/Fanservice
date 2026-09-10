# Fanservice

Fanservice is a separate Discord bot for **Umamusume Pretty Derby Global** trainer and legacy searching.

## Commands

- `/uma-profile <trainer_id>` — look up an indexed Global trainer profile. The bot is designed to show trainer name, ID, rank, fans, representative Uma, support card, sparks, and inheritance when the public source exposes those fields.
- `/uma-find` — prepare a spark / representative-Uma search across the Global friend databases.

## Data sources

Fanservice uses public community databases such as Pure DB, uma.moe, and ChronoGenesis. It does not ask for a Cygames password and does not attempt to access private game accounts.

Pure DB has public Global trainer profile pages and exposes representative Uma, support card, skills, and inheritance information on indexed profiles. uma.moe documents public APIs for inheritance/support-card search and trainer data.

## Setup

1. Create a **new** Discord application/bot for Fanservice.
2. Put its token in `.env` as `DISCORD_TOKEN`.
3. Optionally set `GUILD_ID` for instant command registration in a test server.
4. Run `npm install`.
5. Run `npm start`.

Never commit `.env` or a real bot token.
