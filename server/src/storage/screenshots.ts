import fs from 'fs/promises';
import path from 'path';

/**
 * Save a base64-encoded screenshot to disk.
 * Returns the relative path from the data directory.
 */
export async function saveScreenshot(
  dataDir: string,
  testId: string,
  stepNumber: number,
  base64Data: string
): Promise<string> {
  const screenshotsDir = path.join(dataDir, 'screenshots', testId);
  await fs.mkdir(screenshotsDir, { recursive: true });

  // Remove data URL prefix if present (e.g., "data:image/jpeg;base64,")
  const base64Content = base64Data.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(base64Content, 'base64');

  const filename = `step-${stepNumber}.jpg`;
  const filePath = path.join(screenshotsDir, filename);
  await fs.writeFile(filePath, buffer);

  // Return relative path for storage in metadata
  return `screenshots/${testId}/${filename}`;
}

/**
 * Save multiple screenshots for a test's steps.
 * Returns array of paths in step order.
 */
export async function saveStepScreenshots(
  dataDir: string,
  testId: string,
  steps: Array<{ stepNumber: number; screenshotData?: string }>
): Promise<Map<number, string>> {
  const pathMap = new Map<number, string>();

  for (const step of steps) {
    if (step.screenshotData) {
      try {
        const relativePath = await saveScreenshot(
          dataDir,
          testId,
          step.stepNumber,
          step.screenshotData
        );
        pathMap.set(step.stepNumber, relativePath);
      } catch (error) {
        console.error(`Failed to save screenshot for step ${step.stepNumber}:`, error);
      }
    }
  }

  return pathMap;
}

/**
 * Delete all screenshots for a test.
 */
export async function deleteTestScreenshots(dataDir: string, testId: string): Promise<void> {
  const screenshotsDir = path.join(dataDir, 'screenshots', testId);
  try {
    await fs.rm(screenshotsDir, { recursive: true, force: true });
  } catch {
    // Directory may not exist, ignore
  }
}

/**
 * Get the full file path for a screenshot.
 */
export function getScreenshotPath(dataDir: string, relativePath: string): string {
  return path.join(dataDir, relativePath);
}
