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

### Directory Structure

```
src/
├── index.ts              # Main entry point, routing only
├── db/
│   └── schema.ts         # Database schema definitions
├── lib/
│   └── types.ts          # Shared type definitions (CommandOption, InteractionBody, Env)
├── features/             # Feature-based modules
│   ├── matching/         # Party matching algorithm with rank balancing
│   │   ├── algorithm.ts  # computeBestParty, selectOptimalAccounts
│   │   └── index.ts
│   ├── recruit/          # Recruit management
│   │   ├── notification.ts  # Match change notifications
│   │   ├── reminder.ts      # Reminder logic for pending users
│   │   ├── scheduler.ts     # Schedule instance creation logic
│   │   └── index.ts
│   ├── discord/          # Discord API integration
│   │   ├── client.ts        # postChannelMessage, deleteDiscordMessage, updateDiscordMessage
│   │   ├── embed.ts         # Discord Embed builders
│   │   └── index.ts
│   └── riot/             # Riot Games API
│       ├── api.ts           # HenrikDev API client for VALORANT ranks
│       └── index.ts
├── shared/               # Shared utilities
│   ├── time/             # Time zone utilities
│   │   ├── utils.ts        # buildTimeOptions, localDateTimeToUtc
│   │   └── index.ts
│   └── validation/       # Zod validation schemas
│       ├── schemas.ts      # Command/option validation
│       └── index.ts
└── handlers/             # Request handlers
    ├── commands.ts       # Slash command handlers
    ├── components.ts     # Component interaction handlers
    ├── matching.ts       # Match computation helpers
    └── scheduled.ts      # Scheduled task handlers
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

1. Add handler in `src/handlers/commands.ts` (e.g., `handleXxxCommand`)
2. Route in main command dispatcher in `src/index.ts`
3. Follow existing error handling patterns
4. Use Zod schemas from `src/shared/validation/schemas.ts` for validation

### Database Migrations

```bash
bun run db:generate  # Generate migration from schema changes
bun run db:migrate   # Apply migrations
```

### Testing

**Note**: Always use `bun run test` instead of `bun test` to ensure proper Vitest configuration.

```bash
bun run test         # Run tests (preferred over `bun test`)
bun run test:ui      # Run tests with UI
bun test             # Bun built-in test runner (unit tests only)
```

#### TDD Workflow (Test-Driven Development)

**Follow TDD when implementing new features or modifying existing logic:**

1. **Red**: Write a failing test first that describes the desired behavior
2. **Green**: Write the minimum code to make the test pass
3. **Refactor**: Improve the code while keeping tests green

**TDD Commands:**
```bash
# Watch mode for TDD (auto-rerun on file changes)
bun run test --watch

# Watch specific test file
bun run test -- tests/unit/features/matching/algorithm.test.ts
```

**Why TDD?**
- Ensures testability is considered from the start
- Provides immediate feedback during development
- Serves as living documentation
- Catches regressions early

**When to use TDD:**
- New feature implementation
- Bug fixes (write test that reproduces the bug first)
- Refactoring existing code (add characterization tests first)
- Adding new functions or modifying existing logic

**TDD Pattern for this codebase:**
1. Write test in `tests/unit/**` or `tests/integration/**`
2. Run `bun run test --watch` to see the test fail
3. Implement the feature in `src/**`
4. Watch the test pass
5. Refactor and commit when green

#### Test File Naming Conventions

- **`*.test.ts`**: Unit tests that run with both Bun's built-in test runner and Vitest
  - Use for pure unit tests that don't require Cloudflare Workers environment
  - Located in `tests/unit/` directory
  - Example: `tests/unit/matching.test.ts`

- **`*.vitest.ts`**: Vitest-only tests (require Cloudflare Workers pool)
  - Use for integration tests or tests requiring `cloudflare:test` utilities
  - Located in `tests/integration/` directory
  - Example: `tests/integration/discord.vitest.ts`
  - Configured in `vitest.config.ts` with `include: ["**/*.test.ts", "**/*.vitest.ts"]`

**Why this separation?**
- Bun's built-in test runner (`bun test`) only executes `*.test.ts` files
- Tests requiring `cloudflare:test` module must use `*.vitest.ts` extension to avoid errors
- This allows quick unit testing with `bun test` while ensuring full test coverage with Vitest

### Linting/Formatting

```bash
bun run lint         # Check code
bun run format       # Format code
bun run format:check # Check formatting without modifying
```

### Type Checking

```bash
bun tsc --noEmit     # Run TypeScript type check
```

## Coding Guidelines

### Functional Programming Principles

This codebase follows functional programming principles to ensure code reliability and maintainability:

**1. Const over Let**
- Always use `const` for variables that don't need reassignment
- Only use `let` when absolutely necessary (rare in this codebase)
- This prevents accidental mutations and makes code more predictable

**2. Pure Functions**
- Separate data transformation from side effects (I/O, database operations)
- Keep core logic pure: same input → same output, no external dependencies
- Side effects should be isolated at the edges (handlers, API clients)

**3. Immutable Operations**
- Use spread syntax (`[...arr, item]`, `{...obj, key: value}`) instead of mutating methods
- Avoid direct array/object mutations (push, splice, direct property assignment)
- Use non-destructive methods (map, filter, reduce) over forEach

**4. Type Safety**
- Leverage TypeScript's type system for compile-time guarantees
- Use union types and result types for error handling
- Prefer explicit types over `any` or loose typing

**5. Structured Logging**
- Use consistent prefixes for log messages: `[COMPONENT]`
- Include context in error logs (IDs, error messages, metadata)
- Avoid console.log for debugging; use appropriate levels (error, warn)

**6. Error Handling**
- Use Result types for operations that can fail
- Never let exceptions propagate silently
- Provide meaningful error messages with context

**Examples:**

```typescript
// ✅ Good: Const, pure function, type-safe
const parseRankSafely = (rankJson: string | null): ValorantRank | null => {
  if (!rankJson) return null;
  try {
    return JSON.parse(rankJson) as ValorantRank;
  } catch {
    return null;
  }
};

// ❌ Bad: Let, mutation, no type safety
let result = null;
if (rankJson) {
  try {
    result = JSON.parse(rankJson);
  } catch (e) {
    console.error(e);
  }
}
```

## Important Notes

- Never run `git push` without explicit user request
- Never post GitHub comments without explicit user request
- Use Japanese for user-facing messages and comments
- Keep technical terms in English
- Atomic commits preferred over bundling
- Tests must pass before committing
- Always use `bun run test` instead of `bun test`

## Environment Variables

- `DISCORD_PUBLIC_KEY`: Discord interaction verification
- `DISCORD_BOT_TOKEN`: Bot API token
- `HENRIKDEV_API_KEY`: VALORANT rank data API key
- `DB`: D1 database binding (auto-configured by Wrangler)

## Common Tasks

### Adding a New Discord Slash Command

1. Register command structure in Discord Developer Portal
2. Add handler function in `src/handlers/commands.ts`
3. Export and route in `src/index.ts` APPLICATION_COMMAND handler
4. Return appropriate `InteractionResponseType`
5. Add Zod validation schema in `src/shared/validation/schemas.ts` if needed

### Modifying Matching Logic

- Edit `src/features/matching/algorithm.ts`
- Key function: `computeBestParty(entries)`
- Consider rank balance and time constraints

### Adding Embed Fields

- Edit `src/features/discord/embed.ts`
- `buildRecruitEmbed` function handles all embed generation
- Update `updateDiscordMessage` calls if adding new params

### Adding Discord API Functions

- Edit `src/features/discord/client.ts`
- Export from `src/features/discord/index.ts`
