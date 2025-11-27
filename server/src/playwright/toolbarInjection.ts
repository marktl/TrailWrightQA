export const TOOLBAR_HTML = `
<div id="trailwright-recorder-toolbar" style="
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 12px 20px;
  font-family: system-ui, -apple-system, sans-serif;
  z-index: 2147483647;
  box-shadow: 0 2px 10px rgba(0,0,0,0.2);
  display: flex;
  justify-content: space-between;
  align-items: center;
">
  <div style="display: flex; align-items: center; gap: 16px;">
    <span style="display: flex; align-items: center; gap: 8px;">
      <span id="tw-recording-dot" style="
        width: 12px;
        height: 12px;
        background: #ef4444;
        border-radius: 50%;
        animation: tw-pulse 2s infinite;
      "></span>
      <strong>Recording</strong>
    </span>
    <span id="tw-step-count" style="opacity: 0.9;">0 steps captured</span>
  </div>
  <div style="display: flex; gap: 12px;">
    <button id="tw-add-assertion" style="
      padding: 8px 16px;
      background: rgba(255,255,255,0.2);
      border: 1px solid rgba(255,255,255,0.3);
      border-radius: 6px;
      color: white;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s;
    ">➕ Add Assertion</button>
    <button id="tw-stop-recording" style="
      padding: 8px 16px;
      background: rgba(255,255,255,0.2);
      border: 1px solid rgba(255,255,255,0.3);
      border-radius: 6px;
      color: white;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s;
    ">Pause Recording</button>
  </div>
</div>

<!-- Assertion Type Modal -->
<div id="tw-assertion-modal" style="
  display: none;
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: white;
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
  z-index: 2147483648;
  width: 400px;
  max-width: 90vw;
  font-family: system-ui, -apple-system, sans-serif;
">
  <div style="padding: 20px; border-bottom: 1px solid #e5e7eb;">
    <h3 style="margin: 0; font-size: 18px; color: #1f2937;">What should I verify?</h3>
    <p id="tw-modal-element-name" style="margin: 8px 0 0; font-size: 14px; color: #6b7280;"></p>
  </div>
  <div style="padding: 16px;">
    <div style="display: flex; flex-direction: column; gap: 12px;">
      <label style="display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px solid #e5e7eb; border-radius: 8px; cursor: pointer; transition: all 0.2s;" class="tw-assertion-option">
        <input type="radio" name="tw-assertion-type" value="visible" checked style="width: 18px; height: 18px;">
        <div>
          <div style="font-weight: 500; color: #1f2937;">Element is visible</div>
          <div style="font-size: 12px; color: #6b7280;">Verify the element appears on the page</div>
        </div>
      </label>
      <label style="display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px solid #e5e7eb; border-radius: 8px; cursor: pointer; transition: all 0.2s;" class="tw-assertion-option">
        <input type="radio" name="tw-assertion-type" value="text" style="width: 18px; height: 18px;">
        <div style="flex: 1;">
          <div style="font-weight: 500; color: #1f2937;">Element contains text</div>
          <input type="text" id="tw-assert-text-value" placeholder="Expected text..." style="margin-top: 8px; width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 14px;">
        </div>
      </label>
      <label style="display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px solid #e5e7eb; border-radius: 8px; cursor: pointer; transition: all 0.2s;" class="tw-assertion-option">
        <input type="radio" name="tw-assertion-type" value="value" style="width: 18px; height: 18px;">
        <div style="flex: 1;">
          <div style="font-weight: 500; color: #1f2937;">Element has value</div>
          <input type="text" id="tw-assert-value-value" placeholder="Expected value..." style="margin-top: 8px; width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 14px;">
        </div>
      </label>
      <label style="display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px solid #e5e7eb; border-radius: 8px; cursor: pointer; transition: all 0.2s;" class="tw-assertion-option">
        <input type="radio" name="tw-assertion-type" value="url" style="width: 18px; height: 18px;">
        <div style="flex: 1;">
          <div style="font-weight: 500; color: #1f2937;">Page URL contains</div>
          <input type="text" id="tw-assert-url-value" placeholder="/dashboard" style="margin-top: 8px; width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 14px;">
        </div>
      </label>
    </div>
  </div>
  <div style="padding: 16px; border-top: 1px solid #e5e7eb; display: flex; gap: 12px; justify-content: flex-end;">
    <button id="tw-modal-cancel" style="padding: 10px 20px; background: #f3f4f6; border: none; border-radius: 6px; cursor: pointer; font-weight: 500; color: #374151;">Cancel</button>
    <button id="tw-modal-confirm" style="padding: 10px 20px; background: #7c3aed; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">Add Assertion</button>
  </div>
</div>
<div id="tw-modal-backdrop" style="
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0,0,0,0.5);
  z-index: 2147483647;
"></div>

<style>
@keyframes tw-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
#tw-add-assertion:hover, #tw-stop-recording:hover {
  background: rgba(255,255,255,0.3);
}
#tw-add-assertion.active {
  background: rgba(255,255,255,0.4);
  border-color: rgba(255,255,255,0.6);
}
.tw-assertion-option:hover {
  border-color: #7c3aed !important;
  background: #f5f3ff;
}
.tw-assertion-option:has(input:checked) {
  border-color: #7c3aed !important;
  background: #ede9fe;
}
#tw-modal-cancel:hover {
  background: #e5e7eb;
}
#tw-modal-confirm:hover {
  background: #6d28d9;
}
</style>
`;

