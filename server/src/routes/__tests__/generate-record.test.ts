import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { chromium } from 'playwright';
import { generateRouter } from '../generate.js';
import * as configStore from '../../storage/config.js';

describe('Record Mode API', () => {
  let app: express.Application;
  let mockBrowser: any;
  let mockPage: any;

  beforeEach(() => {
    mockPage = {
      on: vi.fn(),
      goto: vi.fn(),
      url: vi.fn().mockReturnValue('https://example.com'),
      screenshot: vi.fn(),
      close: vi.fn(),
      exposeFunction: vi.fn(),
      addInitScript: vi.fn(),
      mainFrame: vi.fn()
    };

    mockBrowser = {
      newPage: vi.fn().mockResolvedValue(mockPage),
      close: vi.fn(),
    };

    vi.spyOn(chromium, 'launch').mockResolvedValue(mockBrowser as any);
    vi.spyOn(configStore, 'loadConfig').mockResolvedValue({
      apiProvider: 'anthropic',
      apiKey: 'test-key'
    } as any);

    app = express();
    app.use(express.json());
    app.use('/api/generate', generateRouter);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('POST /api/generate/record/start should create recording session', async () => {
    const response = await request(app)
      .post('/api/generate/record/start')
      .send({
        name: 'Test Recording',
        startUrl: 'https://example.com',
        description: 'Test description',
      })
      .expect(200);

    expect(response.body).toMatchObject({
      sessionId: expect.any(String),
      state: {
        mode: 'record',
        recordingActive: true,
        status: 'running',
      },
    });
  });

  it('POST /api/generate/:sessionId/record/stop should stop recording', async () => {
    // First start a session
    const startResponse = await request(app)
      .post('/api/generate/record/start')
      .send({
        name: 'Test Recording',
        startUrl: 'https://example.com',
      });

    const sessionId = startResponse.body.sessionId;

    // Then stop it
    const stopResponse = await request(app)
      .post(`/api/generate/${sessionId}/record/stop`)
      .expect(200);

    expect(stopResponse.body).toMatchObject({
      state: {
        recordingActive: false,
        status: 'completed',
      },
      recordedSteps: expect.any(Array),
    });
  });

  it('GET /api/generate/:sessionId/events should stream recording steps', async () => {
    const startResponse = await request(app)
      .post('/api/generate/record/start')
      .send({
        name: 'Test Recording',
        startUrl: 'https://example.com',
      });

    const sessionId = startResponse.body.sessionId;

    const response = await request(app)
      .get(`/api/generate/${sessionId}/events`)
      .set('Accept', 'text/event-stream')
      .set('x-test-close', 'true')
      .expect(200);

    expect(response.text).toContain('event: state');
  });
});
