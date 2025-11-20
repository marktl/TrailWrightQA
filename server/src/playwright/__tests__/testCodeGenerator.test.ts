import { describe, it, expect } from 'vitest';
import { TestCodeGenerator } from '../testCodeGenerator.js';
import type { RecordedStep, VariableDefinition } from '../../types.js';

describe('TestCodeGenerator', () => {
  const generator = new TestCodeGenerator();

  const sampleSteps: RecordedStep[] = [
    {
      stepNumber: 1,
      playwrightCode: "await page.getByRole('button', { name: 'Login' }).click();",
      qaSummary: 'Click "Login" button',
      timestamp: '2025-11-18T10:00:00Z'
    },
    {
      stepNumber: 2,
      playwrightCode: "await page.getByLabel('Username').fill('testuser');",
      qaSummary: 'Fill "Username" field with "testuser"',
      timestamp: '2025-11-18T10:00:01Z'
    }
  ];

  describe('generateTestFile - simple tests (no variables)', () => {
    it('generates a simple test file with metadata header', () => {
      const code = generator.generateTestFile({
        testId: 'test-123',
        testName: 'Login test',
        startUrl: 'https://example.com/login',
        steps: sampleSteps
      });

      expect(code).toContain('// === TRAILWRIGHT_METADATA ===');
      expect(code).toContain('"id": "test-123"');
      expect(code).toContain('"name": "Login test"');
      expect(code).not.toContain('dataSource');
      expect(code).toContain("import { test, expect } from '@playwright/test';");
      expect(code).toContain("test('Login test'");
      expect(code).toContain('await page.goto("https://example.com/login")');
      expect(code).toContain("await page.getByRole('button', { name: 'Login' }).click();");
      // Check that steps are wrapped in test.step() with QA summaries
      expect(code).toContain('await test.step(\'Click "Login" button\', async () => {');
      expect(code).toContain('await test.step(\'Fill "Username" field with "testuser"\', async () => {');
    });

    it('handles test names with single quotes', () => {
      const code = generator.generateTestFile({
        testId: 'test-456',
        testName: "User's profile test",
        startUrl: 'https://example.com',
        steps: sampleSteps
      });

      expect(code).toContain("test('User\\'s profile test'");
    });

    it('includes additional metadata when provided', () => {
      const code = generator.generateTestFile({
        testId: 'test-789',
        testName: 'Test with metadata',
        startUrl: 'https://example.com',
        steps: sampleSteps,
        metadata: {
          description: 'A test description',
          tags: ['smoke', 'login'],
          credentialId: 'cred-123'
        }
      });

      expect(code).toContain('"description": "A test description"');
      expect(code).toContain('"tags": [\n *     "smoke",\n *     "login"\n *   ]');
      expect(code).toContain('"credentialId": "cred-123"');
    });
  });

  describe('generateTestFile - parameterized tests (with variables)', () => {
    const variables: VariableDefinition[] = [
      { name: 'product', type: 'string' },
      { name: 'color', type: 'string' }
    ];

    it('generates parameterized test with CSV loading', () => {
      const code = generator.generateTestFile({
        testId: 'test-var-123',
        testName: 'Product search test',
        startUrl: 'https://example.com',
        steps: sampleSteps,
        variables
      });

      expect(code).toContain('// === TRAILWRIGHT_METADATA ===');
      expect(code).toContain('"dataSource": "test-var-123.csv"');
      expect(code).toContain("import { parse } from 'csv-parse/sync';");
      expect(code).toContain("import { readFileSync } from 'fs';");
      expect(code).toContain("import { join } from 'path';");
      expect(code).toContain('.trailwright/test-data/test-var-123.csv');
      expect(code).toContain('const testData = parse(readFileSync(dataPath');
      expect(code).toContain('for (const row of testData)');
      expect(code).toContain('test(`');
    });

    it('generates test title with variable interpolation', () => {
      const code = generator.generateTestFile({
        testId: 'test-var-456',
        testName: 'Multi-variable test',
        startUrl: 'https://example.com',
        steps: sampleSteps,
        variables
      });

      expect(code).toContain('test(`Test: product=${row.product}, color=${row.color}`');
    });

    it('converts {{varName}} placeholders to ${row.varName} in step code', () => {
      const stepsWithVariables: RecordedStep[] = [
        {
          stepNumber: 1,
          playwrightCode: "await page.getByRole('searchbox').fill('{{product}}');",
          qaSummary: 'Search for product',
          timestamp: '2025-11-18T10:00:00Z'
        },
        {
          stepNumber: 2,
          playwrightCode: "await page.getByLabel('Color').selectOption('{{color}}');",
          qaSummary: 'Select color filter',
          timestamp: '2025-11-18T10:00:01Z'
        }
      ];

      const code = generator.generateTestFile({
        testId: 'test-var-789',
        testName: 'Variable injection test',
        startUrl: 'https://example.com',
        steps: stepsWithVariables,
        variables
      });

      expect(code).toContain('await page.getByRole(\'searchbox\').fill(`${row.product}`);');
      expect(code).toContain('await page.getByLabel(\'Color\').selectOption(`${row.color}`);');
    });

    it('handles double-quoted strings with variables', () => {
      const stepsWithDoubleQuotes: RecordedStep[] = [
        {
          stepNumber: 1,
          playwrightCode: 'await page.fill("input[name=\\"product\\"]", "{{product}}");',
          qaSummary: 'Fill product input',
          timestamp: '2025-11-18T10:00:00Z'
        }
      ];

      const code = generator.generateTestFile({
        testId: 'test-var-dq',
        testName: 'Double quote test',
        startUrl: 'https://example.com',
        steps: stepsWithDoubleQuotes,
        variables
      });

      expect(code).toContain('await page.fill("input[name=\\"product\\"]", `${row.product}`);');
    });

    it('leaves code without placeholders unchanged', () => {
      const code = generator.generateTestFile({
        testId: 'test-var-mixed',
        testName: 'Mixed steps test',
        startUrl: 'https://example.com',
        steps: sampleSteps, // No placeholders
        variables
      });

      // Original code should be preserved when no variables referenced
      expect(code).toContain("await page.getByRole('button', { name: 'Login' }).click();");
      expect(code).toContain("await page.getByLabel('Username').fill('testuser');");
    });

    it('handles single variable', () => {
      const singleVar: VariableDefinition[] = [{ name: 'username', type: 'string' }];

      const code = generator.generateTestFile({
        testId: 'test-single-var',
        testName: 'Single variable test',
        startUrl: 'https://example.com',
        steps: sampleSteps,
        variables: singleVar
      });

      expect(code).toContain('test(`Test: username=${row.username}`');
    });

    it('handles empty variable array as simple test', () => {
      const code = generator.generateTestFile({
        testId: 'test-empty-vars',
        testName: 'Empty variables test',
        startUrl: 'https://example.com',
        steps: sampleSteps,
        variables: []
      });

      // Should generate simple test, not parameterized
      expect(code).not.toContain('test.describe.each');
      expect(code).not.toContain('csv-parse');
      expect(code).toContain("test('Empty variables test'");
    });
  });

  describe('edge cases', () => {
    it('handles empty steps array', () => {
      const code = generator.generateTestFile({
        testId: 'test-no-steps',
        testName: 'No steps test',
        startUrl: 'https://example.com',
        steps: []
      });

      expect(code).toContain('await page.goto("https://example.com")');
      // Should have test structure but no step comments or code
      expect(code).toMatch(/test\('No steps test',.*async.*\{/s);
    });

    it('handles special characters in URLs', () => {
      const code = generator.generateTestFile({
        testId: 'test-special-url',
        testName: 'Special URL test',
        startUrl: 'https://example.com/path?query=value&foo=bar',
        steps: sampleSteps
      });

      expect(code).toContain('await page.goto("https://example.com/path?query=value&foo=bar")');
    });

    it('handles multiple variables in single step', () => {
      const stepsWithMultipleVars: RecordedStep[] = [
        {
          stepNumber: 1,
          playwrightCode: "await page.fill('#search', '{{product}} {{color}}');",
          qaSummary: 'Search for product and color',
          timestamp: '2025-11-18T10:00:00Z'
        }
      ];

      const variables: VariableDefinition[] = [
        { name: 'product', type: 'string' },
        { name: 'color', type: 'string' }
      ];

      const code = generator.generateTestFile({
        testId: 'test-multi-vars-step',
        testName: 'Multiple vars in step',
        startUrl: 'https://example.com',
        steps: stepsWithMultipleVars,
        variables
      });

      expect(code).toContain("await page.fill('#search', `${row.product} ${row.color}`);");
    });
  });
});
