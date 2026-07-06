import { describe, it, expect } from 'vitest';
import { simplifySearchTerm } from './simplifySearchTerm';

describe('simplifySearchTerm', () => {
  it('strips dimensions, treatment grades, and parentheticals from real audit failures', () => {
    // The rows the reconcile pass rejected in the replay audit because the
    // precise term returned wrong-category products.
    expect(simplifySearchTerm('2400x100x100mm CCA Treated Hardwood Post')).toBe('Treated Hardwood Post');
    expect(simplifySearchTerm('Hardwood Post 100x100mm 2.4m (Durability Class 1)')).toBe('Hardwood Post');
    expect(simplifySearchTerm('Treated Pine Plinth Board H3 150x25mm 2.4m')).toBe('Treated Pine Plinth Board');
    expect(simplifySearchTerm('Sliding Gate Wheels 90mm')).toBe('Sliding Gate Wheels');
    expect(simplifySearchTerm('Oil Absorbent Granules 15kg Bag')).toBe('Oil Absorbent Granules Bag');
  });

  it('strips screw gauges and pack qualifiers', () => {
    expect(simplifySearchTerm('Galvanised Bugle Batten Screws 14g x 125mm')).toBe('Galvanised Bugle Batten Screws');
    expect(simplifySearchTerm('Black Aluminium Fence Panel Brackets 4 Pack')).toBe('Black Aluminium Fence Panel Brackets');
  });

  it('returns null when nothing changes or nothing usable remains', () => {
    expect(simplifySearchTerm('treated hardwood post')).toBeNull();
    expect(simplifySearchTerm('2.4m')).toBeNull();
    expect(simplifySearchTerm('')).toBeNull();
    expect(simplifySearchTerm('20kg')).toBeNull();
  });
});
