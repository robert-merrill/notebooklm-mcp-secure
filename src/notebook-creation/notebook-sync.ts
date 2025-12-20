/**
 * NotebookLM Library Sync
 *
 * Syncs local library with actual NotebookLM notebooks.
 * Detects stale entries, extracts real URLs, and offers cleanup.
 */

import type { Page } from "patchright";
import { log } from "../utils/logger.js";
import { randomDelay } from "../utils/stealth-utils.js";
import { CONFIG } from "../config.js";
import { AuthManager } from "../auth/auth-manager.js";
import { SharedContextManager } from "../session/shared-context-manager.js";
import type { NotebookLibrary } from "../library/notebook-library.js";

const NOTEBOOKLM_URL = "https://notebooklm.google.com/";

export interface ActualNotebook {
  title: string;
  url: string;
  sourceCount: number;
  createdDate: string;
}

export interface SyncResult {
  actualNotebooks: ActualNotebook[];
  matched: Array<{
    libraryId: string;
    libraryName: string;
    actualTitle: string;
    actualUrl: string;
  }>;
  staleEntries: Array<{
    libraryId: string;
    libraryName: string;
    libraryUrl: string;
    reason: string;
  }>;
  missingNotebooks: ActualNotebook[];
  suggestions: string[];
}

/**
 * Syncs library with actual NotebookLM notebooks
 */
export class NotebookSync {
  private page: Page | null = null;

  constructor(
    private authManager: AuthManager,
    private contextManager: SharedContextManager,
    private library: NotebookLibrary
  ) {}

