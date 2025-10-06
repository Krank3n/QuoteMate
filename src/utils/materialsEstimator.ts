/**
 * Materials estimation logic
 * Converts job templates and parameters into estimated materials lists
 */

import { generateId } from './generateId';
import { Material, JobTemplate, Job } from '../types';

interface JobInput {
  description: string;
  template?: string;
  customParams?: Record<string, number>;
}

/**
 * Safely evaluate a formula with given parameters
 * @param formula - The formula string (e.g., "steps * 2")
 * @param params - The parameters object (e.g., { steps: 15 })
 */
function evaluateFormula(formula: string, params: Record<string, number>): number {
  try {
    // Create a safe evaluation context with Math and params
    const context = { Math, ...params };

    // Build the function string
    const paramNames = Object.keys(context);
    const paramValues = Object.values(context);

    // Create and execute the function
    const func = new Function(...paramNames, `return ${formula}`);
    const result = func(...paramValues);

    // Return rounded result
    return Math.round(result * 100) / 100; // Round to 2 decimal places
  } catch (error) {
    console.error(`Error evaluating formula "${formula}":`, error);
    return 0;
  }
}

/**
 * Estimate materials from a job template
 * @param template - The job template to use
 * @param customParams - Custom parameters (e.g., { steps: 15, length: 10 })
 */
export function estimateMaterialsFromTemplate(
  template: JobTemplate,
  customParams: Record<string, number> = {}
): Material[] {
  const materials: Material[] = [];

  // Process each template material
  for (const templateMaterial of template.defaultMaterials) {
    const quantity = evaluateFormula(templateMaterial.quantityFormula, customParams);

    const material: Material = {
      id: generateId(),
      name: templateMaterial.name,
      quantity,
      unit: templateMaterial.unit,
      price: 0, // Will be fetched from Bunnings API
      totalPrice: 0,
      manualPriceOverride: false,
      searchTerm: templateMaterial.searchTerm,
    };

    materials.push(material);
  }

  return materials;
}

/**
 * Estimate labor hours from a job template
 * @param template - The job template to use
 * @param customParams - Custom parameters
 */
export function estimateLaborHours(
  template: JobTemplate,
  customParams: Record<string, number> = {}
): number {
  return evaluateFormula(template.estimatedHoursFormula, customParams);
}

/**
 * Create a complete job estimate from template and parameters
 * @param template - The job template to use
 * @param customParams - Custom parameters for the job
 * @param jobName - Name/description of the job
 */
export function createJobFromTemplate(
  template: JobTemplate,
  customParams: Record<string, number> = {},
  jobName: string = ''
): { job: Job; materials: Material[]; estimatedHours: number } {
  const materials = estimateMaterialsFromTemplate(template, customParams);
  const estimatedHours = estimateLaborHours(template, customParams);

  const job: Job = {
    id: generateId(),
    name: jobName || template.name,
    description: template.description,
    template: template.id as any,
    estimatedHours,
    customParams,
  };

  return {
    job,
    materials,
    estimatedHours,
  };
}

/**
 * Update material quantities when parameters change
 * @param materials - Current materials list
 * @param template - The job template
 * @param newParams - Updated parameters
 */
export function updateMaterialQuantities(
  materials: Material[],
  template: JobTemplate,
  newParams: Record<string, number>
): Material[] {
  return materials.map((material, index) => {
    const templateMaterial = template.defaultMaterials[index];

    if (!templateMaterial) {
      return material; // Keep custom materials as-is
    }

    const newQuantity = evaluateFormula(templateMaterial.quantityFormula, newParams);

    return {
      ...material,
      quantity: newQuantity,
      totalPrice: material.manualPriceOverride ? material.totalPrice : newQuantity * material.price,
    };
  });
}
