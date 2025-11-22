# Record Mode - User Guide

## Overview

Record Mode enables non-technical users to create automated Playwright tests by performing actions directly in the browser. No coding required!

## Quick Start

1. **Navigate to Dashboard** → Click "Create Test" → Select "Record Mode"

2. **Fill Setup Form:**
   - Test Name: Give your test a descriptive name
   - Starting URL: Where should the browser start?
   - Description: (Optional) Brief description

3. **Click "Start Recording"**
   - Browser window opens automatically
   - Recording toolbar appears at top
   - Perform your actions normally

4. **Interact with the Page:**
   - Click buttons, links, etc.
   - Type into input fields
   - Select dropdown options
   - Navigate to different pages
   - Each action is recorded automatically!

5. **Stop and Save:**
   - Click "Stop Recording" in toolbar
   - Review captured steps in viewer
   - Click "Save Test" to add to library

## What Gets Recorded?

- ✅ Clicks on buttons, links, and elements
- ✅ Text input (captured when you tab/click away)
- ✅ Dropdown selections
- ✅ Page navigation
- ✅ Screenshots for each step

## Best Practices

- **Go slow**: Give the AI time to process each action (1-2 seconds between steps)
- **Tab out of inputs**: Press Tab or click elsewhere to finalize text entry
- **Check the viewer**: Watch steps appear in real-time to catch mistakes early
- **Keep tests focused**: Record 5-15 steps per test for maintainability

## Troubleshooting

**Q: My text input didn't record**
A: Make sure to press Tab or click away from the input field to trigger the blur event

**Q: I made a mistake at step 3**
A: Stop recording, delete the incorrect step in the viewer, and continue

**Q: The generated code looks wrong**
A: You can edit the code after saving - it's standard Playwright!

## Technical Details

- Uses Playwright CDP listeners to capture browser events
- AI generates clean, semantic selectors (getByRole, getByLabel)
- Screenshots stored as base64 during recording
- Final test saved as standard .spec.ts file
