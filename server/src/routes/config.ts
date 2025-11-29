import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { loadConfig, saveConfig, getTestsDirectory, getDefaultTestsDirectory } from '../storage/config.js';
import { CONFIG } from '../config.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const config = await loadConfig(CONFIG.DATA_DIR);
    const resolvedTestsDirectory = await getTestsDirectory(CONFIG.DATA_DIR);
    const defaultTestsDirectory = getDefaultTestsDirectory(CONFIG.DATA_DIR);

    // Don't send full API key to client, just indicate if set
    res.json({
      ...config,
      apiKey: config.apiKey ? '***' + config.apiKey.slice(-4) : '',
      // Include resolved and default test directories for UI
      resolvedTestsDirectory,
      defaultTestsDirectory
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const updates = { ...req.body };

    // If apiKey looks masked (starts with ***), don't update it
    if (updates.apiKey && updates.apiKey.startsWith('***')) {
      delete updates.apiKey;
    }

    // Don't allow testDirectory changes via this endpoint - use /test-directory instead
    delete updates.testDirectory;

    await saveConfig(CONFIG.DATA_DIR, updates);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Change test directory with optional file move.
 * Body: { newPath: string, moveTests: boolean }
 * - If newPath is empty or matches default, resets to default
 * - If moveTests is true, moves existing tests to new location
 */
router.post('/test-directory', async (req, res) => {
  try {
    const { newPath, moveTests } = req.body;
    const defaultDir = getDefaultTestsDirectory(CONFIG.DATA_DIR);
    const currentDir = await getTestsDirectory(CONFIG.DATA_DIR);

    // Normalize the new path (empty string = use default)
    const normalizedNewPath = newPath?.trim() || '';
    const targetDir = normalizedNewPath || defaultDir;

    // If target is the same as current, nothing to do
    if (path.resolve(targetDir) === path.resolve(currentDir)) {
      return res.json({
        success: true,
        message: 'Test directory unchanged',
        testDirectory: normalizedNewPath || undefined,
        resolvedTestsDirectory: targetDir
      });
    }

    // Validate the new path is writable
    try {
      await fs.mkdir(targetDir, { recursive: true });
      // Test write permission
      const testFile = path.join(targetDir, '.write-test');
      await fs.writeFile(testFile, '');
      await fs.unlink(testFile);
    } catch (err: any) {
      return res.status(400).json({
        error: `Cannot write to directory: ${targetDir}. ${err.message}`
      });
    }

    // Count tests in current directory
    let testCount = 0;
    let movedCount = 0;
    try {
      const files = await fs.readdir(currentDir);
      testCount = files.filter(f => f.endsWith('.spec.ts')).length;
    } catch {
      // Current directory might not exist
    }

    // Move tests if requested and there are tests to move
    if (moveTests && testCount > 0) {
      try {
        const files = await fs.readdir(currentDir);
        const testFiles = files.filter(f => f.endsWith('.spec.ts'));

        for (const file of testFiles) {
          const srcPath = path.join(currentDir, file);
          const destPath = path.join(targetDir, file);

          // Check if destination already exists
          try {
            await fs.access(destPath);
            // File exists at destination, skip to avoid overwriting
            console.log(`Skipping ${file} - already exists at destination`);
            continue;
          } catch {
            // File doesn't exist, safe to move
          }

          await fs.copyFile(srcPath, destPath);
          await fs.unlink(srcPath);
          movedCount++;
        }
      } catch (err: any) {
        return res.status(500).json({
          error: `Failed to move tests: ${err.message}`
        });
      }
    }

    // Update config with new path (or clear it if using default)
    await saveConfig(CONFIG.DATA_DIR, {
      testDirectory: normalizedNewPath || undefined
    });

    res.json({
      success: true,
      message: moveTests && movedCount > 0
        ? `Moved ${movedCount} test(s) to new location`
        : 'Test directory updated',
      testDirectory: normalizedNewPath || undefined,
      resolvedTestsDirectory: targetDir,
      movedCount,
      testCount
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Get info about current test directory and test count.
 */
router.get('/test-directory', async (req, res) => {
  try {
    const config = await loadConfig(CONFIG.DATA_DIR);
    const resolvedTestsDirectory = await getTestsDirectory(CONFIG.DATA_DIR);
    const defaultTestsDirectory = getDefaultTestsDirectory(CONFIG.DATA_DIR);

    // Count tests
    let testCount = 0;
    try {
      const files = await fs.readdir(resolvedTestsDirectory);
      testCount = files.filter(f => f.endsWith('.spec.ts')).length;
    } catch {
      // Directory might not exist
    }

    res.json({
      testDirectory: config.testDirectory || '',
      resolvedTestsDirectory,
      defaultTestsDirectory,
      testCount,
      isCustom: !!config.testDirectory
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
