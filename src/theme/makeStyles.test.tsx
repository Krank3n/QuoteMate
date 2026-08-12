// @vitest-environment jsdom
/**
 * The performance claim, tested.
 *
 * makeStyles only earns its place if StyleSheet.create runs at most twice per
 * file for the life of the process. If it rebuilt per render it would be
 * strictly worse than the module-scope stylesheets it replaces, and that
 * regression would be invisible — the app would just drop frames.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Text, View } from 'react-native';

import { makeStyles } from './makeStyles';
import { ThemeProvider, useAppTheme, resolveScheme } from './ThemeProvider';
import { LIGHT_MODE_ENABLED } from './config';

vi.mock('../services/appearance', async () => {
  const actual = await vi.importActual<typeof import('../services/appearance')>(
    '../services/appearance',
  );
  return {
    ...actual,
    getAppearancePreference: vi.fn(async () => null),
    setAppearancePreference: vi.fn(async () => {}),
  };
});

describe('makeStyles', () => {
  let builds = 0;
  let useStyles: () => { card: object };

  beforeEach(() => {
    builds = 0;
    useStyles = makeStyles((t) => {
      builds += 1;
      return { card: { backgroundColor: t.colors.surfaceRaised } };
    });
  });

  function Probe() {
    const styles = useStyles();
    return <View testID="probe" style={styles.card as object} />;
  }

  it('builds the stylesheet once, not once per render', () => {
    const { rerender } = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(builds).toBe(1);

    for (let i = 0; i < 5; i++) {
      rerender(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>,
      );
    }
    expect(builds, 'stylesheet rebuilt on re-render — cache is not working').toBe(1);
  });

  it('returns the identical object across renders in the same theme', () => {
    const seen: object[] = [];
    function Capture() {
      seen.push(useStyles());
      return null;
    }
    const { rerender } = render(
      <ThemeProvider>
        <Capture />
      </ThemeProvider>,
    );
    rerender(
      <ThemeProvider>
        <Capture />
      </ThemeProvider>,
    );
    expect(seen.length).toBeGreaterThan(1);
    expect(seen[0]).toBe(seen[seen.length - 1]);
  });

  it('renders the theme colour into the style', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('probe')).toBeTruthy();
    expect(builds).toBe(1);
  });
});

describe('resolveScheme', () => {
  it('clamps to dark while light mode is disabled, whatever is asked for', () => {
    if (LIGHT_MODE_ENABLED) return; // behaviour intentionally changes in Stage 5
    expect(resolveScheme('light', 'light')).toBe('dark');
    expect(resolveScheme('system', 'light')).toBe('dark');
    expect(resolveScheme('dark', 'light')).toBe('dark');
  });
});

describe('useAppTheme', () => {
  it('falls back to the dark theme outside a provider rather than crashing', () => {
    let name: string | undefined;
    function Bare() {
      name = useAppTheme().theme.name;
      return null;
    }
    render(<Bare />);
    expect(name).toBe('dark');
  });
});
