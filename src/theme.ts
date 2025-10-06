/**
 * App Theme Configuration
 * Using Bunnings green as primary color
 */

import { MD3LightTheme as DefaultTheme } from 'react-native-paper';

export const theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: '#008542', // Bunnings green
    secondary: '#FF6B35', // Orange accent for CTAs
    background: '#F5F5F5',
    surface: '#FFFFFF',
    error: '#D32F2F',
    text: '#212121',
    onSurface: '#757575',
    disabled: '#BDBDBD',
    placeholder: '#9E9E9E',
    backdrop: 'rgba(0, 0, 0, 0.5)',
  },
  roundness: 8,
};

export const colors = theme.colors;
