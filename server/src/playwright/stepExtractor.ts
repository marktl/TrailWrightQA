/**
 * Step Extractor - Extracts step metadata from test files
 *
 * Primary source: Test metadata (steps array in TRAILWRIGHT_METADATA)
 * Fallback: Parse test.step() calls from code using regex
 */

import fs from 'fs/promises';
import path from 'path';
import type { ExtractedStep, TestStepMetadata } from '../../../shared/types.js';

/**
 * Extract steps from a test file
 *
 * @param testFilePath - Full path to the .spec.ts file
 * @returns Array of extracted steps
 */
export async function extractStepsFromTestFile(testFilePath: string): Promise<ExtractedStep[]> {
  const content = await fs.readFile(testFilePath, 'utf-8');

  // First, try to extract from metadata (preferred)
  const metadataSteps = extractStepsFromMetadata(content);
  if (metadataSteps.length > 0) {
    return metadataSteps;
  }

  // Fallback: parse test.step() calls from code
  return extractStepsFromCode(content);
}

/**
 * Extract steps from test metadata in the file header
 */
function extractStepsFromMetadata(content: string): ExtractedStep[] {
  // Match the TRAILWRIGHT_METADATA JSON block
  // Format 1: Raw JSON at top (newer format)
  const rawJsonMatch = content.match(/^\/\*\*\s*\n\s*\/\/\s*===\s*TRAILWRIGHT_METADATA\s*===\s*\n\s*(\{[\s\S]*?\})\s*\n\s*\*\//m);

  // Format 2: Commented JSON (older format)
  const commentedJsonMatch = content.match(/\/\*\*\s*\n\s*\*\s*\/\/\s*===\s*TRAILWRIGHT_METADATA\s*===\s*\n([\s\S]*?)\s*\*\//m);

  let metadata: any = null;

  if (rawJsonMatch) {
    try {
      metadata = JSON.parse(rawJsonMatch[1]);
    } catch {
      // Invalid JSON, continue to next method
    }
  }

  if (!metadata && commentedJsonMatch) {
    try {
      // Remove comment markers (* at start of lines)
      const cleanedJson = commentedJsonMatch[1]
        .split('\n')
        .map(line => line.replace(/^\s*\*\s?/, ''))
        .join('\n')
        .trim();
      metadata = JSON.parse(cleanedJson);
    } catch {
      // Invalid JSON, continue to fallback
    }
  }

  if (!metadata?.steps || !Array.isArray(metadata.steps)) {
    return [];
  }

  return metadata.steps.map((step: TestStepMetadata) => ({
    number: step.number,
    title: step.qaSummary,
    lineNumber: undefined // Could be calculated if needed
  }));
}

/**
 * Extract steps from test.step() calls in the code
 * This is a fallback for tests without metadata
 */
function extractStepsFromCode(content: string): ExtractedStep[] {
  const steps: ExtractedStep[] = [];
  const lines = content.split('\n');

  // Match patterns like:
  // await test.step('Step title', async () => {
  // await test.step("Step title", async () => {
  // test.step('Step title', ...
  const stepPattern = /(?:await\s+)?test\.step\s*\(\s*(['"`])(.*?)\1/g;

  let stepNumber = 0;
  let lineNumber = 0;

  for (const line of lines) {
    lineNumber++;
    let match;

    // Reset lastIndex for each line
    stepPattern.lastIndex = 0;

    while ((match = stepPattern.exec(line)) !== null) {
      stepNumber++;
      steps.push({
        number: stepNumber,
        title: match[2],
        lineNumber
      });
    }
  }

  return steps;
}

/**
 * Get steps for a test by ID
 *
 * @param dataDir - Data directory path (e.g., ~/.trailwright)
 * @param testId - Test ID
 * @returns Array of extracted steps
 */
export async function getTestSteps(dataDir: string, testId: string): Promise<ExtractedStep[]> {
  const testFilePath = path.join(dataDir, 'tests', `${testId}.spec.ts`);

  try {
    return await extractStepsFromTestFile(testFilePath);
  } catch (error) {
    // File doesn't exist or can't be read
    return [];
  }
}

/**
 * Get step count for a test
 */
export async function getTestStepCount(dataDir: string, testId: string): Promise<number> {
  const steps = await getTestSteps(dataDir, testId);
  return steps.length;
}
