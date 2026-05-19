# Daytona Runtime

Pi Lab uses Daytona as the unified execution runtime for benchmark workspaces.

The worker process still hosts orchestration, database writes, artifact persistence, and Pi SDK session control. All shell execution, dependency installation, test commands, test patch checks, and reproduction scripts run inside ephemeral Daytona sandboxes.

## Local OSS Deployment

Follow Daytona OSS deployment docs:

```bash
git clone https://github.com/daytonaio/daytona
cd daytona
docker compose -f docker/docker-compose.yaml up -d
```

Local defaults:

```bash
DAYTONA_API_URL=http://localhost:3000/api
```

Daytona OSS binds its dashboard/API to host port `3000` by default. Pi Lab's web dev server uses port `3002` so Daytona can keep `3000` and the Pi Lab API can keep `3001`.

Create an API key with `write:sandboxes` and `delete:sandboxes` scopes and set:

```bash
DAYTONA_API_KEY=...
```

## Runtime Settings

```bash
DAYTONA_API_KEY=
DAYTONA_API_URL=http://localhost:3000/api
DAYTONA_TARGET=
DAYTONA_BASE_IMAGE=node:22-bookworm
DAYTONA_IMAGE=
DAYTONA_AUTO_STOP_MINUTES=15
DAYTONA_CPU=2
DAYTONA_MEMORY_GB=4
DAYTONA_DISK_GB=8
```

## Runtime Contract

- `@pilab/runtime` owns sandbox lifecycle and command execution.
- Workers must inject test executors only in unit tests.
- Production workers use `createBenchmarkRuntime()` and fail if Daytona is not configured.
- There is no Docker-to-host fallback. If sandbox provisioning fails, the job fails safely.
- PI implementation mode runs the PI SDK agent inside the Daytona sandbox. The agent receives file read/write/edit tools but no bash tool, and Pi Lab streams PI SDK events back from the sandbox process.

## Security Notes

- Use ephemeral sandboxes with explicit `delete()` in `finally` blocks.
- Keep `INTER_SANDBOX_NETWORK_ENABLED=false` in Daytona runner config unless explicitly needed.
- Do not place `DAYTONA_API_KEY` in client-side apps.
- Do not reintroduce host execution fallback for benchmark commands.
