/**
 * Domain-level errors
 */

export type ErrorCode =
  | "NETWORK_ALREADY_FOUNDED"
  | "NETWORK_NOT_FOUNDED"
  | "ACCOUNT_NOT_FOUND"
  | "ACCOUNT_ALREADY_EXISTS"
  | "RESIDENT_NOT_FOUND"
  | "RESIDENT_ALREADY_EXISTS"
  | "ASSET_TYPE_NOT_FOUND"
  | "ASSET_TYPE_ALREADY_EXISTS"
  | "ASSET_NOT_FOUND"
  | "ASSET_ALREADY_EXISTS"
  | "INSUFFICIENT_BALANCE"
  | "INVALID_AMOUNT"
  | "SELF_TRANSACTION"
  | "RESIDENT_NOT_ACTIVE"
  | "FORBIDDEN"
  | "IDEMPOTENT_CONFLICT"
  | "SCHEMA_VERSION_MISMATCH"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "UNKNOWN_COMMAND";

export class DomainError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
    public readonly status: number = 400
  ) {
    super(message);
    this.name = "DomainError";
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

export function networkAlreadyFounded(): DomainError {
  return new DomainError(
    "NETWORK_ALREADY_FOUNDED",
    "Network has already been founded",
    undefined,
    409
  );
}

export function networkNotFounded(): DomainError {
  return new DomainError(
    "NETWORK_NOT_FOUNDED",
    "Network has not been founded yet",
    undefined,
    400
  );
}

export function accountNotFound(id: string): DomainError {
  return new DomainError(
    "ACCOUNT_NOT_FOUND",
    `Account not found: ${id}`,
    { accountId: id },
    404
  );
}

export function accountAlreadyExists(id: string): DomainError {
  return new DomainError(
    "ACCOUNT_ALREADY_EXISTS",
    `Account already exists: ${id}`,
    { accountId: id },
    409
  );
}

export function residentNotFound(id: string): DomainError {
  return new DomainError(
    "RESIDENT_NOT_FOUND",
    `Resident not found: ${id}`,
    { residentId: id },
    404
  );
}

export function residentAlreadyExists(id: string): DomainError {
  return new DomainError(
    "RESIDENT_ALREADY_EXISTS",
    `Resident already exists: ${id}`,
    { residentId: id },
    409
  );
}

export function insufficientBalance(): DomainError {
  return new DomainError(
    "INSUFFICIENT_BALANCE",
    "Insufficient balance for transaction"
  );
}

export function invalidAmount(): DomainError {
  return new DomainError("INVALID_AMOUNT", "Invalid transaction amount");
}

export function selfTransaction(): DomainError {
  return new DomainError(
    "SELF_TRANSACTION",
    "Cannot transact with yourself"
  );
}

export function residentNotActive(id: string): DomainError {
  return new DomainError(
    "RESIDENT_NOT_ACTIVE",
    `Resident is not active: ${id}`,
    { residentId: id }
  );
}

export function forbidden(message: string = "Access denied"): DomainError {
  return new DomainError("FORBIDDEN", message, undefined, 403);
}

export function validationError(message: string, field?: string): DomainError {
  return new DomainError(
    "VALIDATION_ERROR",
    message,
    field ? { field } : undefined,
    400
  );
}

export function notFound(entity: string, id: string): DomainError {
  return new DomainError(
    "NOT_FOUND",
    `${entity} not found: ${id}`,
    { entity, id },
    404
  );
}

export function alreadyExists(entity: string, id: string): DomainError {
  return new DomainError(
    "ALREADY_EXISTS",
    `${entity} already exists: ${id}`,
    { entity, id },
    409
  );
}

export function unknownCommand(commandName: string): DomainError {
  return new DomainError(
    "UNKNOWN_COMMAND",
    `Unknown command: ${commandName}`,
    { command: commandName },
    400
  );
}
