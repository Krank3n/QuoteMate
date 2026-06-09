import { describe, it, expect, vi } from 'vitest';
import {
  resolvePitchVariables,
  renderPitch,
  resolveAndRenderPitch,
} from '../salesPitch';
import type { SalesPitch } from '../../types';

const rValuePitch: SalesPitch = {
  id: 'rv',
  name: 'R-value upgrade',
  body:
    'Upgrading your existing R{{existing_R}} insulation by adding R{{added_R}} will bring your total rating up to R{{total_R}}.',
  variables: [
    { key: 'existing_R', label: 'Existing R-value', type: 'number', defaultValue: '2' },
    { key: 'added_R', label: 'Adding R-value', type: 'number', defaultValue: '4.1' },
    {
      key: 'total_R',
      label: 'Total R-value',
      type: 'number',
      derive: { op: 'add', from: ['existing_R', 'added_R'] },
    },
  ],
};

const simplePitch: SalesPitch = {
  id: 's',
  name: 'Owner-operator',
  body: 'Hi {{customerName}}, thanks for reaching out.',
};

describe('resolvePitchVariables', () => {
  it('falls back to defaults when no overrides supplied', () => {
    const r = resolvePitchVariables(rValuePitch, {});
    expect(r.existing_R).toBe('2');
    expect(r.added_R).toBe('4.1');
    expect(r.total_R).toBe('6.1');
  });

  it('honours overrides over defaults', () => {
    const r = resolvePitchVariables(rValuePitch, { existing_R: '3.5', added_R: '2.5' });
    expect(r.total_R).toBe('6');
  });

  it('lets caller pin a derived value manually', () => {
    const r = resolvePitchVariables(rValuePitch, { total_R: '7' });
    expect(r.total_R).toBe('7');
  });

  it('treats empty-string overrides as missing (use default)', () => {
    const r = resolvePitchVariables(rValuePitch, { existing_R: '' });
    expect(r.existing_R).toBe('2');
  });

  it('returns empty strings for unknown variables', () => {
    const r = resolvePitchVariables(simplePitch, {});
    expect(r.customerName).toBeUndefined();
  });
});

describe('renderPitch', () => {
  it('substitutes {{key}} placeholders', () => {
    const out = renderPitch(simplePitch, { customerName: 'Sam' });
    expect(out).toBe('Hi Sam, thanks for reaching out.');
  });

  it('renders unresolved variables as empty (and warns)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const out = renderPitch(simplePitch, {});
    expect(out).toBe('Hi , thanks for reaching out.');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('tolerates whitespace inside braces', () => {
    const p: SalesPitch = { id: 'x', name: 'x', body: '{{ existing_R }} bar' };
    expect(renderPitch(p, { existing_R: '2' })).toBe('2 bar');
  });
});

describe('resolveAndRenderPitch (the Jesse scenario)', () => {
  it('matches Jesse\'s exact R-value example: 2 + 4.1 → 6.1', () => {
    const out = resolveAndRenderPitch(rValuePitch, {});
    expect(out).toBe(
      'Upgrading your existing R2 insulation by adding R4.1 will bring your total rating up to R6.1.',
    );
  });

  it('returns raw text (no HTML escaping at this layer)', () => {
    const p: SalesPitch = {
      id: 'x',
      name: 'x',
      body: '<b>{{x}}</b>',
      variables: [{ key: 'x', label: 'x', type: 'text' }],
    };
    expect(resolveAndRenderPitch(p, { x: '<script>' })).toBe('<b><script></b>');
  });
});
