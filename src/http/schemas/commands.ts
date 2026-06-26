/**
 * Command request schemas
 */

import { z } from "zod";
import {
  Amount,
  UUID,
  NonEmptyString,
  Email,
  RegionId,
  ResidentStatus,
} from "./common.js";

/** Found command request */
export const foundSchema = z
  .object({
    regionId: RegionId,
    ownerEmail: Email,
  })
  .strict();

export type FoundRequest = z.infer<typeof foundSchema>;

/** Amend command request */
export const amendSchema = z
  .object({
    changes: z
      .object({
        ownerId: UUID.optional(),
      })
      .strict(),
  })
  .strict();

export type AmendRequest = z.infer<typeof amendSchema>;

/** Admit command request */
export const admitSchema = z
  .object({
    accountId: UUID,
    email: Email,
    residentId: UUID,
    name: NonEmptyString,
    initialStatus: ResidentStatus.optional(),
  })
  .strict();

export type AdmitRequest = z.infer<typeof admitSchema>;

/** Transact command request */
export const transactSchema = z
  .object({
    fromResidentId: UUID,
    toResidentId: UUID,
    amount: Amount,
    memo: z.string().max(500).default(""),
  })
  .strict();

export type TransactRequest = z.infer<typeof transactSchema>;

/** Migrate command request */
export const migrateSchema = z
  .object({
    targetVersion: z.number().int().positive(),
  })
  .strict();

export type MigrateRequest = z.infer<typeof migrateSchema>;
