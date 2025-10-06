/**
 * App Theme Configuration
 * Modern Australian-inspired dark theme
 */

import { MD3DarkTheme as DefaultTheme } from 'react-native-paper';

export const theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    // Brand colors - Australian coastal & eucalyptus inspired
    primary: '#009868', // Bright eucalyptus green
    primaryDark: '#059669', // Darker green for HTML templates
    secondary: '#cfa153', // Golden wattle yellow
    onPrimary: '#FFFFFF', // White text on primary buttons
    onSecondary: '#FFFFFF', // White text on secondary buttons

    // Background colors - Dark mode
    background: '#0F172A',
    surface: '#1E293B',
    surfaceLight: '#334155',
    surfaceGray: '#475569',
    surfaceGray2: '#334155',
    surfaceGray3: '#293548',
    white: '#FFFFFF',

    // Text colors - Light for dark backgrounds
    text: '#E2E8F0',
    textDark: '#F1F5F9',
    textMuted: '#94A3B8',
    onSurface: '#CBD5E1',

    // UI element colors
    disabled: '#475569',
    placeholder: '#64748B',
    inactive: '#64748B',

    // Border colors
    border: '#334155',
    borderLight: '#1E293B',

    // Status colors - Bright for dark mode
    error: '#EF4444',
    success: '#00C897', // Brighter eucalyptus green
    warning: '#E6B872', // Softer golden yellow
    info: '#5AB9EA', // Australian coastal blue
    rejected: '#EF4444',

    // Status background colors - Darker, muted
    successBg: '#064E3B',
    warningBg: '#78350F',
    errorBg: '#7F1D1D',
    infoBg: '#164E63',

    // Overlays
    backdrop: 'rgba(0, 0, 0, 0.7)',
  },
  roundness: 8,
};

export const colors = theme.colors;
