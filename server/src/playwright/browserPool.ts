/**
 * Browser Pool Manager
 *
 * Manages reusable browser instances for multi-test runs.
 * Uses Playwright's browser server to allow multiple tests to connect to the same browser.
 */

import { chromium, type BrowserServer } from 'playwright';
import type { ViewportSize } from '../../../shared/types.js';

export interface BrowserPoolOptions {
  headed?: boolean;
  slowMo?: number;
  viewportSize?: ViewportSize;
}

interface ManagedBrowser {
  server: BrowserServer;
  wsEndpoint: string;
  configId: string;
  options: BrowserPoolOptions;
  createdAt: Date;
  lastUsedAt: Date;
  useCount: number;
}

/**
 * Manages a pool of reusable browser instances for multi-test runs
 */
class BrowserPool {
  private browsers: Map<string, ManagedBrowser> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Start cleanup interval - close unused browsers after 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanupStale(), 60000);
  }

  /**
   * Acquire a browser for a multi-run configuration
   * Creates a new browser server if one doesn't exist for this configId
   */
  async acquire(configId: string, options: BrowserPoolOptions = {}): Promise<string> {
    const existing = this.browsers.get(configId);
    if (existing) {
      existing.lastUsedAt = new Date();
      existing.useCount++;
      console.log(`[BrowserPool] Reusing browser for config ${configId}, wsEndpoint: ${existing.wsEndpoint}`);
      return existing.wsEndpoint;
    }

    console.log(`[BrowserPool] Launching new browser for config ${configId}`);

    const launchOptions: Parameters<typeof chromium.launchServer>[0] = {
      headless: options.headed === false ? false : !options.headed,
    };

    // Launch browser server
    const server = await chromium.launchServer(launchOptions);
    const wsEndpoint = server.wsEndpoint();

    const managed: ManagedBrowser = {
      server,
      wsEndpoint,
      configId,
      options,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      useCount: 1,
    };

    this.browsers.set(configId, managed);
    console.log(`[BrowserPool] Browser launched for config ${configId}, wsEndpoint: ${wsEndpoint}`);

    return wsEndpoint;
  }

  /**
   * Get the WebSocket endpoint for a config, if browser exists
   */
  getEndpoint(configId: string): string | undefined {
    const browser = this.browsers.get(configId);
    if (browser) {
      browser.lastUsedAt = new Date();
      return browser.wsEndpoint;
    }
    return undefined;
  }

  /**
   * Check if a browser exists for a config
   */
  has(configId: string): boolean {
    return this.browsers.has(configId);
  }

  /**
   * Mark browser as used (updates lastUsedAt)
   */
  touch(configId: string): void {
    const browser = this.browsers.get(configId);
    if (browser) {
      browser.lastUsedAt = new Date();
      browser.useCount++;
    }
  }

  /**
   * Release (close) a browser for a config
   */
  async release(configId: string): Promise<void> {
    const browser = this.browsers.get(configId);
    if (!browser) {
      return;
    }

    console.log(`[BrowserPool] Releasing browser for config ${configId}`);

    try {
      await browser.server.close();
    } catch (error) {
      console.error(`[BrowserPool] Error closing browser for ${configId}:`, error);
    }

    this.browsers.delete(configId);
  }

  /**
   * Get stats for a browser
   */
  getStats(configId: string): { useCount: number; createdAt: Date; lastUsedAt: Date } | undefined {
    const browser = this.browsers.get(configId);
    if (!browser) {
      return undefined;
    }
    return {
      useCount: browser.useCount,
      createdAt: browser.createdAt,
      lastUsedAt: browser.lastUsedAt,
    };
  }

  /**
   * Clean up stale browsers (unused for more than 5 minutes)
   */
  private async cleanupStale(): Promise<void> {
    const staleThreshold = 5 * 60 * 1000; // 5 minutes
    const now = Date.now();

    for (const [configId, browser] of this.browsers.entries()) {
      const age = now - browser.lastUsedAt.getTime();
      if (age > staleThreshold) {
        console.log(`[BrowserPool] Cleaning up stale browser for config ${configId} (unused for ${Math.round(age / 1000)}s)`);
        await this.release(configId);
      }
    }
  }

  /**
   * Close all browsers and stop cleanup
   */
  async shutdown(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    const configIds = Array.from(this.browsers.keys());
    for (const configId of configIds) {
      await this.release(configId);
    }
  }

  /**
   * Get count of active browsers
   */
  get size(): number {
    return this.browsers.size;
  }
}

// Singleton instance
export const browserPool = new BrowserPool();

// Cleanup on process exit
process.on('beforeExit', async () => {
  await browserPool.shutdown();
});

process.on('SIGINT', async () => {
  await browserPool.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await browserPool.shutdown();
  process.exit(0);
});
