/**
 * Quota Management Module
 *
 * Exports quota management functionality for license tier detection,
 * usage tracking, and limit enforcement.
 */

export {
  QuotaManager,
  getQuotaManager,
  type LicenseTier,
  type QuotaLimits,
  type QuotaUsage,
  type QuotaSettings,
} from "./quota-manager.js";
