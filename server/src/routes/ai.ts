import express from 'express';
import { chatWithAI } from '../ai/index.js';
import { loadConfig } from '../storage/config.js';
import { CONFIG } from '../config.js';

const router = express.Router();

/**
 * Generate Playwright step from natural language prompt
 */
router.post('/generate-step', async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const config = await loadConfig(CONFIG.DATA_DIR);

    if (!config.apiProvider || !config.apiKey) {
      return res.status(400).json({
        error: 'AI provider not configured. Configure in Settings.'
      });
    }

    // Use AI to generate Playwright code from the prompt
    const systemPrompt = `You are a Playwright test automation expert. Generate Playwright code from natural language instructions.

Return your response in this exact JSON format:
{
  "qaSummary": "Brief description of what the step does (e.g., 'Click submit button')",
  "playwrightCode": "await page.getByRole('button', { name: 'Submit' }).click();"
}

Rules:
- Use Playwright's recommended locators (getByRole, getByLabel, getByPlaceholder, getByText)
- Keep the code concise and follow best practices
- The code should be a single line or a few lines max
- Do NOT include test() wrapper or page fixture - just the action code
- Return ONLY valid JSON, no markdown formatting`;

    const modelKey = `${config.apiProvider}Model` as keyof typeof config;
    const selectedModel = config[modelKey] as string | undefined;

    const aiResponse = await chatWithAI({
      provider: config.apiProvider,
      apiKey: config.apiKey,
      message: `Generate Playwright code for: ${prompt}`,
      history: [{ id: '1', role: 'system', message: systemPrompt, timestamp: new Date().toISOString() }],
      model: selectedModel
    });

    // Parse AI response as JSON
    let parsed;
    try {
      // Remove markdown code fences if present
      const cleaned = aiResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({
        error: 'Failed to parse AI response. Please try again.'
      });
    }

    if (!parsed.qaSummary || !parsed.playwrightCode) {
      return res.status(500).json({
        error: 'Invalid AI response format'
      });
    }

    res.json({
      qaSummary: parsed.qaSummary,
      playwrightCode: parsed.playwrightCode
    });
  } catch (error: any) {
    res.status(500).json({
      error: error?.message || 'Failed to generate step'
    });
  }
});

export default router;
