# Discord VALORANT Schedule Matching Bot - Agent Guide

This document provides context for AI agents (Claude Code, etc.) working on this codebase.

## Project Overview

A Discord bot built with Cloudflare Workers that schedules VALORANT matches and automatically matches players based on their availability and ranks.

## Tech Stack

- **Runtime**: Cloudflare Workers (Bun)
- **Framework**: Hono
- **Database**: D1 (SQLite) with Drizzle ORM
- **Language**: TypeScript
- **Tools**: Biome (linting/formatting), Vitest (testing), Wrangler (deployment)

## Architecture

### Core Components

```
src/
├── index.ts              # Main entry point, Discord interaction handlers
├── db/
│   └── schema.ts         # Database schema definitions
└── utils/
    ├── embed.ts          # Discord Embed builders
    ├── matching.ts       # Party matching algorithm with rank balancing
    ├── notification.ts   # Match change notifications
    ├── riot.ts           # HenrikDev API client for VALORANT ranks
    ├── schedule.ts       # Schedule instance creation logic
    ├── time.ts           # Time zone utilities and option generation
    └── reminder.ts       # Reminder logic for pending users
```

### Database Schema

- `guild_settings`: Per-guild configuration (timezone, defaults, reminder interval)
- `schedules`: Recurring schedule definitions
- `recruits`: Individual recruit instances created from schedules
- `recruit_entries`: User participation entries with states
- `riot_accounts`: User VALORANT account links with ranks

### State Machine (recruit_entries)

```
pending_time → confirmed
     ↓
   cancelled
```

## Key Concepts

### Interaction Flow

1. **Scheduled Task**: Creates recruit instances at configured times
2. **User Joins**: Sets state to `pending_time`, shows time select menu
3. **User Selects Time**: Sets state to `confirmed`, triggers recompute
4. **Match Computation**: When 5+ confirmed, finds optimal party

### Matching Algorithm

- Prioritizes earliest possible meet time
- Considers rank balance (minimizes variance)
- Supports multiple accounts per user (selects optimal combination)

### Rank Balancing

Uses tier hierarchy (Iron < Bronze < ... < Radiant) to calculate rank variance and select balanced parties when possible.

## Development Guidelines

### Adding New Commands

1. Add handler in `src/index.ts` (e.g., `handleXxxCommand`)
2. Route in appropriate command dispatcher (e.g., `handleScheduleCommand`)
3. Follow existing error handling patterns

### Database Migrations

```bash
bun run db:generate  # Generate migration from schema changes
bun run db:migrate   # Apply migrations
```

### Testing

```bash
bun run test         # Run tests
bun run test:ui      # Run tests with UI
```

### Linting/Formatting

```bash
bun run lint         # Check code
bun run format       # Format code
```

## Important Notes

- Never run `git push` without explicit user request
- Never post GitHub comments without explicit user request
- Use Japanese for user-facing messages and comments
- Keep technical terms in English
- Atomic commits preferred over bundling
- Tests must pass before committing

## Environment Variables

- `DISCORD_PUBLIC_KEY`: Discord interaction verification
- `DISCORD_BOT_TOKEN`: Bot API token
- `HENRIKDEV_API_KEY`: VALORANT rank data API key
- `DB`: D1 database binding (auto-configured by Wrangler)

## Common Tasks

### Adding a New Discord Slash Command

1. Register command structure in Discord Developer Portal
2. Add handler function in `src/index.ts`
3. Route in main `APPLICATION_COMMAND` handler
4. Return appropriate `InteractionResponseType`

### Modifying Matching Logic

- Edit `src/utils/matching.ts`
- Key function: `computeBestParty(entries)`
- Consider rank balance and time constraints

### Adding Embed Fields

- Edit `src/utils/embed.ts`
- `buildRecruitEmbed` function handles all embed generation
- Update `updateDiscordMessage` calls if adding new params
