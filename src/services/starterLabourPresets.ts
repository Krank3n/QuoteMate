/**
 * Starter labour-rate presets.
 *
 * Seeded into BusinessSettings.labourRatePresets the first time the
 * LabourRatePresetsScreen is opened with no existing presets. The two
 * below are Jesse's verbatim labour rates \u2014 $1,500 / 100 m\u00b2 for ceiling
 * insulation and $2,500 / 100 m\u00b2 for floor insulation.
 */

import { LabourRatePreset } from '../types';
import { generateId } from '../utils/generateId';

export function buildStarterLabourPresets(): LabourRatePreset[] {
  return [
    {
      id: generateId(),
      name: 'Ceiling insulation',
      amount: 1500,
      denominator: 100,
      unit: 'm\u00b2',
    },
    {
      id: generateId(),
      name: 'Floor insulation',
      amount: 2500,
      denominator: 100,
      unit: 'm\u00b2',
    },
  ];
}
