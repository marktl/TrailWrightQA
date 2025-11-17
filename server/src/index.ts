import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from './config.js';
import { initStorage } from './storage/index.js';
import { ensurePlaywrightConfig } from './playwright/config.js';
import testsRouter from './routes/tests.js';
import runsRouter from './routes/runs.js';
import configRouter from './routes/config.js';
import generateRouter from './routes/generate.js';
import credentialsRouter from './routes/credentials.js';

const app = express();
const CLIENT_DIST_DIR = path.resolve(process.cwd(), '../client/dist');
const CLIENT_INDEX_FILE = path.join(CLIENT_DIST_DIR, 'index.html');
const hasClientBuild = fs.existsSync(CLIENT_INDEX_FILE);

app.use(cors());
app.use(express.json());

if (hasClientBuild) {
  app.use(express.static(CLIENT_DIST_DIR));
  console.log(`[server] Serving client build from ${CLIENT_DIST_DIR}`);
} else {
  const fallbackStyles = `
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, sans-serif; background-color: #f9fafb; color: #111827; }
    a { color: inherit; text-decoration: none; }
    h1, h2, h3 { margin: 0; font-weight: 700; }
    p { margin: 0; }
    button { font: inherit; cursor: pointer; border-radius: 8px; border: none; padding: 10px 16px; transition: background-color 0.15s ease, color 0.15s ease, opacity 0.15s ease; }
    button.primary { background: #2563eb; color: #ffffff; }
    button.primary:hover { background: #1d4ed8; }
    button.secondary { background: transparent; color: #374151; border: 1px solid #d1d5db; }
    button.secondary:hover { background: #f3f4f6; }
    button[disabled] { opacity: 0.6; cursor: not-allowed; }
    .page { min-height: 100vh; background-color: #f9fafb; }
    .container { max-width: 960px; margin: 0 auto; padding: 32px 16px; }
    header { display: flex; flex-direction: column; gap: 16px; align-items: flex-start; justify-content: space-between; margin-bottom: 32px; }
    @media (min-width: 640px) { header { flex-direction: row; align-items: center; } }
    .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 16px; }
    .card { background: #ffffff; border-radius: 12px; padding: 24px; box-shadow: 0 15px 35px rgba(15, 23, 42, 0.08); margin-bottom: 24px; }
    .small { font-size: 14px; color: #6b7280; line-height: 1.5; }
    .section-title { font-size: 20px; margin-bottom: 12px; }
    .tests-list { display: flex; flex-direction: column; gap: 12px; margin-top: 12px; }
    .test-item { display: flex; justify-content: space-between; align-items: center; padding: 16px; border: 1px solid #e5e7eb; border-radius: 12px; background: #ffffff; }
    .test-info { display: flex; flex-direction: column; gap: 4px; }
    .hidden { display: none !important; }
    .modal-backdrop { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(17, 24, 39, 0.6); padding: 16px; }
    .modal-backdrop.hidden { display: none !important; }
    .modal { background: #ffffff; border-radius: 16px; padding: 24px; width: min(100%, 520px); max-height: 90vh; overflow-y: auto; box-shadow: 0 20px 45px rgba(15, 23, 42, 0.2); }
    textarea { width: 100%; border-radius: 12px; border: 1px solid #d1d5db; padding: 12px; font-family: inherit; font-size: 16px; resize: vertical; min-height: 140px; }
    textarea:focus, input:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
    input[type="password"], input[type="url"] { width: 100%; border-radius: 10px; border: 1px solid #d1d5db; padding: 10px 12px; font-size: 16px; }
    label { font-weight: 500; display: block; margin-bottom: 8px; }
    .radio-group { display: flex; flex-direction: column; gap: 8px; }
    .radio-item { display: flex; align-items: center; gap: 8px; }
    .radio-item span { text-transform: capitalize; }
    .message { margin-top: 12px; font-size: 14px; color: #2563eb; }
    .message.error { color: #dc2626; }
    .message.success { color: #047857; }
    .status-warning { margin-top: 16px; color: #dc2626; font-size: 14px; display: none; }
    .status-warning.visible { display: block; }
    form { display: flex; flex-direction: column; gap: 24px; }
  `;

  const homePageHtml = String.raw`
    <!doctype html>
    <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>TrailWright QA</title>
      <style>${fallbackStyles}</style>
    </head>
    <body>
      <div class="page">
        <div class="container">
          <header>
            <h1 class="text-4xl">TrailWright QA</h1>
            <button class="secondary" data-nav="settings">Settings</button>
          </header>

          <section class="card" aria-labelledby="generate-heading">
            <h2 id="generate-heading" class="section-title">Generate Test with AI Tools</h2>
            <p class="small">
              Configure your AI provider in Settings, then generate tests from natural language prompts.
            </p>
            <div class="actions">
              <button id="open-generate-modal" class="primary">Generate New Test</button>
              <button class="secondary" data-nav="settings">Go to Settings</button>
            </div>
            <p id="health-warning" class="status-warning">
              Unable to reach the backend API. Please ensure the server is running.
            </p>
          </section>

          <section class="card" aria-labelledby="tests-heading">
            <h2 id="tests-heading" class="section-title">Your Tests</h2>
            <p id="tests-loading" data-testid="tests-loading" class="small">Loading tests...</p>
            <p id="tests-empty" data-testid="tests-empty" class="small hidden">
              No tests yet. Configure AI and generate tests to get started!
            </p>
            <div id="tests-list" class="tests-list"></div>
          </section>
        </div>
      </div>

      <div id="generate-modal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-hidden="true">
        <div class="modal">
          <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px;">
            <div>
              <h2 style="font-size: 24px; margin-bottom: 6px;">Generate Test with AI</h2>
              <p class="small">Describe what to test and TrailWright will draft the scenario.</p>
            </div>
            <button id="close-generate-modal" class="secondary" aria-label="Close generate test modal">&times;</button>
          </div>
          <label for="generate-prompt">Describe what to test</label>
          <textarea id="generate-prompt" placeholder="e.g. Test login flow"></textarea>
          <p id="generate-message" class="message" role="status"></p>
          <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px;">
            <button id="cancel-generate" class="secondary">Cancel</button>
            <button id="confirm-generate" class="primary" disabled>Generate Test</button>
          </div>
        </div>
      </div>

      <script>
        (function () {
          const navButtons = Array.from(document.querySelectorAll('[data-nav="settings"]'));
          navButtons.forEach(function (btn) {
            btn.addEventListener('click', function () {
              window.location.href = '/settings';
            });
          });

          const modalBackdrop = document.getElementById('generate-modal');
          const openModalButton = document.getElementById('open-generate-modal');
          const cancelButton = document.getElementById('cancel-generate');
          const closeButton = document.getElementById('close-generate-modal');
          const promptInput = document.getElementById('generate-prompt');
          const generateButton = document.getElementById('confirm-generate');
          const messageEl = document.getElementById('generate-message');
          const testsLoading = document.getElementById('tests-loading');
          const testsEmpty = document.getElementById('tests-empty');
          const testsList = document.getElementById('tests-list');
          const healthWarning = document.getElementById('health-warning');

          let isGenerating = false;

          function toggleModal(visible) {
            if (!modalBackdrop) return;
            if (visible) {
              modalBackdrop.classList.remove('hidden');
              modalBackdrop.setAttribute('aria-hidden', 'false');
              if (promptInput) {
                promptInput.value = '';
                promptInput.focus();
              }
              if (messageEl) {
                messageEl.textContent = '';
                messageEl.className = 'message';
              }
              updateGenerateState();
            } else {
              modalBackdrop.classList.add('hidden');
              modalBackdrop.setAttribute('aria-hidden', 'true');
              if (promptInput) {
                promptInput.value = '';
              }
              isGenerating = false;
              updateGenerateState();
            }
          }

          function updateGenerateState() {
            if (!generateButton) return;
            const promptFilled = promptInput && promptInput.value.trim().length > 0;
            generateButton.disabled = isGenerating || !promptFilled;
            generateButton.textContent = isGenerating ? 'Generating...' : 'Generate Test';
          }

          if (openModalButton && modalBackdrop) {
            openModalButton.addEventListener('click', function () {
              toggleModal(true);
            });
          }

          if (cancelButton) {
            cancelButton.addEventListener('click', function () {
              toggleModal(false);
            });
          }
          if (closeButton) {
            closeButton.addEventListener('click', function () {
              toggleModal(false);
            });
          }
          if (modalBackdrop) {
            modalBackdrop.addEventListener('click', function (event) {
              if (event.target === modalBackdrop) {
                toggleModal(false);
              }
            });
          }

          if (promptInput) {
            promptInput.addEventListener('input', updateGenerateState);
          }

          async function loadTests() {
            if (testsLoading) {
              testsLoading.classList.remove('hidden');
            }
            if (testsEmpty) {
              testsEmpty.classList.add('hidden');
            }
            if (testsList) {
              testsList.innerHTML = '';
            }

            try {
              const response = await fetch('/api/tests');
              if (!response.ok) {
                throw new Error('Failed to load tests');
              }
              const payload = await response.json();
              const items = Array.isArray(payload.tests) ? payload.tests : [];
              if (items.length === 0) {
                if (testsEmpty) {
                  testsEmpty.classList.remove('hidden');
                }
              } else if (testsList) {
                items.forEach(function (test) {
                  const wrapper = document.createElement('div');
                  wrapper.className = 'test-item';

                  const info = document.createElement('div');
                  info.className = 'test-info';

                  const title = document.createElement('h3');
                  title.textContent = test.name || 'Untitled Test';
                  info.appendChild(title);

                  if (test.description) {
                    const desc = document.createElement('p');
                    desc.className = 'small';
                    desc.textContent = test.description;
                    info.appendChild(desc);
                  }

                  const runButton = document.createElement('button');
                  runButton.className = 'primary';
                  runButton.type = 'button';
                  runButton.textContent = 'Run';
                  runButton.addEventListener('click', async function () {
                    runButton.disabled = true;
                    runButton.textContent = 'Starting...';
                    try {
                      const testId = test.id || (test.metadata && test.metadata.id);
                      await fetch('/api/runs', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ testId })
                      });
                    } catch (error) {
                      console.error('Failed to start test run', error);
                    } finally {
                      runButton.disabled = false;
                      runButton.textContent = 'Run';
                    }
                  });

                  wrapper.appendChild(info);
                  wrapper.appendChild(runButton);
                  testsList.appendChild(wrapper);
                });
              }
            } catch (error) {
              if (testsEmpty) {
                testsEmpty.classList.remove('hidden');
              }
              console.error(error);
            } finally {
              if (testsLoading) {
                testsLoading.classList.add('hidden');
              }
            }
          }

          async function checkHealth() {
            try {
              const response = await fetch('/api/health');
              if (!response.ok) {
                throw new Error('Health check failed');
              }
              if (healthWarning) {
                healthWarning.classList.remove('visible');
              }
            } catch (error) {
              if (healthWarning) {
                healthWarning.classList.add('visible');
              }
              console.error(error);
            }
          }

          if (generateButton) {
            generateButton.addEventListener('click', async function () {
              if (!promptInput) return;
              if (generateButton.disabled) return;

              isGenerating = true;
              updateGenerateState();
              if (messageEl) {
                messageEl.textContent = '';
                messageEl.className = 'message';
              }

              try {
                const response = await fetch('/api/tests/generate', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ prompt: promptInput.value.trim() })
                });
                const payload = await response.json().catch(function () {
                  return { error: 'Request failed' };
                });
                if (!response.ok) {
                  throw new Error(payload.error || ('HTTP ' + response.status));
                }
                if (messageEl) {
                  const generatedName =
                    payload && payload.test && payload.test.metadata
                      ? payload.test.metadata.name
                      : '';
                  messageEl.textContent = generatedName
                    ? 'Generated "' + generatedName + '"'
                    : 'Test generated successfully';
                  messageEl.className = 'message success';
                }
                promptInput.value = '';
                await loadTests();
              } catch (error) {
                const text = error && error.message ? error.message : 'Failed to generate test';
                if (messageEl) {
                  messageEl.textContent = text;
                  messageEl.className = 'message error';
                }
              } finally {
                isGenerating = false;
                updateGenerateState();
              }
            });
          }

          loadTests();
          checkHealth();
        })();
      </script>
    </body>
    </html>
  `;

  const settingsPageHtml = String.raw`
    <!doctype html>
    <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Settings · TrailWright QA</title>
      <style>${fallbackStyles}</style>
    </head>
    <body>
      <div class="page">
        <div class="container" style="max-width: 680px;">
          <button class="secondary" data-nav="home" style="margin-bottom: 16px;">&larr; Back to Home</button>
          <h1 style="font-size: 32px; margin-bottom: 24px;">Settings</h1>
          <p id="settings-loading" data-testid="settings-loading" class="small">Loading configuration...</p>
          <form id="settings-form" class="card">
            <section>
              <label for="provider-anthropic">AI Provider</label>
              <div class="radio-group">
                <label class="radio-item" for="provider-anthropic">
                  <input type="radio" id="provider-anthropic" name="apiProvider" value="anthropic" checked />
                  <span>Anthropic</span>
                </label>
                <label class="radio-item" for="provider-openai">
                  <input type="radio" id="provider-openai" name="apiProvider" value="openai" />
                  <span>Openai</span>
                </label>
                <label class="radio-item" for="provider-gemini">
                  <input type="radio" id="provider-gemini" name="apiProvider" value="gemini" />
                  <span>Gemini</span>
                </label>
              </div>
            </section>

            <section>
              <label for="api-key-input">API Key</label>
              <input id="api-key-input" type="password" name="apiKey" placeholder="sk-..." />
            </section>

            <section>
              <label for="base-url-input">Default Base URL</label>
              <input id="base-url-input" type="url" name="baseUrl" placeholder="https://example.com" />
            </section>

            <section>
              <label>Default Browser</label>
              <div class="radio-group">
                <label class="radio-item" for="browser-chromium">
                  <input type="radio" id="browser-chromium" name="defaultBrowser" value="chromium" checked />
                  <span>Chromium</span>
                </label>
                <label class="radio-item" for="browser-firefox">
                  <input type="radio" id="browser-firefox" name="defaultBrowser" value="firefox" />
                  <span>Firefox</span>
                </label>
                <label class="radio-item" for="browser-webkit">
                  <input type="radio" id="browser-webkit" name="defaultBrowser" value="webkit" />
                  <span>WebKit</span>
                </label>
              </div>
            </section>

            <div>
              <button id="save-settings" type="submit" class="primary">Save Settings</button>
              <p id="settings-message" class="message" role="status"></p>
            </div>
          </form>
        </div>
      </div>

      <script>
        (function () {
          const defaults = {
            apiProvider: 'anthropic',
            apiKey: '',
            baseUrl: '',
            defaultBrowser: 'chromium'
          };

          const form = document.getElementById('settings-form');
          const loadingEl = document.getElementById('settings-loading');
          const messageEl = document.getElementById('settings-message');
          const saveBtn = document.getElementById('save-settings');
          const homeButtons = Array.from(document.querySelectorAll('[data-nav="home"]'));

          homeButtons.forEach(function (btn) {
            btn.addEventListener('click', function () {
              window.location.href = '/';
            });
          });

          function setRadioValue(name, value) {
            const radios = Array.from(document.querySelectorAll('input[name="' + name + '"]'));
            radios.forEach(function (radio) {
              radio.checked = radio.value === value;
            });
          }

          function setFormValues(config) {
            const apiKeyInput = document.getElementById('api-key-input');
            if (apiKeyInput) {
              apiKeyInput.value = config.apiKey || '';
            }
            const baseUrlInput = document.getElementById('base-url-input');
            if (baseUrlInput) {
              baseUrlInput.value = config.baseUrl || '';
            }
            setRadioValue('apiProvider', config.apiProvider);
            setRadioValue('defaultBrowser', config.defaultBrowser);
          }

          function gatherFormValues() {
            const provider = document.querySelector('input[name="apiProvider"]:checked');
            const browser = document.querySelector('input[name="defaultBrowser"]:checked');
            const apiKeyInput = document.getElementById('api-key-input');
            const baseUrlInput = document.getElementById('base-url-input');
            return {
              apiProvider: provider ? provider.value : defaults.apiProvider,
              apiKey: apiKeyInput ? apiKeyInput.value : '',
              baseUrl: baseUrlInput ? baseUrlInput.value : '',
              defaultBrowser: browser ? browser.value : defaults.defaultBrowser
            };
          }

          async function loadConfig() {
            try {
              const response = await fetch('/api/config');
              if (!response.ok) {
                throw new Error('Failed to load config');
              }
              const data = await response.json();
              const merged = Object.assign({}, defaults, data || {});
              setFormValues(merged);
            } catch (error) {
              console.error(error);
              setFormValues(defaults);
            } finally {
              if (loadingEl) {
                loadingEl.classList.add('hidden');
              }
            }
          }

          if (form) {
            form.addEventListener('submit', async function (event) {
              event.preventDefault();
              if (messageEl) {
                messageEl.textContent = '';
                messageEl.className = 'message';
              }
              if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.textContent = 'Saving...';
              }

              try {
                const payload = gatherFormValues();
                const response = await fetch('/api/config', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload)
                });
                const result = await response.json().catch(function () {
                  return { error: 'Request failed' };
                });
                if (!response.ok) {
                  throw new Error(result.error || ('HTTP ' + response.status));
                }
                if (messageEl) {
                  messageEl.textContent = 'Settings saved successfully';
                  messageEl.className = 'message success';
                }
              } catch (error) {
                const text = error && error.message ? error.message : 'Unable to save settings';
                if (messageEl) {
                  messageEl.textContent = 'Error: ' + text;
                  messageEl.className = 'message error';
                }
              } finally {
                if (saveBtn) {
                  saveBtn.disabled = false;
                  saveBtn.textContent = 'Save Settings';
                }
              }
            });
          }

          loadConfig();
        })();
      </script>
    </body>
    </html>
  `;

  app.get('/', (_req, res) => {
    res.type('html').send(homePageHtml);
  });

  app.get('/settings', (_req, res) => {
    res.type('html').send(settingsPageHtml);
  });

  console.warn(
    `[server] Client build not found at ${CLIENT_INDEX_FILE}; serving fallback HTML for core routes.`
  );
}

// Initialize storage on startup
await initStorage(CONFIG.DATA_DIR);
console.log(`[storage] Data directory: ${CONFIG.DATA_DIR}`);

await ensurePlaywrightConfig(CONFIG.DATA_DIR);
console.log(`[playwright] Configured`);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/tests', testsRouter);
app.use('/api/runs', runsRouter);
app.use('/api/config', configRouter);
app.use('/api/generate', generateRouter);
app.use('/api/credentials', credentialsRouter);

if (hasClientBuild) {
  // SPA fallback: serve built index.html for non-API GET requests
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) {
      return next();
    }

    res.sendFile(CLIENT_INDEX_FILE);
  });
}

app.listen(CONFIG.PORT, () => {
  console.log(`TrailWright server running on http://localhost:${CONFIG.PORT}`);
});