export function getToolbarUpdateScript(stepCount: number): string {
  return `
    const stepCountEl = document.getElementById('tw-step-count');
    if (stepCountEl) {
      stepCountEl.textContent = '${stepCount} step${stepCount !== 1 ? 's' : ''} captured';
    }
  `;
}

export function getAssertionModeScript(active: boolean): string {
  return `
    const assertBtn = document.getElementById('tw-add-assertion');
    const stepCountEl = document.getElementById('tw-step-count');
    if (assertBtn && stepCountEl) {
      if (${active}) {
        assertBtn.classList.add('active');
        assertBtn.textContent = '✓ Click element to assert...';
        stepCountEl.textContent = '👆 Click any element';
        document.body.style.cursor = 'crosshair';
      } else {
        assertBtn.classList.remove('active');
        assertBtn.textContent = '➕ Add Assertion';
        document.body.style.cursor = 'default';
      }
    }
  `;
}

export function getShowAssertionModalScript(elementName: string, elementText: string): string {
  const escapedName = elementName.replace(/'/g, "\\'").replace(/\n/g, ' ');
  const escapedText = elementText.replace(/'/g, "\\'").replace(/\n/g, ' ').substring(0, 100);
  return `
    const modal = document.getElementById('tw-assertion-modal');
    const backdrop = document.getElementById('tw-modal-backdrop');
    const elementNameEl = document.getElementById('tw-modal-element-name');
    const textInput = document.getElementById('tw-assert-text-value');
    const urlInput = document.getElementById('tw-assert-url-value');

    // Store element text for pre-filling
    window.__twPendingElementText = '${escapedText}';

    if (modal && backdrop) {
      modal.style.display = 'block';
      backdrop.style.display = 'block';
      document.body.style.cursor = 'default';
    }
    if (elementNameEl) {
      // Show element name and preview of text content
      var preview = '${escapedText}' ? ' - "' + '${escapedText}'.substring(0, 50) + (('${escapedText}'.length > 50) ? '...' : '') + '"' : '';
      elementNameEl.textContent = 'Element: ${escapedName}' + preview;
    }
    // Pre-fill text input with element's text content
    if (textInput) {
      textInput.value = '${escapedText}';
    }
    // Pre-fill URL input with current URL
    if (urlInput) {
      urlInput.value = window.location.pathname;
    }
    // If element has text, default to "contains text" assertion, otherwise "visible"
    if ('${escapedText}'.trim()) {
      var textRadio = document.querySelector('input[name="tw-assertion-type"][value="text"]');
      if (textRadio) textRadio.checked = true;
    } else {
      var visibleRadio = document.querySelector('input[name="tw-assertion-type"][value="visible"]');
      if (visibleRadio) visibleRadio.checked = true;
    }
  `;
}

export function getHideAssertionModalScript(): string {
  return `
    const modal = document.getElementById('tw-assertion-modal');
    const backdrop = document.getElementById('tw-modal-backdrop');
    if (modal && backdrop) {
      modal.style.display = 'none';
      backdrop.style.display = 'none';
    }
    // Clear inputs
    const textInput = document.getElementById('tw-assert-text-value');
    const valueInput = document.getElementById('tw-assert-value-value');
    const urlInput = document.getElementById('tw-assert-url-value');
    if (textInput) textInput.value = '';
    if (valueInput) valueInput.value = '';
    if (urlInput) urlInput.value = '';
    window.__twPendingElementText = '';
  `;
}

export const TOOLBAR_LISTENER_SCRIPT = `
  const stopBtn = document.getElementById('tw-stop-recording');
  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      window.__twStopRecording();
    });
  }

  const assertBtn = document.getElementById('tw-add-assertion');
  if (assertBtn) {
    assertBtn.addEventListener('click', () => {
      window.__twStartAssertion();
    });
  }

  // Modal controls
  const modal = document.getElementById('tw-assertion-modal');
  const backdrop = document.getElementById('tw-modal-backdrop');
  const cancelBtn = document.getElementById('tw-modal-cancel');
  const confirmBtn = document.getElementById('tw-modal-confirm');
  const textInput = document.getElementById('tw-assert-text-value');

  // Pre-fill text input with element's text when text option is selected
  document.querySelectorAll('input[name="tw-assertion-type"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      if (e.target.value === 'text' && textInput && window.__twPendingElementText) {
        textInput.value = window.__twPendingElementText;
      }
    });
  });

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      window.__twCancelAssertion();
    });
  }

  if (backdrop) {
    backdrop.addEventListener('click', () => {
      window.__twCancelAssertion();
    });
  }

  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      const selected = document.querySelector('input[name="tw-assertion-type"]:checked');
      const assertionType = selected ? selected.value : 'visible';

      let assertionValue = '';
      if (assertionType === 'text') {
        assertionValue = document.getElementById('tw-assert-text-value')?.value || '';
      } else if (assertionType === 'value') {
        assertionValue = document.getElementById('tw-assert-value-value')?.value || '';
      } else if (assertionType === 'url') {
        assertionValue = document.getElementById('tw-assert-url-value')?.value || '';
      }

      window.__twConfirmAssertion(assertionType, assertionValue);
    });
  }
`;