  /**
   * Sync library with actual NotebookLM notebooks
   */
  async syncLibrary(options?: {
    autoFix?: boolean;
    showBrowser?: boolean;
  }): Promise<SyncResult> {
    try {
      log.info("🔄 Starting library sync...");

      // Initialize browser
      await this.initialize(options?.showBrowser);

      // Extract actual notebooks from NotebookLM
      const actualNotebooks = await this.extractNotebooks();
      log.info(`📚 Found ${actualNotebooks.length} notebooks in NotebookLM`);

      // Get library entries
      const libraryEntries = this.library.listNotebooks();
      log.info(`📖 Library has ${libraryEntries.length} entries`);

      // Compare and categorize
      const result = this.compareLibraryWithActual(libraryEntries, actualNotebooks);

      // Log summary
      this.logSyncSummary(result);

      // Auto-fix if requested
      if (options?.autoFix && result.staleEntries.length > 0) {
        await this.autoFixStaleEntries(result.staleEntries);
      }

      return result;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Extract all notebooks from NotebookLM homepage
   */
  async extractNotebooks(): Promise<ActualNotebook[]> {
    if (!this.page) throw new Error("Page not initialized");

    log.info("📋 Extracting notebooks from NotebookLM...");

    // Wait for page to fully load
    await this.page.waitForLoadState("networkidle").catch(() => {});
    await randomDelay(2000, 3000);

    // Try to click on "My notebooks" tab if it exists
    try {
      // Find tab by evaluating text content
      const clicked = await this.page.evaluate(() => {
        // @ts-expect-error - DOM types
        const tabs = document.querySelectorAll('button, [role="tab"]');
        for (const tab of tabs) {
          if ((tab as any).textContent?.includes("My notebooks")) {
            (tab as any).click();
            return true;
          }
        }
        return false;
      });
      if (clicked) {
        log.info("  📂 Clicked 'My notebooks' tab");
        await randomDelay(1500, 2000);
      }
    } catch {
      // Tab might already be selected or doesn't exist
    }

    // Wait for notebook list to load - try multiple selectors
    await Promise.race([
      this.page.waitForSelector('a[href*="/notebook/"]', { timeout: 15000 }),
      this.page.waitForSelector('[data-notebook-id]', { timeout: 15000 }),
      this.page.waitForSelector('table', { timeout: 15000 }),
    ]).catch(() => {});
    await randomDelay(2000, 3000);

    // Debug: Log what we can see on the page
    const pageContent = await this.page.evaluate(() => {
      // @ts-expect-error - DOM types
      return document.body.innerText.substring(0, 500);
    });
    log.dim(`  Page preview: ${pageContent.replace(/\n/g, " ").substring(0, 200)}...`);

    // Extract notebook data from the page - notebooks may not be <a> tags
    const notebooks = await this.page.evaluate(() => {
      const results: Array<{
        title: string;
        url: string;
        sourceCount: number;
        createdDate: string;
      }> = [];

      // Strategy 1: Find table rows that look like notebook entries
      // @ts-expect-error - DOM types available in browser context
      const rows = document.querySelectorAll('tr');

      for (const row of rows) {
        const rowText = (row as any).textContent || "";

        // Skip header rows or rows without source count
        if (!rowText.match(/\d+\s*Source/i)) continue;

        // Get the title - first cell with substantial text
        let title = "";
        const cells = (row as any).querySelectorAll('td, th');
        for (const cell of cells) {
          const cellText = cell.textContent?.trim() || "";
          // Skip cells that are just icons, numbers, dates, or role
          if (cellText.length > 3 &&
              !cellText.match(/^[\d\s]+$/) &&
              !cellText.match(/^\d+\s*Source/i) &&
              !cellText.match(/^\d{1,2}\s+\w{3}\s+\d{4}$/) &&
              !cellText.match(/^(Owner|Viewer|Editor)$/i)) {
            title = cellText;
            break;
          }
        }

        if (!title || title.length < 3) continue;

        // Clean up title - remove emoji prefixes
        title = title.replace(/^[🔓🔒📁📄🔐]\s*/, "").trim();

        // Extract source count
        let sourceCount = 0;
        const sourceMatch = rowText.match(/(\d+)\s*Source/i);
        if (sourceMatch) sourceCount = parseInt(sourceMatch[1], 10);

        // Extract date
        let createdDate = "";
        const dateMatch = rowText.match(/(\d{1,2}\s+\w{3}\s+\d{4})/);
        if (dateMatch) createdDate = dateMatch[1];

        // Try to find notebook URL - look for any link in the row
        let url = "";
        const links = (row as any).querySelectorAll('a');
        for (const link of links) {
          const href = link.href || "";
          if (href.includes('/notebook/')) {
            url = href;
            break;
          }
        }

        // If no direct link, try data attributes
        if (!url) {
          const dataId = (row as any).getAttribute('data-notebook-id') ||
                        (row as any).getAttribute('data-id') ||
                        (row as any).querySelector('[data-notebook-id]')?.getAttribute('data-notebook-id');
          if (dataId) {
            url = `https://notebooklm.google.com/notebook/${dataId}`;
          }
        }

        // If still no URL, we'll construct it from the row index (placeholder)
        if (!url) {
          // Note: This is a placeholder - we'll need to click to get the real URL
          url = `pending-${results.length}`;
        }

        results.push({ title, url, sourceCount, createdDate });
      }

      return results;
    });

    // Debug: Log what we found
    log.dim(`  Extracted ${notebooks.length} notebooks from page`);

    // Deduplicate by URL
    const uniqueNotebooks = notebooks.filter((notebook, index, self) =>
      index === self.findIndex(n => n.url === notebook.url)
    );

    log.success(`✅ Extracted ${uniqueNotebooks.length} notebooks`);
    return uniqueNotebooks;
  }

  /**
   * Compare library entries with actual notebooks
   */
  private compareLibraryWithActual(
    libraryEntries: Array<{ id: string; name: string; url: string }>,
    actualNotebooks: ActualNotebook[]
  ): SyncResult {
    const matched: SyncResult["matched"] = [];
    const staleEntries: SyncResult["staleEntries"] = [];
    const suggestions: string[] = [];

    // Track which actual notebooks are matched
    const matchedActualIndices = new Set<number>();

    // Check each library entry
    for (const entry of libraryEntries) {
      // Extract notebook ID from URL
      const libraryNotebookId = this.extractNotebookId(entry.url);

      // Try to find matching actual notebook
      let matchingActualIndex: number = -1;

      // First try: match by URL/ID
      for (let i = 0; i < actualNotebooks.length; i++) {
        const actual = actualNotebooks[i];
        const actualNotebookId = this.extractNotebookId(actual.url);
        if (actualNotebookId === libraryNotebookId && !actual.url.startsWith("pending-")) {
          matchingActualIndex = i;
          break;
        }
      }

      // Second try: match by title similarity (fuzzy match)
      if (matchingActualIndex < 0) {
        const normalizedEntryName = this.normalizeTitle(entry.name);
        for (let i = 0; i < actualNotebooks.length; i++) {
          if (matchedActualIndices.has(i)) continue; // Already matched
          const actual = actualNotebooks[i];
          const normalizedActualTitle = this.normalizeTitle(actual.title);

          // Check for significant overlap
          if (this.titlesMatch(normalizedEntryName, normalizedActualTitle)) {
            matchingActualIndex = i;
            break;
          }
        }
      }

      if (matchingActualIndex >= 0) {
        const matchingActual = actualNotebooks[matchingActualIndex];
        matched.push({
          libraryId: entry.id,
          libraryName: entry.name,
          actualTitle: matchingActual.title,
          actualUrl: matchingActual.url,
        });
        matchedActualIndices.add(matchingActualIndex);

        // Check if name differs significantly
        const cleanActualTitle = this.normalizeTitle(matchingActual.title);
        const cleanEntryName = this.normalizeTitle(entry.name);
        if (cleanEntryName !== cleanActualTitle) {
          suggestions.push(
            `📝 "${entry.name}" matches "${matchingActual.title}" (consider updating library entry)`
          );
        }
      } else {
        staleEntries.push({
          libraryId: entry.id,
          libraryName: entry.name,
          libraryUrl: entry.url,
          reason: "Notebook not found in NotebookLM (may be deleted or URL changed)",
        });
      }
    }

    // Find notebooks not in library
    const missingNotebooks = actualNotebooks.filter(
      (_, index) => !matchedActualIndices.has(index)
    );

    // Generate suggestions
    if (staleEntries.length > 0) {
      suggestions.unshift(
        `🗑️  ${staleEntries.length} stale library entries should be removed`
      );
    }
    if (missingNotebooks.length > 0) {
      suggestions.push(
        `➕ ${missingNotebooks.length} notebooks could be added to library`
      );
    }

    return {
      actualNotebooks,
      matched,
      staleEntries,
      missingNotebooks,
      suggestions,
    };
  }

  /**
   * Normalize a title for comparison
   */
  private normalizeTitle(title: string): string {
    return title
      .toLowerCase()
      .replace(/[🔓🔒📁📄🔐⚛️🧠🛡️💻📋]/g, "") // Remove emojis
      .replace(/[\u{1F300}-\u{1F9FF}]/gu, "") // Remove other emojis
      .replace(/[^\w\s]/g, " ") // Remove punctuation
      .replace(/\s+/g, " ") // Normalize whitespace
      .trim();
  }

  /**
   * Check if two titles match (fuzzy)
   */
  private titlesMatch(title1: string, title2: string): boolean {
    // Exact match
    if (title1 === title2) return true;

    // One contains the other
    if (title1.includes(title2) || title2.includes(title1)) return true;

    // Split into words and check overlap
    const words1 = new Set(title1.split(" ").filter(w => w.length > 3));
    const words2 = new Set(title2.split(" ").filter(w => w.length > 3));

    if (words1.size === 0 || words2.size === 0) return false;

    const intersection = [...words1].filter(w => words2.has(w));
    const overlapRatio = intersection.length / Math.min(words1.size, words2.size);

    // If 60%+ of significant words match, consider it a match
    return overlapRatio >= 0.6;
  }

  /**
   * Extract notebook ID from URL
   */
  private extractNotebookId(url: string): string {
    // URL format: https://notebooklm.google.com/notebook/UUID?authuser=X
    const match = url.match(/\/notebook\/([a-f0-9-]+)/i);
    return match ? match[1] : url;
  }

  /**
   * Auto-fix stale entries by removing them
   */
  private async autoFixStaleEntries(
    staleEntries: SyncResult["staleEntries"]
  ): Promise<void> {
    log.info("🔧 Auto-fixing stale entries...");

    for (const entry of staleEntries) {
      try {
        this.library.removeNotebook(entry.libraryId);
        log.success(`✅ Removed stale entry: ${entry.libraryName}`);
      } catch (error) {
        log.warning(`⚠️ Could not remove ${entry.libraryName}: ${error}`);
      }
    }
  }

  /**
   * Log sync summary
   */
  private logSyncSummary(result: SyncResult): void {
    log.info("");
    log.info("📊 Sync Summary:");
    log.info(`  ✅ Matched: ${result.matched.length}`);
    log.info(`  ⚠️  Stale: ${result.staleEntries.length}`);
    log.info(`  ➕ Missing: ${result.missingNotebooks.length}`);
    log.info("");

    if (result.suggestions.length > 0) {
      log.info("💡 Suggestions:");
      for (const suggestion of result.suggestions) {
        log.info(`  ${suggestion}`);
      }
    }
  }

  /**
   * Initialize browser and navigate to NotebookLM
   */
  private async initialize(showBrowser?: boolean): Promise<void> {
    log.info("🌐 Initializing browser for sync...");

    // Get browser context
    const context = await this.contextManager.getOrCreateContext(
      showBrowser === true ? true : undefined
    );

    // Check authentication
    const isAuthenticated = await this.authManager.validateCookiesExpiry(context);
    if (!isAuthenticated) {
      throw new Error(
        "Not authenticated to NotebookLM. Please run setup_auth first."
      );
    }

    // Create new page
    this.page = await context.newPage();

    // Navigate to NotebookLM
    await this.page.goto(NOTEBOOKLM_URL, {
      waitUntil: "domcontentloaded",
      timeout: CONFIG.browserTimeout,
    });

    await randomDelay(2000, 3000);
    await this.page.waitForLoadState("networkidle").catch(() => {});

    log.success("✅ Browser initialized");
  }

  /**
   * Cleanup resources
   */
  private async cleanup(): Promise<void> {
    if (this.page) {
      try {
        await this.page.close();
      } catch {
        // Ignore cleanup errors
      }
      this.page = null;
    }
  }
}

/**
 * Sync library with NotebookLM
 */
export async function syncLibrary(
  authManager: AuthManager,
  contextManager: SharedContextManager,
  library: NotebookLibrary,
  options?: { autoFix?: boolean; showBrowser?: boolean }
): Promise<SyncResult> {
  const sync = new NotebookSync(authManager, contextManager, library);
  return await sync.syncLibrary(options);
}
