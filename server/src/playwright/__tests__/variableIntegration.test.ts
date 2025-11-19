import { describe, it, expect } from 'vitest';
import { LiveTestGenerator } from '../liveTestGenerator.js';

describe('LiveTestGenerator - Variable Integration', () => {
  // Helper to create a generator instance for testing
  function createGenerator() {
    return new LiveTestGenerator(
      {
        startUrl: 'https://example.com',
        goal: 'Test goal',
        mode: 'manual'
      },
      'anthropic',
      'sk-test-key'
    );
  }

  describe('Variable Management', () => {
    it('can add and retrieve variables', () => {
      const generator = createGenerator();

      generator.setVariable('product', 'teddy bear', 'string');
      generator.setVariable('color', 'brown', 'string');

      const variables = generator.getVariables();

      expect(variables).toHaveLength(2);
      expect(variables[0]).toEqual({
        name: 'product',
        type: 'string',
        sampleValue: 'teddy bear'
      });
      expect(variables[1]).toEqual({
        name: 'color',
        type: 'string',
        sampleValue: 'brown'
      });
    });

    it('can update existing variable', () => {
      const generator = createGenerator();

      generator.setVariable('product', 'teddy bear', 'string');
      generator.setVariable('product', 'action figure', 'string');

      const variables = generator.getVariables();

      expect(variables).toHaveLength(1);
      expect(variables[0].sampleValue).toBe('action figure');
    });

    it('can remove variables', () => {
      const generator = createGenerator();

      generator.setVariable('product', 'teddy bear', 'string');
      generator.setVariable('color', 'brown', 'string');
      generator.removeVariable('product');

      const variables = generator.getVariables();

      expect(variables).toHaveLength(1);
      expect(variables[0].name).toBe('color');
    });

    it('rejects empty variable names', () => {
      const generator = createGenerator();

      expect(() => {
        generator.setVariable('', 'value', 'string');
      }).toThrow('Variable name cannot be empty');
    });

    it('rejects empty sample values', () => {
      const generator = createGenerator();

      expect(() => {
        generator.setVariable('product', '', 'string');
      }).toThrow('Sample value cannot be empty');
    });

    it('trims whitespace from names and values', () => {
      const generator = createGenerator();

      generator.setVariable('  product  ', '  teddy bear  ', 'string');

      const variables = generator.getVariables();
      expect(variables[0].name).toBe('product');
      expect(variables[0].sampleValue).toBe('teddy bear');
    });
  });

  describe('Variable Detection', () => {
    it('accepts instruction with all variables defined', async () => {
      const generator = createGenerator();
      generator.setVariable('product', 'teddy bear');

      // Should pass validation (will fail later due to browser not initialized)
      await expect(
        generator.executeManualInstruction('Search for {{product}}')
      ).rejects.toThrow('Browser not initialized'); // Not a variable error
    });

    it('accepts instruction with multiple variables all defined', async () => {
      const generator = createGenerator();
      generator.setVariable('product', 'teddy bear');
      generator.setVariable('color', 'brown');

      // Should pass validation (will fail later due to browser)
      await expect(
        generator.executeManualInstruction('Search for {{product}} in {{color}}')
      ).rejects.toThrow('Browser not initialized'); // Not a variable error
    });

    it('rejects instruction with undefined variable', async () => {
      const generator = createGenerator();

      await expect(
        generator.executeManualInstruction('Search for {{product}}')
      ).rejects.toThrow('missing sample values for variables: product');
    });

    it('rejects instruction with partially defined variables', async () => {
      const generator = createGenerator();
      generator.setVariable('product', 'teddy bear');

      await expect(
        generator.executeManualInstruction('Search for {{product}} in {{color}}')
      ).rejects.toThrow('missing sample values for variables: color');
    });
  });

  describe('Test Code Generation with Variables', () => {
    it('generates parameterized test when variables exist', () => {
      const generator = createGenerator();
      generator.setVariable('product', 'teddy bear', 'string');
      generator.setVariable('color', 'brown', 'string');

      const code = generator.generateTestCode({
        testId: 'test-123',
        testName: 'Product search'
      });

      expect(code).toContain('import { parse }');
      expect(code).toContain('csv-parse/sync');
      expect(code).toContain('.trailwright/test-data/test-123.csv');
      expect(code).toContain('test.describe.each(testData)');
      expect(code).toContain('(row) => {');
      expect(code).toContain('product=${row.product}');
      expect(code).toContain('color=${row.color}');
      expect(code).toContain('"dataSource": "test-123.csv"');
    });

    it('generates simple test when no variables exist', () => {
      const generator = createGenerator();

      const code = generator.generateTestCode({
        testId: 'test-456',
        testName: 'Simple test'
      });

      expect(code).not.toContain('csv-parse');
      expect(code).not.toContain('test.describe.each');
      expect(code).not.toContain('dataSource');
      expect(code).toContain("test('Simple test'");
    });
  });

  describe('Placeholder Injection', () => {
    it('replaces sample value with placeholder in single quotes', () => {
      const generator = createGenerator();
      generator.setVariable('product', 'teddy bear', 'string');

      // Simulate what would be generated by actionExecutor
      const code = "await page.getByRole('searchbox').fill('teddy bear');";

      // Use the private method via any cast (for testing only)
      const injected = (generator as any).injectPlaceholdersIntoCode(code);

      expect(injected).toBe("await page.getByRole('searchbox').fill('{{product}}');");
    });

    it('replaces sample value with placeholder in double quotes', () => {
      const generator = createGenerator();
      generator.setVariable('product', 'teddy bear', 'string');

      const code = 'await page.fill("#search", "teddy bear");';
      const injected = (generator as any).injectPlaceholdersIntoCode(code);

      expect(injected).toBe('await page.fill("#search", "{{product}}");');
    });

    it('handles multiple variables in same code line', () => {
      const generator = createGenerator();
      generator.setVariable('product', 'teddy bear', 'string');
      generator.setVariable('color', 'brown', 'string');

      const code = "await page.fill('#search', 'teddy bear brown');";
      const injected = (generator as any).injectPlaceholdersIntoCode(code);

      expect(injected).toBe("await page.fill('#search', '{{product}} {{color}}');");
    });

    it('handles partial matches correctly', () => {
      const generator = createGenerator();
      generator.setVariable('color', 'brown', 'string');

      const code = "await page.fill('#input', 'dark brown color');";
      const injected = (generator as any).injectPlaceholdersIntoCode(code);

      // Should only replace the exact 'brown', not 'brownish' or other partial matches
      expect(injected).toBe("await page.fill('#input', 'dark {{color}} color');");
    });

    it('does not affect code without string literals', () => {
      const generator = createGenerator();
      generator.setVariable('product', 'teddy bear', 'string');

      const code = "await page.getByRole('button').click();";
      const injected = (generator as any).injectPlaceholdersIntoCode(code);

      expect(injected).toBe(code); // Should be unchanged
    });

    it('handles special regex characters in sample values', () => {
      const generator = createGenerator();
      generator.setVariable('email', 'test+user@example.com', 'string');

      const code = "await page.fill('#email', 'test+user@example.com');";
      const injected = (generator as any).injectPlaceholdersIntoCode(code);

      expect(injected).toBe("await page.fill('#email', '{{email}}');");
    });
  });
});
