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
    <button id="tw-stop-recording" style="
      padding: 8px 16px;
      background: rgba(255,255,255,0.2);
      border: 1px solid rgba(255,255,255,0.3);
      border-radius: 6px;
      color: white;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s;
    ">Stop Recording</button>
  </div>
</div>
<style>
@keyframes tw-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
#tw-stop-recording:hover {
  background: rgba(255,255,255,0.3);
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

export const TOOLBAR_LISTENER_SCRIPT = `
  const stopBtn = document.getElementById('tw-stop-recording');
  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      window.__twStopRecording();
    });
  }
`;
