import { describe, expect, it } from 'vitest';
import { isWrittenScope, parseListItem, WRITTEN_SCOPE_MIN_CHARS, WRITTEN_SCOPE_MIN_ITEMS } from './writtenScope';

/**
 * A written scope is the tradie's own list of work items. Only those get
 * per-section scope descriptions; every other job description is untouched.
 */
describe('isWrittenScope', () => {
  it('a numbered list of three or more items is a written scope', () => {
    const text = [
      '1. Remove existing kitchen cupboards, benchtop and splashback and dispose of all rubbish.',
      '2. Frame the new walk-in robe with 90x45 pine and a cavity slider opening.',
      '3. Demolish the ensuite back to the frame — plumbing disconnection by others.',
    ].join('\n');
    expect(isWrittenScope(text)).toBe(true);
  });

  it('a bulleted list ("-" or "•") is a written scope', () => {
    const dashes = [
      '- Strip the old carpet and underlay from the lounge and hallway and take it away.',
      '- Sand and seal the existing hardwood floor underneath with two coats of satin.',
      '- Replace the damaged skirting boards in the hallway and paint to match the rest.',
    ].join('\n');
    const bullets = dashes.replace(/^- /gm, '• ');
    expect(isWrittenScope(dashes)).toBe(true);
    expect(isWrittenScope(bullets)).toBe(true);
  });

  it('dictated inline numbering ("1. … 2. … 3. …" with no newlines) is a written scope', () => {
    const text =
      '1. Remove the old colorbond fence along the back boundary and take it to the tip ' +
      '2. Install a new 1.8 m high colorbond fence in Monument with new posts in concrete ' +
      '3. Fit a single pedestrian gate on the side with a lockable latch supplied by the customer';
    expect(text.includes('\n')).toBe(false);
    expect(isWrittenScope(text)).toBe(true);
  });

  it('two items are not enough', () => {
    const text = [
      '1. Remove existing kitchen cupboards, benchtop and splashback and dispose of all rubbish from site.',
      '2. Frame the new walk-in robe with 90x45 pine studs, noggins and a cavity slider opening to suit.',
      'Customer is happy for us to start in the second week of October if that suits everyone involved.',
    ].join('\n');
    expect(text.trim().length).toBeGreaterThanOrEqual(WRITTEN_SCOPE_MIN_CHARS);
    expect(isWrittenScope(text)).toBe(false);
  });

  it('a long prose paragraph is not a written scope', () => {
    const text =
      'The customer wants the back deck rebuilt. The old boards are rotten and a few joists are soft, ' +
      'so we will pull the boards up, check the frame, replace what is needed and lay new merbau boards ' +
      'with hidden fixings. They would also like the stairs redone and a coat of oil once it is finished.';
    expect(text.length).toBeGreaterThanOrEqual(WRITTEN_SCOPE_MIN_CHARS);
    expect(isWrittenScope(text)).toBe(false);
  });

  it('a short one-liner is not a written scope, even with list markers', () => {
    expect(isWrittenScope('Replace hot water system')).toBe(false);
    expect(isWrittenScope('1. Tap 2. Toilet 3. Shower head')).toBe(false);
    expect(isWrittenScope('')).toBe(false);
    expect(isWrittenScope(undefined)).toBe(false);
  });

  it('dimensions like "2.4m bays" or "1.8 m" are not counted as numbered markers', () => {
    const text =
      'Build a new colorbond fence along the back boundary using 2.4m bays, 1.8 m high, with 3.0m posts ' +
      'set in concrete. Total run is about 21.6m so roughly 9 bays. Existing fence is 1.5m timber and needs ' +
      'to come out first, with the rubbish taken away. Customer wants Monument colour for the sheets.';
    expect(text.length).toBeGreaterThanOrEqual(WRITTEN_SCOPE_MIN_CHARS);
    expect(isWrittenScope(text)).toBe(false);
  });

  it('prose with stray "12." "1." "2." "4." numbers is not a written scope', () => {
    const text =
      'Rewire the old house, the customer counted a total of 12. Replace switches in bedrooms 1. and 2. ' +
      'as well as the hallway, and the power points in the kitchen need moving. The unit is at unit 4. Smith St ' +
      'and access is through the side gate, so park on the street please.';
    expect(text.length).toBeGreaterThanOrEqual(WRITTEN_SCOPE_MIN_CHARS);
    expect(isWrittenScope(text)).toBe(false);
  });

  it('prose with times like "at 7." "at 12." "by 3." is not a written scope', () => {
    const text =
      'Arrive at 7. Set up drop sheets in the lounge and hallway and mask the skirting and windows. Break for lunch ' +
      'at 12. Then cut in and roll the first coat on the walls and ceilings in both rooms. Finish by 3. Pack up and ' +
      'leave the site tidy for the customer.';
    expect(text.length).toBeGreaterThanOrEqual(WRITTEN_SCOPE_MIN_CHARS);
    expect(isWrittenScope(text)).toBe(false);
  });

  it('dictated numbering still counts once it runs 1, 2, 3 in order, even after a stray number', () => {
    const text =
      'Job is at unit 12. 1. Remove the old colorbond fence along the back boundary and take it to the tip ' +
      '2. Install a new 1.8 m high colorbond fence in Monument with new posts in concrete ' +
      '3. Fit a single pedestrian gate on the side with a lockable latch';
    expect(isWrittenScope(text)).toBe(true);
  });

  it('"Step 1:", "1:", "1 -" and "1 —" line markers count', () => {
    const items = [
      'Remove the existing vanity, toilet and wall tiles and take all the rubbish away from site.',
      'Waterproof the floor and the shower walls to 1800 mm and leave to cure overnight.',
      'Tile the floor and walls with customer-supplied tiles and grout in a light grey.',
    ];
    for (const marker of [(n: number) => `Step ${n}: `, (n: number) => `${n}: `, (n: number) => `${n} - `, (n: number) => `${n} — `]) {
      const text = items.map((item, i) => marker(i + 1) + item).join('\n');
      expect(isWrittenScope(text)).toBe(true);
    }
  });

  it('em dash, symbol and emoji bullets count', () => {
    const items = [
      'Remove the existing vanity, toilet and wall tiles and take all the rubbish away from site.',
      'Waterproof the floor and the shower walls to 1800 mm and leave to cure overnight.',
      'Tile the floor and walls with customer-supplied tiles and grout in a light grey.',
    ];
    for (const bullet of ['— ', '▪ ', '✅ ', '▪️ ', '🔨 ']) {
      const text = items.map((item) => bullet + item).join('\n');
      expect(isWrittenScope(text)).toBe(true);
    }
  });

  it('"1:100 scale" and times like "7:30am" at the start of lines are not markers', () => {
    const text = [
      '1:100 scale plans attached for the new rear extension, customer has council approval already in hand.',
      '7:30am start on site each day, and the neighbours have asked that we keep the driveway clear for them.',
      '8:15am concrete truck is booked for the Thursday, weather permitting, for the new slab pour out the back.',
    ].join('\n');
    expect(isWrittenScope(text)).toBe(false);
  });

  it('exposes its thresholds', () => {
    expect(WRITTEN_SCOPE_MIN_ITEMS).toBe(3);
    expect(WRITTEN_SCOPE_MIN_CHARS).toBe(200);
  });
});

describe('parseListItem', () => {
  it('strips a numbered marker and says it is numbered', () => {
    expect(parseListItem('3. Waterproofing')).toEqual({ indent: 0, numbered: true, body: 'Waterproofing' });
    expect(parseListItem('Step 2: Frame the niche')).toEqual({ indent: 0, numbered: true, body: 'Frame the niche' });
  });

  it('strips a bullet and keeps the indent', () => {
    expect(parseListItem('  • Supply and install a dimmer')).toEqual({ indent: 2, numbered: false, body: 'Supply and install a dimmer' });
    expect(parseListItem('- Remove the gutter')).toEqual({ indent: 0, numbered: false, body: 'Remove the gutter' });
  });

  it('returns null for a line that is not a list item', () => {
    expect(parseListItem('Remove demolition waste from site.')).toBeNull();
    expect(parseListItem('2.4m high fence')).toBeNull();
  });
});
