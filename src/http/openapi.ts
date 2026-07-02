/**
 * OpenAPI 3.0 Specification for Vouch Network API
 */

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Vouch Network API",
    version: "1.0.0",
    description: `
# Vouch Network API

A command-driven network node API with event sourcing and deterministic replay support.

## Authentication

All endpoints (except health checks) require authentication.

\`\`\`
Authorization: Bearer account:<accountId>
\`\`\`

## Idempotency

POST requests can include an \`Idempotency-Key\` header to ensure the same request is processed only once.

## Error Responses

All errors are returned in a unified format.
    `,
    contact: {
      name: "API Support",
    },
    license: {
      name: "ISC",
    },
  },
  servers: [
    {
      url: "http://localhost:3000",
      description: "Development server",
    },
  ],
  tags: [
    {
      name: "Network",
      description: "Network creation and management",
    },
    {
      name: "Resident",
      description: "Resident management",
    },
    {
      name: "Transaction",
      description: "Transaction execution",
    },
    {
      name: "System",
      description: "System management and health checks",
    },
  ],
  paths: {
    "/": {
      get: {
        tags: ["System"],
        summary: "Root health check",
        description: "Returns basic API server information",
        operationId: "getRoot",
        responses: {
          "200": {
            description: "Server information",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/RootResponse",
                },
              },
            },
          },
        },
      },
    },
    "/v1/health": {
      get: {
        tags: ["System"],
        summary: "Network health check",
        description: "Returns the network status",
        operationId: "getHealth",
        responses: {
          "200": {
            description: "Network status",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/HealthResponse",
                },
              },
            },
          },
        },
      },
    },
    "/v1/found": {
      post: {
        tags: ["Network"],
        summary: "Found a network",
        description: `
Creates a new network. The account sending the request becomes the owner.

**Note**: A network can only be founded once.
        `,
        operationId: "foundNetwork",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/FoundRequest",
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Network founded successfully",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/CommandResponse",
                },
              },
            },
          },
          "200": {
            description: "Idempotent request (already processed)",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/CommandResponse",
                },
              },
            },
          },
          "400": {
            $ref: "#/components/responses/ValidationError",
          },
          "401": {
            $ref: "#/components/responses/Unauthorized",
          },
          "409": {
            description: "Network already founded",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ErrorResponse",
                },
                example: {
                  error: {
                    code: "NETWORK_ALREADY_FOUNDED",
                    message: "Network has already been founded",
                    requestId: "uuid",
                  },
                },
              },
            },
          },
        },
      },
    },
    "/v1/execute": {
      post: {
        tags: ["Network"],
        summary: "Execute commands",
        description: `
Executes a batch of commands atomically. All commands are validated first, then applied.

**Permission**: Requires appropriate permissions based on the commands being executed.
        `,
        operationId: "executeCommands",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/ExecuteRequest",
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Commands executed successfully",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/CommandResponse",
                },
              },
            },
          },
          "400": {
            $ref: "#/components/responses/ValidationError",
          },
          "401": {
            $ref: "#/components/responses/Unauthorized",
          },
          "403": {
            $ref: "#/components/responses/Forbidden",
          },
          "409": {
            description: "Conflict (e.g., resource already exists)",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ErrorResponse",
                },
              },
            },
          },
        },
      },
    },
    "/v1/simulate": {
      post: {
        tags: ["Network"],
        summary: "Simulate commands",
        description: `
Simulates a batch of commands without persisting changes. Validates whether the commands would succeed.

**Permission**: Requires appropriate permissions based on the commands being simulated.
        `,
        operationId: "simulateCommands",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/ExecuteRequest",
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Simulation succeeded - commands would execute successfully",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SimulateResponse",
                },
              },
            },
          },
          "400": {
            $ref: "#/components/responses/ValidationError",
          },
          "401": {
            $ref: "#/components/responses/Unauthorized",
          },
          "412": {
            description: "Precondition failed - commands would not execute successfully",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SimulateErrorResponse",
                },
              },
            },
          },
        },
      },
    },
    "/v1/amend": {
      post: {
        tags: ["Network"],
        summary: "Amend network settings",
        description: `
Modifies network settings.

**Permission**: Owner only
        `,
        operationId: "amendNetwork",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/AmendRequest",
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Settings updated",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/CommandResponse",
                },
              },
            },
          },
          "400": {
            $ref: "#/components/responses/ValidationError",
          },
          "401": {
            $ref: "#/components/responses/Unauthorized",
          },
          "403": {
            $ref: "#/components/responses/Forbidden",
          },
        },
      },
    },
    "/v1/admit": {
      post: {
        tags: ["Resident"],
        summary: "Admit a resident",
        description: `
Adds a new resident to the network.

**Permission**: Owner only
        `,
        operationId: "admitResident",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/AdmitRequest",
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Resident admitted",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/CommandResponse",
                },
              },
            },
          },
          "200": {
            description: "Idempotent request (already processed)",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/CommandResponse",
                },
              },
            },
          },
          "400": {
            $ref: "#/components/responses/ValidationError",
          },
          "401": {
            $ref: "#/components/responses/Unauthorized",
          },
          "403": {
            $ref: "#/components/responses/Forbidden",
          },
          "409": {
            description: "Account or resident already exists",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ErrorResponse",
                },
              },
            },
          },
        },
      },
    },
    "/v1/transact": {
      post: {
        tags: ["Transaction"],
        summary: "Execute a transaction",
        description: `
Executes a transaction between residents.

**Permission**: Sender's account owner, or network owner
        `,
        operationId: "executeTransaction",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/TransactRequest",
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Transaction executed",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/CommandResponse",
                },
              },
            },
          },
          "200": {
            description: "Idempotent request (already processed)",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/CommandResponse",
                },
              },
            },
          },
          "400": {
            $ref: "#/components/responses/ValidationError",
          },
          "401": {
            $ref: "#/components/responses/Unauthorized",
          },
          "403": {
            $ref: "#/components/responses/Forbidden",
          },
          "404": {
            description: "Resident not found",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ErrorResponse",
                },
              },
            },
          },
        },
      },
    },
    "/v1/migrate": {
      post: {
        tags: ["System"],
        summary: "Migrate schema",
        description: `
Migrates the network schema version.

**Permission**: Owner only
        `,
        operationId: "migrateSchema",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/MigrateRequest",
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Migration completed",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/CommandResponse",
                },
              },
            },
          },
          "400": {
            $ref: "#/components/responses/ValidationError",
          },
          "401": {
            $ref: "#/components/responses/Unauthorized",
          },
          "403": {
            $ref: "#/components/responses/Forbidden",
          },
        },
      },
    },
    "/v1/state": {
      get: {
        tags: ["System"],
        summary: "Get current state",
        description: "Gets the current state of the network",
        operationId: "getState",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Current state",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/NetworkState",
                },
              },
            },
          },
          "401": {
            $ref: "#/components/responses/Unauthorized",
          },
        },
      },
    },
    "/v1/residents": {
      get: {
        tags: ["Resident"],
        summary: "List residents",
        description: "Gets the list of network residents",
        operationId: "listResidents",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Resident list",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ResidentListResponse",
                },
              },
            },
          },
          "401": {
            $ref: "#/components/responses/Unauthorized",
          },
        },
      },
    },
    "/v1/residents/{residentId}": {
      get: {
        tags: ["Resident"],
        summary: "Get resident details",
        description: "Gets detailed information about a specific resident",
        operationId: "getResident",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "residentId",
            in: "path",
            required: true,
            schema: {
              type: "string",
              format: "uuid",
            },
            description: "Resident ID",
          },
        ],
        responses: {
          "200": {
            description: "Resident details",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Resident",
                },
              },
            },
          },
          "401": {
            $ref: "#/components/responses/Unauthorized",
          },
          "404": {
            description: "Resident not found",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ErrorResponse",
                },
              },
            },
          },
        },
      },
    },
    "/v1/ledger": {
      get: {
        tags: ["Transaction"],
        summary: "Get ledger",
        description: "Gets the transaction history (ledger)",
        operationId: "getLedger",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "limit",
            in: "query",
            schema: {
              type: "integer",
              minimum: 1,
              maximum: 100,
              default: 50,
            },
            description: "Number of entries to retrieve",
          },
          {
            name: "offset",
            in: "query",
            schema: {
              type: "integer",
              minimum: 0,
              default: 0,
            },
            description: "Offset",
          },
          {
            name: "residentId",
            in: "query",
            schema: {
              type: "string",
              format: "uuid",
            },
            description: "Filter by resident ID",
          },
        ],
        responses: {
          "200": {
            description: "Ledger entries",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/LedgerResponse",
                },
              },
            },
          },
          "401": {
            $ref: "#/components/responses/Unauthorized",
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "Bearer token format: `account:<accountId>`",
      },
    },
    parameters: {
      IdempotencyKey: {
        name: "Idempotency-Key",
        in: "header",
        required: false,
        schema: {
          type: "string",
        },
        description: "Idempotency key. Requests with the same key are processed only once.",
      },
    },
    schemas: {
      RootResponse: {
        type: "object",
        required: ["name", "version", "status"],
        properties: {
          name: {
            type: "string",
            example: "vouch",
          },
          version: {
            type: "string",
            example: "1.0.0",
          },
          status: {
            type: "string",
            enum: ["ok"],
          },
        },
      },
      HealthResponse: {
        type: "object",
        required: ["status", "founded", "seq"],
        properties: {
          status: {
            type: "string",
            enum: ["ok"],
          },
          regionId: {
            type: "string",
            nullable: true,
            description: "Region ID (null if not founded)",
          },
          seq: {
            type: "integer",
            description: "Current sequence number",
          },
          founded: {
            type: "boolean",
            description: "Whether the network has been founded",
          },
        },
      },
      FoundRequest: {
        type: "object",
        required: ["regionId", "ownerEmail"],
        properties: {
          regionId: {
            type: "string",
            minLength: 1,
            maxLength: 64,
            description: "Region ID",
            example: "tokyo-1",
          },
          ownerEmail: {
            type: "string",
            format: "email",
            description: "Owner's email address",
            example: "owner@example.com",
          },
        },
      },
      ExecuteRequest: {
        type: "object",
        required: ["commands"],
        properties: {
          commands: {
            type: "array",
            minItems: 1,
            items: {
              $ref: "#/components/schemas/Command",
            },
            description: "Array of commands to execute",
          },
        },
      },
      Command: {
        type: "object",
        required: ["name"],
        properties: {
          name: {
            type: "string",
            description: "Command name",
            enum: ["establish", "admit", "amend", "transact", "createAssetType", "createAsset"],
          },
        },
        additionalProperties: true,
        description: "Command object. Additional properties depend on the command type.",
      },
      SimulateResponse: {
        type: "object",
        required: ["ok", "valid", "seq", "eventCount", "schemaVersion"],
        properties: {
          ok: {
            type: "boolean",
            description: "Whether the operation succeeded",
          },
          valid: {
            type: "boolean",
            description: "Whether the commands would execute successfully",
          },
          seq: {
            type: "integer",
            description: "Resulting sequence number",
          },
          eventCount: {
            type: "integer",
            description: "Number of events that would be generated",
          },
          schemaVersion: {
            type: "integer",
            description: "Current schema version",
          },
        },
      },
      SimulateErrorResponse: {
        type: "object",
        required: ["ok", "valid", "error"],
        properties: {
          ok: {
            type: "boolean",
            example: false,
          },
          valid: {
            type: "boolean",
            example: false,
          },
          error: {
            type: "object",
            properties: {
              code: {
                type: "string",
              },
              message: {
                type: "string",
              },
              requestId: {
                type: "string",
              },
              details: {
                type: "array",
                items: {
                  type: "object",
                },
              },
            },
          },
        },
      },
      AmendRequest: {
        type: "object",
        required: ["changes"],
        properties: {
          changes: {
            type: "object",
            properties: {
              ownerId: {
                type: "string",
                format: "uuid",
                description: "New owner's account ID",
              },
            },
          },
        },
      },
      AdmitRequest: {
        type: "object",
        required: ["accountId", "email", "residentId", "name"],
        properties: {
          accountId: {
            type: "string",
            format: "uuid",
            description: "Account ID",
          },
          email: {
            type: "string",
            format: "email",
            description: "Email address",
          },
          residentId: {
            type: "string",
            format: "uuid",
            description: "Resident ID",
          },
          name: {
            type: "string",
            minLength: 1,
            description: "Resident name",
            example: "John Doe",
          },
          initialStatus: {
            type: "string",
            enum: ["pending", "active", "suspended"],
            default: "active",
            description: "Initial status",
          },
        },
      },
      TransactRequest: {
        type: "object",
        required: ["fromResidentId", "toResidentId", "amount"],
        properties: {
          fromResidentId: {
            type: "string",
            format: "uuid",
            description: "Sender resident ID",
          },
          toResidentId: {
            type: "string",
            format: "uuid",
            description: "Recipient resident ID",
          },
          amount: {
            type: "string",
            pattern: "^[1-9]\\d*(\\.\\d+)?$|^0\\.\\d*[1-9]\\d*$",
            description: "Amount (string format for precision)",
            example: "100.50",
          },
          memo: {
            type: "string",
            maxLength: 500,
            default: "",
            description: "Memo",
          },
        },
      },
      MigrateRequest: {
        type: "object",
        required: ["targetVersion"],
        properties: {
          targetVersion: {
            type: "integer",
            minimum: 1,
            description: "Target migration version",
          },
        },
      },
      CommandResponse: {
        type: "object",
        required: ["ok", "seq", "idempotent", "schemaVersion"],
        properties: {
          ok: {
            type: "boolean",
            description: "Whether the operation succeeded",
          },
          seq: {
            type: "integer",
            description: "Command sequence number",
          },
          idempotent: {
            type: "boolean",
            description: "Whether this was an idempotent request (already processed)",
          },
          schemaVersion: {
            type: "integer",
            description: "Current schema version",
          },
        },
      },
      NetworkState: {
        type: "object",
        properties: {
          regionId: {
            type: "string",
            description: "Region ID",
          },
          ownerId: {
            type: "string",
            description: "Owner's account ID",
          },
          seq: {
            type: "integer",
            description: "Current sequence number",
          },
          createdAt: {
            type: "string",
            format: "date-time",
          },
          updatedAt: {
            type: "string",
            format: "date-time",
          },
          accountCount: {
            type: "integer",
            description: "Number of accounts",
          },
          residentCount: {
            type: "integer",
            description: "Number of residents",
          },
          ledgerCount: {
            type: "integer",
            description: "Number of ledger entries",
          },
        },
      },
      Resident: {
        type: "object",
        properties: {
          id: {
            type: "string",
            format: "uuid",
          },
          accountId: {
            type: "string",
            format: "uuid",
          },
          regionId: {
            type: "string",
          },
          name: {
            type: "string",
          },
          status: {
            type: "string",
            enum: ["pending", "active", "suspended"],
          },
          createdAt: {
            type: "string",
            format: "date-time",
          },
          updatedAt: {
            type: "string",
            format: "date-time",
          },
        },
      },
      ResidentListResponse: {
        type: "object",
        properties: {
          residents: {
            type: "array",
            items: {
              $ref: "#/components/schemas/Resident",
            },
          },
          total: {
            type: "integer",
          },
        },
      },
      LedgerEntry: {
        type: "object",
        properties: {
          id: {
            type: "string",
            format: "uuid",
          },
          fromResidentId: {
            type: "string",
            format: "uuid",
          },
          toResidentId: {
            type: "string",
            format: "uuid",
          },
          amount: {
            type: "string",
          },
          memo: {
            type: "string",
          },
          seq: {
            type: "integer",
          },
          createdAt: {
            type: "string",
            format: "date-time",
          },
        },
      },
      LedgerResponse: {
        type: "object",
        properties: {
          entries: {
            type: "array",
            items: {
              $ref: "#/components/schemas/LedgerEntry",
            },
          },
          total: {
            type: "integer",
          },
          limit: {
            type: "integer",
          },
          offset: {
            type: "integer",
          },
        },
      },
      ErrorResponse: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message", "requestId"],
            properties: {
              code: {
                type: "string",
                description: "Error code",
                example: "VALIDATION_ERROR",
              },
              message: {
                type: "string",
                description: "Error message",
              },
              requestId: {
                type: "string",
                description: "Request ID (for troubleshooting)",
              },
              details: {
                type: "array",
                description: "Validation error details",
                items: {
                  type: "object",
                  properties: {
                    path: {
                      type: "string",
                    },
                    message: {
                      type: "string",
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    responses: {
      ValidationError: {
        description: "Validation error",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/ErrorResponse",
            },
            example: {
              error: {
                code: "VALIDATION_ERROR",
                message: "Request validation failed",
                requestId: "uuid",
                details: [
                  {
                    path: "email",
                    message: "Invalid email format",
                  },
                ],
              },
            },
          },
        },
      },
      Unauthorized: {
        description: "Authentication error",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/ErrorResponse",
            },
            example: {
              error: {
                code: "UNAUTHORIZED",
                message: "Missing Authorization header",
                requestId: "uuid",
              },
            },
          },
        },
      },
      Forbidden: {
        description: "Permission error",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/ErrorResponse",
            },
            example: {
              error: {
                code: "FORBIDDEN",
                message: "Owner access required",
                requestId: "uuid",
              },
            },
          },
        },
      },
    },
  },
} as const;
