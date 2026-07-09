// @vitest-environment jsdom
/**
 * Regression tests for the SkeletonCrossfade remount bug: when the crossfade
 * finished, the component used to switch from rendering children inside
 * View > Animated.View to returning them bare — React saw a different tree
 * shape, unmounted and remounted the children, and every entrance animation
 * inside (AnimatedListItem etc.) replayed from opacity 0. Visible as the
 * Recent Jobs section fading in, blinking out, and fading in again.
 */
import React, { useEffect } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { Text } from 'react-native';
import { SkeletonCrossfade } from './SkeletonCrossfade';

let mounts = 0;
function MountProbe() {
  useEffect(() => {
    mounts++;
  }, []);
  return <Text>real-content</Text>;
}

const skeleton = <Text>skeleton-content</Text>;

describe('SkeletonCrossfade', () => {
  beforeEach(() => {
    mounts = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders children (and no skeleton) when already loaded at mount', () => {
    const { queryByText } = render(
      <SkeletonCrossfade loaded skeleton={skeleton}>
        <MountProbe />
      </SkeletonCrossfade>,
    );
    expect(queryByText('real-content')).toBeTruthy();
    expect(queryByText('skeleton-content')).toBeNull();
    expect(mounts).toBe(1);
  });

  it('shows only the skeleton while not loaded', () => {
    const { queryByText } = render(
      <SkeletonCrossfade loaded={false} skeleton={skeleton}>
        <MountProbe />
      </SkeletonCrossfade>,
    );
    expect(queryByText('skeleton-content')).toBeTruthy();
    expect(queryByText('real-content')).toBeNull();
    expect(mounts).toBe(0);
  });

  it('applies flex to the wrappers when `fill` is set (FlatList content keeps its height)', () => {
    const { container } = render(
      <SkeletonCrossfade loaded fill skeleton={skeleton}>
        <MountProbe />
      </SkeletonCrossfade>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    const contentWrapper = wrapper.firstElementChild as HTMLElement;
    expect(getComputedStyle(wrapper).flexGrow).toBe('1');
    expect(getComputedStyle(contentWrapper).flexGrow).toBe('1');
  });

  it('leaves the wrappers content-sized without `fill`', () => {
    const { container } = render(
      <SkeletonCrossfade loaded skeleton={skeleton}>
        <MountProbe />
      </SkeletonCrossfade>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(getComputedStyle(wrapper).flexGrow).not.toBe('1');
  });

  it('mounts children exactly once across the whole skeleton→content crossfade', async () => {
    const { queryByText, rerender } = render(
      <SkeletonCrossfade loaded={false} skeleton={skeleton}>
        <MountProbe />
      </SkeletonCrossfade>,
    );

    // Data arrives — crossfade starts. Children mount now, behind the fade.
    rerender(
      <SkeletonCrossfade loaded skeleton={skeleton}>
        <MountProbe />
      </SkeletonCrossfade>,
    );
    expect(mounts).toBe(1);
    expect(queryByText('real-content')).toBeTruthy();

    // Run the fade to completion (250ms out + 80ms delay + 350ms in).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // Skeleton is gone, content is still there — and crucially the children
    // were NOT remounted when the skeleton was dropped from the tree.
    expect(queryByText('skeleton-content')).toBeNull();
    expect(queryByText('real-content')).toBeTruthy();
    expect(mounts).toBe(1);
  });
});
