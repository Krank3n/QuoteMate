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
 * Safe math expression evaluator using recursive descent parsing.
 * Supports: +, -, *, /, parentheses, Math.ceil/floor/round, named variables, numeric literals.
 * Replaces unsafe `new Function()` to prevent code injection.
 */
class ExpressionParser {
  private pos = 0;
  private expr: string;
  private params: Record<string, number>;

  constructor(expr: string, params: Record<string, number>) {
    this.expr = expr;
    this.params = params;
  }

  parse(): number {
    const result = this.parseAddSub();
    this.skipWhitespace();
    if (this.pos < this.expr.length) {
      throw new Error(`Unexpected character '${this.expr[this.pos]}' at position ${this.pos}`);
    }
    return result;
  }

  private skipWhitespace(): void {
    while (this.pos < this.expr.length && /\s/.test(this.expr[this.pos])) {
      this.pos++;
    }
  }

  private parseAddSub(): number {
    let left = this.parseMulDiv();
    this.skipWhitespace();
    while (this.pos < this.expr.length && (this.expr[this.pos] === '+' || this.expr[this.pos] === '-')) {
      const op = this.expr[this.pos];
      this.pos++;
      const right = this.parseMulDiv();
      left = op === '+' ? left + right : left - right;
      this.skipWhitespace();
    }
    return left;
  }

  private parseMulDiv(): number {
    let left = this.parseUnary();
    this.skipWhitespace();
    while (this.pos < this.expr.length && (this.expr[this.pos] === '*' || this.expr[this.pos] === '/')) {
      const op = this.expr[this.pos];
      this.pos++;
      const right = this.parseUnary();
      left = op === '*' ? left * right : left / right;
      this.skipWhitespace();
    }
    return left;
  }

  private parseUnary(): number {
    this.skipWhitespace();
    if (this.pos < this.expr.length && this.expr[this.pos] === '-') {
      this.pos++;
      return -this.parsePrimary();
    }
    if (this.pos < this.expr.length && this.expr[this.pos] === '+') {
      this.pos++;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    this.skipWhitespace();

    // Parenthesized expression
    if (this.expr[this.pos] === '(') {
      this.pos++; // skip '('
      const result = this.parseAddSub();
      this.skipWhitespace();
      if (this.expr[this.pos] !== ')') {
        throw new Error(`Expected ')' at position ${this.pos}`);
      }
      this.pos++; // skip ')'
      return result;
    }

    // Number literal
    if (/[0-9.]/.test(this.expr[this.pos])) {
      const start = this.pos;
      while (this.pos < this.expr.length && /[0-9.]/.test(this.expr[this.pos])) {
        this.pos++;
      }
      return parseFloat(this.expr.slice(start, this.pos));
    }

    // Identifier: variable name or Math.ceil/floor/round
    if (/[a-zA-Z_]/.test(this.expr[this.pos])) {
      const start = this.pos;
      while (this.pos < this.expr.length && /[a-zA-Z0-9_.]/.test(this.expr[this.pos])) {
        this.pos++;
      }
      const name = this.expr.slice(start, this.pos);

      // Math functions
      if (name === 'Math.ceil' || name === 'Math.floor' || name === 'Math.round') {
        this.skipWhitespace();
        if (this.expr[this.pos] !== '(') {
          throw new Error(`Expected '(' after ${name}`);
        }
        this.pos++; // skip '('
        const arg = this.parseAddSub();
        this.skipWhitespace();
        if (this.expr[this.pos] !== ')') {
          throw new Error(`Expected ')' after ${name} argument`);
        }
        this.pos++; // skip ')'
        if (name === 'Math.ceil') return Math.ceil(arg);
        if (name === 'Math.floor') return Math.floor(arg);
        return Math.round(arg);
      }

      // Variable lookup
      if (name in this.params) {
        return this.params[name];
      }

      throw new Error(`Unknown variable '${name}'`);
    }

    throw new Error(`Unexpected character '${this.expr[this.pos] || 'EOF'}' at position ${this.pos}`);
  }
}

/**
 * Safely evaluate a formula with given parameters
 * @param formula - The formula string (e.g., "steps * 2")
 * @param params - The parameters object (e.g., { steps: 15 })
 */
function evaluateFormula(formula: string, params: Record<string, number>): number {
  try {
    const parser = new ExpressionParser(formula, params);
    const result = parser.parse();
    // Round to 2 decimal places
    return Math.round(result * 100) / 100;
  } catch (error) {
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
