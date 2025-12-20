/**
 * NotebookLM Quota Manager
 *
 * Manages license tier detection, usage tracking, and limit enforcement.
 */

import type { Page } from "patchright";
import { log } from "../utils/logger.js";
import { CONFIG } from "../config.js";
import fs from "fs";
import path from "path";

export type LicenseTier = "free" | "pro" | "ultra" | "unknown";

export interface QuotaLimits {
  notebooks: number;
  sourcesPerNotebook: number;
  wordsPerSource: number;
  queriesPerDay: number;
}

export interface QuotaUsage {
  notebooks: number;
  queriesUsedToday: number;
  lastQueryDate: string;
  lastUpdated: string;
}

export interface QuotaSettings {
  tier: LicenseTier;
  limits: QuotaLimits;
  usage: QuotaUsage;
  autoDetected: boolean;
}

// Known limits by tier (based on NotebookLM documentation Dec 2025)
// https://support.google.com/notebooklm/answer/16213268
const TIER_LIMITS: Record<LicenseTier, QuotaLimits> = {
  free: {
    notebooks: 100,
    sourcesPerNotebook: 50,
    wordsPerSource: 500000,
    queriesPerDay: 50,
  },
  pro: {
    notebooks: 500,
    sourcesPerNotebook: 300,
    wordsPerSource: 500000,
    queriesPerDay: 500,
  },
  ultra: {
    notebooks: 500,
    sourcesPerNotebook: 600,
    wordsPerSource: 500000,
    queriesPerDay: 5000,
  },
  unknown: {
    // Conservative defaults (use free tier limits)
    notebooks: 100,
    sourcesPerNotebook: 50,
    wordsPerSource: 500000,
    queriesPerDay: 50,
  },
};

export class QuotaManager {
  private settings: QuotaSettings;
  private settingsPath: string;

  constructor() {
    this.settingsPath = path.join(CONFIG.configDir, "quota.json");
    this.settings = this.loadSettings();
  }

