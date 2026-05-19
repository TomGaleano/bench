# Pi Lab

Pi Lab is a benchmark platform for building, running, validating, and grading coding-agent benchmark cases. The repository is organized as a pnpm/Turbo monorepo with web, API, shared packages, and background workers.

## Repository Layout

- `apps/web` - Next.js web interface.
- `apps/api` - API service for cases, benchmarks, runs, grading, datasets, and metrics.
- `packages` - Shared libraries for database access, GitHub import, jobs, runtime, object storage, and benchmark specs.
- `workers` - Background workers for case building, validation, runner execution, grading, model sync, and evaluation.
- `infra` - Local Docker Compose infrastructure for Postgres, Redis, and MinIO.
- `docs` - Runtime and benchmark research notes.

## Requirements

- Node.js 22+
- pnpm 10+
- Docker, for local infrastructure

## Setup

Install dependencies:

```bash
pnpm install
```

Create local environment configuration:

```bash
cp .env.example .env
```

Fill in any required API keys in `.env`. Local development defaults are provided for Postgres, Redis, and MinIO.

Start local infrastructure:

```bash
docker compose -f infra/compose.yaml up -d
```

Run the development services:

```bash
pnpm dev
```

## Common Commands

```bash
pnpm build
pnpm check
pnpm typecheck
pnpm lint
pnpm format
```

## Environment

Important environment variables are documented in `.env.example`, including:

- `OPENROUTER_API_KEY`
- `DATABASE_URL`
- `REDIS_URL`
- `S3_ENDPOINT`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_BUCKET`
- `GITHUB_TOKEN`
- `DAYTONA_API_KEY`
- `DAYTONA_API_URL`
- `GRADER_API_KEY`
- `GRADER_MODEL_ID`

Do not commit `.env` or other files containing live credentials.

## Local Services

The Compose stack exposes:

- Postgres on `localhost:55432`
- Redis on `localhost:56380`
- MinIO API on `localhost:59000`
- MinIO console on `localhost:59001`

## Publishing Notes

Generated artifacts are intentionally ignored, including build outputs, dependency folders, Playwright artifacts, logs, videos, and worker runtime output. Before publishing or committing, verify the staged files with:

```bash
git status --short
```
