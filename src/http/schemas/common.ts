/**
 * Common Zod schemas for request validation
 */

import { z } from "zod";

/** Decimal amount (string to preserve precision) */
export const Amount = z.string().regex(/^[1-9]\d*(\.\d+)?$|^0\.\d*[1-9]\d*$/, "Invalid amount format");

/** UUID format */
export const UUID = z.string().uuid();

/** Non-empty string */
export const NonEmptyString = z.string().min(1);

/** Email format */
export const Email = z.string().email();

/** Region ID format */
export const RegionId = z.string().min(1).max(64);

/** Resident status */
export const ResidentStatus = z.enum(["pending", "active", "suspended"]);
