# Vouch Network API Specification

## Overview

A command-driven network node API with event sourcing and deterministic replay support.

- **Base URL**: `http://localhost:3000`
- **Version**: 1.0.0
- **Format**: JSON

## Authentication

All endpoints (except health checks) require authentication.

```
Authorization: Bearer account:<accountId>
```

### Example

```bash
curl -H "Authorization: Bearer account:owner-123" \
  http://localhost:3000/v1/state
```

## Idempotency

POST requests can include an `Idempotency-Key` header to ensure the same request is processed only once.

```bash
curl -X POST \
  -H "Idempotency-Key: unique-key-123" \
  -H "Authorization: Bearer account:owner-1" \
  http://localhost:3000/v1/found
```

## Error Responses

All errors are returned in a unified format.

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "requestId": "uuid",
    "details": []
  }
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Request validation error |
| `UNAUTHORIZED` | 401 | Authentication error |
| `FORBIDDEN` | 403 | Permission error |
| `NOT_FOUND` | 404 | Resource not found |
| `NETWORK_ALREADY_FOUNDED` | 409 | Network already founded |
| `ACCOUNT_ALREADY_EXISTS` | 409 | Account already exists |
| `RESIDENT_ALREADY_EXISTS` | 409 | Resident already exists |
| `SELF_TRANSACTION` | 400 | Self-transaction not allowed |
| `RESIDENT_NOT_ACTIVE` | 400 | Resident is not active |
| `INTERNAL_ERROR` | 500 | Internal server error |

---

## Endpoints

### System

#### `GET /`

Root health check

**Response**

```json
{
  "name": "vouch",
  "version": "1.0.0",
  "status": "ok"
}
```

#### `GET /v1/health`

Network health check

**Response**

```json
{
  "status": "ok",
  "regionId": "tokyo-1",
  "seq": 42,
  "founded": true
}
```

#### `GET /v1/state`

Get current state

**Authentication**: Required

**Response**

```json
{
  "regionId": "tokyo-1",
  "ownerId": "owner-123",
  "seq": 42,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-15T12:30:00.000Z",
  "accountCount": 10,
  "residentCount": 8,
  "ledgerCount": 150
}
```

---

### Network

#### `POST /v1/execute`

Execute commands to update Region state

**Authentication**: Required
**Permission**: Requires appropriate permissions based on the commands

**Request**

```json
{
  "commands": [
    {
      "name": "establish",
      "regionId": "tokyo",
      "regionName": "Tokyo Region"
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| commands | object[] | ✓ | Array of commands to execute |

**Response** `200 OK`

```json
{
  "ok": true,
  "seq": 5,
  "idempotent": false,
  "schemaVersion": 1
}
```

---

#### `POST /v1/simulate`

Simulate commands without persisting changes

**Authentication**: Required
**Permission**: Requires appropriate permissions based on the commands

**Request**

```json
{
  "commands": [
    {
      "name": "establish",
      "regionId": "tokyo",
      "regionName": "Tokyo Region"
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| commands | object[] | ✓ | Array of commands to simulate |

**Response** `200 OK` - Simulation succeeded

```json
{
  "ok": true,
  "valid": true,
  "seq": 5,
  "eventCount": 2,
  "schemaVersion": 1
}
```

**Response** `412 Precondition Failed` - Simulation failed

```json
{
  "ok": false,
  "valid": false,
  "error": {
    "code": "NETWORK_ALREADY_FOUNDED",
    "message": "Network has already been founded",
    "requestId": "uuid"
  }
}
```

---

### Commands

Commands are pluggable and can be extended. Each command has a `name` field and command-specific payload fields.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | ✓ | Command name |
| ... | varies | - | Command-specific fields |

#### Available Commands

##### `establish`

Establish a new region.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| regionId | string | ✓ | Region ID |
| regionName | string | ✓ | Region name |
| inviteIds | string[] | - | Invite IDs |

##### `admit`

Admit a new resident to the network.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| accountId | string | ✓ | Account ID |
| email | string | ✓ | Email address |
| residentId | string (uuid) | ✓ | Resident ID |
| residentName | string | ✓ | Resident name |

##### `amend`

Modify region settings.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| changes | object | ✓ | Changes to apply |
| changes.ownerId | string | - | New owner ID |
| changes.regionName | string | - | New region name |

##### `transact`

Execute a transaction between accounts.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| from | string | ✓ | Sender account ID |
| to | string | ✓ | Recipient account ID |
| amount | string | ✓ | Amount (string for precision) |
| assetId | string | ✓ | Asset ID |
| memo | string | - | Memo (max 500 characters) |

##### `createAssetType`

Create a new asset type.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| assetTypeId | string | ✓ | Asset type ID |
| typeName | string | ✓ | Asset type name |
| description | string | - | Description |
| precision | number | - | Decimal precision (0-18) |
| allowNegative | boolean | - | Allow negative balances |

##### `createAsset`

Create a new asset instance.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| assetId | string | ✓ | Asset ID |
| initialBalance | string | - | Initial balance |
| metadata | object | - | Asset metadata |

---

### Transaction (Legacy)

#### `POST /v1/transact`

Execute a transaction

**Authentication**: Required
**Permission**: Sender's account owner, or network owner

**Request**

```json
{
  "fromResidentId": "uuid",
  "toResidentId": "uuid",
  "amount": "100",
  "memo": "Payment"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| fromResidentId | string (uuid) | ✓ | Sender resident ID |
| toResidentId | string (uuid) | ✓ | Recipient resident ID |
| amount | string | ✓ | Amount (string for precision) |
| memo | string | - | Memo (max 500 characters) |

**Response** `201 Created`

```json
{
  "ok": true,
  "seq": 10,
  "idempotent": false,
  "schemaVersion": 1
}
```

**Errors**

- `400 Bad Request` - Self-transaction (`SELF_TRANSACTION`)
- `404 Not Found` - Resident not found (`RESIDENT_NOT_FOUND`)

---

## ID Format (ALMA)

The syntax of an identifier in ALMA is described in the following ABNF notation:

```
account_id     = any-name '@' region
asset_type_id  = region '/' any-name
asset_id       = account_id '/' <asset_type_name> '#' any-name
region_id      = any-name 1*( '.' region ) | "[" <IP> | <Network-Domain> "]"
any-name       = 1*char
char           = ALPHA / DIGIT / "-" / "_"
```

For example, `mizuki@tokyo` and `tea@chiyoda.tokyo` are valid IDs. When an ID is registered to a region, the ID becomes valid within the region. Identical IDs cannot exist in a single region, hence ID is unique.

---

## API Documentation UI

- **Swagger UI**: `GET /docs`
- **ReDoc**: `GET /docs/redoc`
- **OpenAPI JSON**: `GET /docs/openapi.json`

---

## Usage Examples

### 1. Found a network (Legacy)

```bash
curl -X POST http://localhost:3000/v1/found \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer account:owner-1" \
  -d '{
    "regionId": "tokyo-1",
    "ownerEmail": "owner@example.com"
  }'
```

### 2. Establish a region (Execute API)

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

### 3. Admit a resident

```bash
curl -X POST http://localhost:3000/v1/execute \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer account:owner@tokyo" \
  -d '{
    "commands": [
      {
        "name": "admit",
        "accountId": "alice@tokyo",
        "email": "alice@example.com",
        "residentId": "550e8400-e29b-41d4-a716-446655440001",
        "residentName": "Alice"
      }
    ]
  }'
```

### 4. Simulate commands

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

### 5. Get ledger

```bash
curl http://localhost:3000/v1/ledger?limit=10 \
  -H "Authorization: Bearer account:owner-1"
```
