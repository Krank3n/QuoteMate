// @vitest-environment jsdom
/**
 * The header back chevron the app draws itself.
 *
 * The library's bundled back-icon PNG never rendered on iPad, so every stack
 * navigator supplies this component as `headerBackImage` instead. These tests
 * pin what it hands the icon font: the chevron glyph, a size that sits level
 * with the header title, and the stack's tint (the theme's text colour).
 *
 * The icon component is replaced with a prop recorder: what matters is what
 * the chevron asks the font to draw, not how @expo/vector-icons rasterises it.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';

const iconProps = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[] }));

vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({
  default: (props: Record<string, unknown>) => {
    iconProps.calls.push(props);
    return null;
  },
}));

// Distinct values so a test can tell the text colour from every other token.
const THEME_TEXT = '#1a2b3c';
vi.mock('../theme', () => ({
  useThemeColors: () => ({ text: THEME_TEXT, primary: '#ff0000', surface: '#ffffff' }),
}));

import {
  HeaderBackChevron,
  renderHeaderBackChevron,
  HEADER_BACK_CHEVRON_ICON,
  HEADER_BACK_CHEVRON_SIZE,
} from './HeaderBackChevron';

describe('HeaderBackChevron', () => {
  beforeEach(() => {
    iconProps.calls.length = 0;
  });

  it('draws the chevron-left glyph from MaterialCommunityIcons', () => {
    render(<HeaderBackChevron />);
    expect(iconProps.calls).toHaveLength(1);
    expect(iconProps.calls[0].name).toBe('chevron-left');
    expect(HEADER_BACK_CHEVRON_ICON).toBe('chevron-left');
  });

  it('is sized to sit level with the header title (28–30)', () => {
    render(<HeaderBackChevron />);
    expect(iconProps.calls[0].size).toBe(HEADER_BACK_CHEVRON_SIZE);
    expect(HEADER_BACK_CHEVRON_SIZE).toBeGreaterThanOrEqual(28);
    expect(HEADER_BACK_CHEVRON_SIZE).toBeLessThanOrEqual(30);
  });

  it('falls back to the theme text colour when the header passes no tint', () => {
    render(<HeaderBackChevron />);
    expect(iconProps.calls[0].color).toBe(THEME_TEXT);
  });

  it('takes the tint the header passes (every stack sets headerTintColor to the theme text colour)', () => {
    render(<HeaderBackChevron tintColor="#0f0f0f" />);
    expect(iconProps.calls[0].color).toBe('#0f0f0f');
  });

  it('renderHeaderBackChevron is a headerBackImage renderer: called with the tint, it yields the chevron', () => {
    render(<>{renderHeaderBackChevron({ tintColor: THEME_TEXT })}</>);
    expect(iconProps.calls).toHaveLength(1);
    expect(iconProps.calls[0]).toMatchObject({ name: 'chevron-left', color: THEME_TEXT });
  });
});
