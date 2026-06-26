# Vouch Network

A command-driven network node API with event sourcing and deterministic replay support.

## Features

- **Event Sourcing**: All state changes are captured as immutable events
- **Deterministic Replay**: State can be reconstructed from the event journal
- **Pluggable Commands**: Extensible command architecture for network operations
- **ALMA ID System**: Structured identifiers for accounts, assets, and regions
- **Idempotency**: Built-in support for idempotent request handling
- **Simulation**: Dry-run commands before committing changes

## Quick Start

### Prerequisites

- Node.js 20+
- npm or pnpm

### Installation

```bash
npm install
```

### Development

```bash
# Start the development server
npm run dev

# Run tests
npm test

# Type check
npm run typecheck

# Lint
npm run lint
```

### Production

```bash
# Build
npm run build

# Start
npm start
```

### Docker

Run the application in a Docker container:

```bash
# Build and run with Docker Compose
docker compose up -d

# Or build manually
docker build -t vouch .
docker run -d -p 3000:3000 -v vouch-data:/app/data vouch

# Check logs
docker compose logs -f

# Stop
docker compose down
```

For development with hot reload:

```bash
docker compose --profile dev up vouch-dev
```

## API Overview

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Root health check |
| `GET` | `/v1/health` | Network health check |
| `POST` | `/v1/execute` | Execute commands |
| `POST` | `/v1/simulate` | Simulate commands (dry-run) |
| `GET` | `/v1/state` | Get current network state |
| `GET` | `/v1/residents` | List residents |
| `GET` | `/v1/ledger` | Get transaction ledger |

### Authentication

All endpoints (except health checks) require authentication:

```bash
curl -H "Authorization: Bearer account:owner@tokyo" \
  http://localhost:3000/v1/state
```

### Commands

Commands are executed via `POST /v1/execute`:

```bash
curl -X POST http://localhost:3000/v1/execute \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer account:owner@tokyo" \
  -d '{
    "commands": [
      {
        "name": "establish",
        "regionId": "tokyo",
        "regionName": "Tokyo Region"
      }
    ]
  }'
```

Available commands:
- `establish` - Create a new region
- `admit` - Add a new resident
- `amend` - Modify region settings
- `transact` - Execute a transaction
- `createAssetType` - Create a new asset type
- `createAsset` - Create an asset instance

### Simulation

Simulate commands without persisting changes:

```bash
curl -X POST http://localhost:3000/v1/simulate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer account:owner@tokyo" \
  -d '{
    "commands": [
      {
        "name": "establish",
        "regionId": "tokyo",
        "regionName": "Tokyo Region"
      }
    ]
  }'
```

Returns `200 OK` if commands would succeed, `412 Precondition Failed` if they would fail.

## Architecture

```
src/
├── application/       # Application layer (commands, handlers)
│   ├── commands/      # Pluggable command registry
│   └── handlers/      # Legacy command handlers
├── domain/            # Domain layer (models, policies)
│   ├── models/        # Domain entities and value objects
│   └── policies/      # Business rules
├── http/              # HTTP layer (routes, middleware)
│   ├── routes/        # API routes
│   ├── middleware/    # HTTP middleware
│   └── schemas/       # Request/response schemas
└── infra/             # Infrastructure layer
    └── persistence/   # Journal and database
```

### Key Concepts

- **Region**: A network namespace with its own governance
- **Account**: An identity that can own residents and assets
- **Resident**: A participant in the network
- **Asset**: A transferable unit of value
- **Command**: An intent to change state
- **Event**: An immutable record of state change

## ID Format (ALMA)

```
account_id     = name '@' region        # e.g., alice@tokyo
asset_type_id  = region '/' name        # e.g., tokyo/points
asset_id       = account '/' type '#' name  # e.g., alice@tokyo/points#main
```

## API Documentation

- **Swagger UI**: http://localhost:3000/docs
- **ReDoc**: http://localhost:3000/docs/redoc
- **OpenAPI JSON**: http://localhost:3000/docs/openapi.json

## License

ISC
