import { describe, expect, it } from 'vitest';
import { parsePackInfo } from './parsePackInfo';

describe('parsePackInfo', () => {
  it('parses millilitre products as litres', () => {
    expect(parsePackInfo('Sugar Soap Spray 750ml')).toEqual({ packSize: 0.75, packUnit: 'L' });
  });

  it('still parses litre products as litres', () => {
    expect(parsePackInfo('Decking Oil Natural 4L')).toEqual({ packSize: 4, packUnit: 'L' });
  });
});
