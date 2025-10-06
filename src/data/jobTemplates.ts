/**
 * Job templates for QuoteMate
 * Users can describe their custom jobs and AI will analyze and suggest materials
 */

import { JobTemplate } from '../types';

export const JOB_TEMPLATES: JobTemplate[] = [
  {
    id: 'custom',
    name: 'Custom Job',
    description: 'Describe your job and AI will suggest materials',
    icon: 'hammer-wrench',
    requiredParams: [],
    defaultMaterials: [],
    estimatedHoursFormula: '8',
  },
];

// Helper to get template by ID
export const getTemplateById = (id: string): JobTemplate | undefined => {
  return JOB_TEMPLATES.find((template) => template.id === id);
};
