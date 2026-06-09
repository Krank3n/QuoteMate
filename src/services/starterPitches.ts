/**
 * Starter sales pitches.
 *
 * Seeded into BusinessSettings.salesPitches the first time the
 * QuotePitchScreen is opened with no existing library. The two below are
 * Jesse Gorman's exact pitches \u2014 they're representative of the kind of
 * boilerplate any tradie wants on every quote, so we ship them as the
 * out-of-the-box starting point. Users can rename/edit/delete freely.
 */

import { SalesPitch } from '../types';
import { generateId } from '../utils/generateId';

export function buildStarterPitches(): SalesPitch[] {
  return [
    {
      id: generateId(),
      name: 'Owner-operator (default)',
      isDefault: true,
      body: `J. Gorman Insulation \u2013 Owner Operated, Quality You Can Trust

Looking to make your home more comfortable and energy efficient?

At J. Gorman Insulation, I provide professional, high-quality insulation with a strong focus on detail and long-lasting results. As an owner-operator, I handle every job personally.

\u2714 Floor insulation expertly strapped to ensure it stays in place
\u2714 Reduce your energy bills and save money
\u2714 Improve heating and cooling efficiency by up to 80%
\u2714 Enjoy a more comfortable home all year round
\u2714 Reduce outside noise and improve sound control
\u2714 Lower your carbon footprint

Fully accredited and covered by public liability insurance for your peace of mind.

With over 150 \u2b50\u2b50\u2b50\u2b50\u2b50 Google reviews, my work speaks for itself.

If you want insulation done the first time properly, get in touch today.`,
    },
    {
      id: generateId(),
      name: 'R-value upgrade',
      body: `Upgrading your existing R{{existing_R}} insulation by adding R{{added_R}} will bring your total rating up to R{{total_R}}. This significant boost will noticeably improve your home's comfort year-round while helping reduce energy costs. Since up to 35\u201340% of heat loss occurs through the ceiling, this upgrade delivers one of the most effective returns for your home.

Local accredited insulation installer with Public liability insurance.

With over 150 5-star Google reviews.`,
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
    },
  ];
}
