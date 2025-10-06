/**
 * Generate a unique ID
 * Simple ID generator for React Native without external dependencies
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
