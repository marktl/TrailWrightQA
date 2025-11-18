import type { ViewportSize } from '../../../shared/types';

export interface ScreenSizePreset {
  id: string;
  name: string;
  viewport: ViewportSize;
  description?: string;
}

export const SCREEN_SIZE_PRESETS: ScreenSizePreset[] = [
  { id: 'desktop-hd', name: 'Desktop HD (1920x1080)', viewport: { width: 1920, height: 1080 }, description: 'Full HD desktop' },
  { id: 'desktop-standard', name: 'Desktop (1366x768)', viewport: { width: 1366, height: 768 }, description: 'Standard laptop' },
  { id: 'desktop-mac', name: 'MacBook Pro (1440x900)', viewport: { width: 1440, height: 900 }, description: '13" MacBook Pro' },
  { id: 'tablet-landscape', name: 'Tablet Landscape (1024x768)', viewport: { width: 1024, height: 768 }, description: 'iPad landscape' },
  { id: 'tablet-portrait', name: 'Tablet Portrait (768x1024)', viewport: { width: 768, height: 1024 }, description: 'iPad portrait' },
  { id: 'mobile-large', name: 'Mobile Large (414x896)', viewport: { width: 414, height: 896 }, description: 'iPhone XR/11' },
  { id: 'mobile-medium', name: 'Mobile Medium (375x667)', viewport: { width: 375, height: 667 }, description: 'iPhone SE' },
  { id: 'mobile-small', name: 'Mobile Small (320x568)', viewport: { width: 320, height: 568 }, description: 'iPhone 5/SE' },
];