  /**
   * Load settings from disk or create defaults
   */
  private loadSettings(): QuotaSettings {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const data = fs.readFileSync(this.settingsPath, "utf-8");
        const loaded = JSON.parse(data) as QuotaSettings;
        log.info(`📊 Loaded quota settings (tier: ${loaded.tier})`);
        return loaded;
      }
    } catch (error) {
      log.warning(`⚠️ Could not load quota settings: ${error}`);
    }

    // Return defaults
    return this.getDefaultSettings();
  }

  /**
   * Get default settings
   */
  private getDefaultSettings(): QuotaSettings {
    return {
      tier: "unknown",
      limits: TIER_LIMITS.unknown,
      usage: {
        notebooks: 0,
        queriesUsedToday: 0,
        lastQueryDate: new Date().toISOString().split("T")[0],
        lastUpdated: new Date().toISOString(),
      },
      autoDetected: false,
    };
  }

  /**
   * Save settings to disk
   */
  private saveSettings(): void {
    try {
      const dir = path.dirname(this.settingsPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
      fs.writeFileSync(
        this.settingsPath,
        JSON.stringify(this.settings, null, 2),
        { mode: 0o600 }
      );
      log.info(`💾 Saved quota settings`);
    } catch (error) {
      log.error(`❌ Could not save quota settings: ${error}`);
    }
  }

  /**
   * Detect license tier from NotebookLM UI
   * Tiers: free, pro, ultra (Google AI Ultra $249.99/month)
   */
  async detectTierFromPage(page: Page): Promise<LicenseTier> {
    log.info("🔍 Detecting license tier...");

    const tierInfo = await page.evaluate(() => {
      // @ts-expect-error - DOM types
      const allText = document.body.innerText.toUpperCase();

      // Check for ULTRA first (highest tier)
      // @ts-expect-error - DOM types
      const ultraBadge = document.querySelector(".ultra-badge, [class*='ultra']");
      if (ultraBadge || allText.includes("ULTRA")) {
        return "ultra";
      }

      // Look for PRO badge
      // @ts-expect-error - DOM types
      const proBadge = document.querySelector(".pro-badge");
      if (proBadge) {
        return "pro";
      }

      // Look for PRO text in specific elements
      // @ts-expect-error - DOM types
      const proLabels = document.querySelectorAll(".pro-label, [class*='pro']");
      for (const el of proLabels) {
        if ((el as any).textContent?.toUpperCase().includes("PRO")) {
          return "pro";
        }
      }

      // Check for upgrade prompts (indicates free tier)
      if (allText.includes("UPGRADE") && !allText.includes("PRO") && !allText.includes("ULTRA")) {
        return "free";
      }

      return "unknown";
    });

    log.info(`  Detected tier: ${tierInfo}`);
    return tierInfo as LicenseTier;
  }

  /**
   * Extract source limit from source dialog (e.g., "0/300")
   */
  async extractSourceLimitFromDialog(page: Page): Promise<number | null> {
    const limitInfo = await page.evaluate(() => {
      // Look for X/Y pattern
      // @ts-expect-error - DOM types
      const allText = document.body.innerText;
      const match = allText.match(/(\d+)\s*\/\s*(\d+)/);
      if (match) {
        return parseInt(match[2], 10); // Return the limit (Y in X/Y)
      }
      return null;
    });

    return limitInfo;
  }

  /**
   * Count notebooks from homepage
   */
  async countNotebooksFromPage(page: Page): Promise<number> {
    const count = await page.evaluate(() => {
      // Count table rows that have "Source" in them (notebook rows)
      // @ts-expect-error - DOM types
      const rows = document.querySelectorAll("tr");
      let count = 0;
      for (const row of rows) {
        if ((row as any).textContent?.includes("Source")) {
          count++;
        }
      }
      return count;
    });

    return count;
  }

  /**
   * Update quota from UI scraping
   */
  async updateFromUI(page: Page): Promise<void> {
    log.info("📊 Updating quota from UI...");

    // Detect tier
    const tier = await this.detectTierFromPage(page);
    if (tier !== "unknown") {
      this.settings.tier = tier;
      this.settings.limits = TIER_LIMITS[tier];
      this.settings.autoDetected = true;
    }

    // Count notebooks
    const notebookCount = await this.countNotebooksFromPage(page);
    if (notebookCount > 0) {
      this.settings.usage.notebooks = notebookCount;
    }

    // Try to get source limit from dialog if visible
    const sourceLimit = await this.extractSourceLimitFromDialog(page);
    if (sourceLimit) {
      this.settings.limits.sourcesPerNotebook = sourceLimit;
    }

    this.settings.usage.lastUpdated = new Date().toISOString();
    this.saveSettings();

    log.success(`✅ Quota updated: tier=${this.settings.tier}, notebooks=${this.settings.usage.notebooks}`);
  }

  /**
   * Manually set tier (for user override)
   */
  setTier(tier: LicenseTier): void {
    this.settings.tier = tier;
    this.settings.limits = TIER_LIMITS[tier];
    this.settings.autoDetected = false;
    this.saveSettings();
    log.info(`📊 Tier set to: ${tier}`);
  }

  /**
   * Get current settings
   */
  getSettings(): QuotaSettings {
    return { ...this.settings };
  }

  /**
   * Get current limits
   */
  getLimits(): QuotaLimits {
    return { ...this.settings.limits };
  }

  /**
   * Get current usage
   */
  getUsage(): QuotaUsage {
    return { ...this.settings.usage };
  }

  /**
   * Increment notebook count
   */
  incrementNotebookCount(): void {
    this.settings.usage.notebooks++;
    this.settings.usage.lastUpdated = new Date().toISOString();
    this.saveSettings();
  }

  /**
   * Increment query count
   */
  incrementQueryCount(): void {
    const today = new Date().toISOString().split("T")[0];

    // Reset if new day
    if (this.settings.usage.lastQueryDate !== today) {
      this.settings.usage.queriesUsedToday = 0;
      this.settings.usage.lastQueryDate = today;
    }

    this.settings.usage.queriesUsedToday++;
    this.settings.usage.lastUpdated = new Date().toISOString();
    this.saveSettings();
  }

  /**
   * Check if can create notebook
   */
  canCreateNotebook(): { allowed: boolean; reason?: string } {
    const { notebooks } = this.settings.usage;
    const { notebooks: limit } = this.settings.limits;

    if (notebooks >= limit) {
      return {
        allowed: false,
        reason: `Notebook limit reached (${notebooks}/${limit}). Delete notebooks or upgrade your plan.`,
      };
    }

    // Warn if approaching limit
    if (notebooks >= limit * 0.9) {
      log.warning(`⚠️ Approaching notebook limit: ${notebooks}/${limit}`);
    }

    return { allowed: true };
  }

  /**
   * Check if can add source to notebook
   */
  canAddSource(currentSourceCount: number): { allowed: boolean; reason?: string } {
    const { sourcesPerNotebook: limit } = this.settings.limits;

    if (currentSourceCount >= limit) {
      return {
        allowed: false,
        reason: `Source limit reached for this notebook (${currentSourceCount}/${limit}).`,
      };
    }

    return { allowed: true };
  }

  /**
   * Check if can make query
   */
  canMakeQuery(): { allowed: boolean; reason?: string } {
    const today = new Date().toISOString().split("T")[0];

    // Reset if new day
    if (this.settings.usage.lastQueryDate !== today) {
      this.settings.usage.queriesUsedToday = 0;
      this.settings.usage.lastQueryDate = today;
    }

    const { queriesUsedToday } = this.settings.usage;
    const { queriesPerDay: limit } = this.settings.limits;

    if (queriesUsedToday >= limit) {
      return {
        allowed: false,
        reason: `Daily query limit reached (${queriesUsedToday}/${limit}). Try again tomorrow or upgrade your plan.`,
      };
    }

    // Warn if approaching limit
    if (queriesUsedToday >= limit * 0.8) {
      log.warning(`⚠️ Approaching daily query limit: ${queriesUsedToday}/${limit}`);
    }

    return { allowed: true };
  }

  /**
   * Get quota status summary
   */
  getStatus(): {
    tier: LicenseTier;
    notebooks: { used: number; limit: number; percent: number };
    sources: { limit: number };
    queries: { used: number; limit: number; percent: number };
  } {
    const { tier, limits, usage } = this.settings;

    return {
      tier,
      notebooks: {
        used: usage.notebooks,
        limit: limits.notebooks,
        percent: Math.round((usage.notebooks / limits.notebooks) * 100),
      },
      sources: {
        limit: limits.sourcesPerNotebook,
      },
      queries: {
        used: usage.queriesUsedToday,
        limit: limits.queriesPerDay,
        percent: Math.round((usage.queriesUsedToday / limits.queriesPerDay) * 100),
      },
    };
  }
}

// Singleton instance
let quotaManagerInstance: QuotaManager | null = null;

export function getQuotaManager(): QuotaManager {
  if (!quotaManagerInstance) {
    quotaManagerInstance = new QuotaManager();
  }
  return quotaManagerInstance;
}
