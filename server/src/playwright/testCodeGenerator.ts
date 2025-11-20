import type { TestMetadata, VariableDefinition, RecordedStep } from '../types.js';

export interface GenerateTestFileOptions {
  testId: string;
  testName: string;
  startUrl: string;
  steps: RecordedStep[];
  variables?: VariableDefinition[];
  metadata?: Partial<TestMetadata>;
}

/**
 * Generates Playwright test file code with optional variable parameterization
 */
export class TestCodeGenerator {
  /**
   * Generate complete test file as string
   */
  generateTestFile(options: GenerateTestFileOptions): string {
    const { testId, testName, startUrl, steps, variables, metadata } = options;

    const hasVariables = variables && variables.length > 0;
    const metadataHeader = this.generateMetadataHeader(testId, testName, metadata, hasVariables);
    const imports = this.generateImports(hasVariables);
    const testBody = hasVariables
      ? this.generateParameterizedTest(testId, testName, startUrl, steps, variables)
      : this.generateSimpleTest(testName, startUrl, steps);

    return `${metadataHeader}\n${imports}\n${testBody}\n`;
  }

  /**
   * Generate metadata header comment block
   */
  private generateMetadataHeader(
    testId: string,
    testName: string,
    metadata?: Partial<TestMetadata>,
    hasVariables = false
  ): string {
    const metaObj: any = {
      id: testId,
      name: testName,
      ...metadata
    };

    if (hasVariables) {
      metaObj.dataSource = `${testId}.csv`;
    }

    const metaJson = JSON.stringify(metaObj, null, 2)
      .split('\n')
      .map((line) => ` * ${line}`)
      .join('\n');

    return `/**\n * // === TRAILWRIGHT_METADATA ===\n${metaJson}\n */`;
  }

  /**
   * Generate import statements
   */
  private generateImports(hasVariables: boolean): string {
    if (!hasVariables) {
      return `import { test, expect } from '@playwright/test';`;
    }

    return `import { test, expect } from '@playwright/test';
import { parse } from 'csv-parse/sync';
import { readFileSync } from 'fs';
import { join } from 'path';`;
  }

  /**
   * Generate simple (non-parameterized) test
   */
  private generateSimpleTest(testName: string, startUrl: string, steps: RecordedStep[]): string {
    const startUrlLiteral = JSON.stringify(startUrl);

    // Wrap each step in test.step() with QA summary as the step name
    const stepCode = steps
      .map((step) => {
        const escapedSummary = this.escapeString(step.qaSummary);
        return `  await test.step('${escapedSummary}', async () => {
    ${step.playwrightCode}
  });`;
      })
      .join('\n\n');

    return `
test('${this.escapeString(testName)}', async ({ page }) => {
  // Navigate to starting URL
  await page.goto(${startUrlLiteral});

${stepCode}
});`;
  }

  /**
   * Generate parameterized test using for...of loop
   */
  private generateParameterizedTest(
    testId: string,
    testName: string,
    startUrl: string,
    steps: RecordedStep[],
    variables: VariableDefinition[]
  ): string {
    const startUrlLiteral = JSON.stringify(startUrl);
    const dataPath = this.generateDataPath(testId);

    // Generate test title with variable interpolation
    const titleInterpolation = this.generateTitleInterpolation(variables);

    // Wrap each step in test.step() with QA summary as the step name
    const stepCode = steps
      .map((step) => {
        const escapedSummary = this.escapeString(step.qaSummary);
        const code = this.injectVariablesIntoCode(step.playwrightCode);
        return `    await test.step('${escapedSummary}', async () => {
      ${code}
    });`;
      })
      .join('\n\n');

    return `
${dataPath}

for (const row of testData) {
  test(\`${titleInterpolation}\`, async ({ page }) => {
    // Navigate to starting URL
    await page.goto(${startUrlLiteral});

${stepCode}
  });
}`;
  }

  /**
   * Generate data path and CSV loading code
   */
  private generateDataPath(testId: string): string {
    return `const dataPath = join(process.env.HOME || process.env.USERPROFILE || '', '.trailwright/test-data/${testId}.csv');
const testData = parse(readFileSync(dataPath, 'utf-8'), {
  columns: true,
  skip_empty_lines: true
});`;
  }

  /**
   * Generate test title with variable interpolation
   * e.g., "Test: product=\${row.product}, color=\${row.color}"
   */
  private generateTitleInterpolation(variables: VariableDefinition[]): string {
    if (!variables || variables.length === 0) {
      return 'Test run';
    }

    const interpolations = variables
      .map((v) => `${v.name}=\${row.${v.name}}`)
      .join(', ');

    return `Test: ${interpolations}`;
  }

  /**
   * Detect {{varName}} placeholders in code and convert to ${row.varName}
   * e.g., "await page.fill('input', '{{product}}')" -> "await page.fill('input', `${row.product}`)"
   */
  private injectVariablesIntoCode(code: string): string {
    // Pattern to detect {{varName}} placeholders
    const placeholderPattern = /\{\{(\w+)\}\}/g;

    if (!placeholderPattern.test(code)) {
      return code; // No variables, return as-is
    }

    // Replace string literals containing placeholders with template literals
    // This handles cases like: .fill('{{product}}') -> .fill(`${row.product}`)
    return code.replace(/'([^']*\{\{[^}]+\}\}[^']*)'/g, (match, content) => {
      const replaced = content.replace(/\{\{(\w+)\}\}/g, '${row.$1}');
      return `\`${replaced}\``;
    }).replace(/"([^"]*\{\{[^}]+\}\}[^"]*)"/g, (match, content) => {
      const replaced = content.replace(/\{\{(\w+)\}\}/g, '${row.$1}');
      return `\`${replaced}\``;
    });
  }

  /**
   * Escape single quotes in test names
   */
  private escapeString(str: string): string {
    return str.replace(/'/g, "\\'");
  }
}
