/**
 * Set-of-Mark (SOM) text formatter for non-vision models
 *
 * Converts SOM visual annotations (numbered boxes on screenshots) into
 * structured text descriptions that non-vision models can understand.
 *
 * This enables the same element-based workflow for both vision and non-vision models:
 * - Vision models: See numbered boxes [0], [1], [2] on screenshots
 * - Non-vision models: Read numbered element descriptions [0], [1], [2] as text
 */

import { DetectedElement } from '@bytebot/cv';

/**
 * Format SOM element mapping as structured text
 *
 * @param elementMapping - Map of element numbers to element IDs
 * @param elements - Detected elements with full metadata
 * @returns Formatted text description of all numbered elements
 *
 * @example
 * const text = formatSOMAsText(
 *   new Map([[0, 'elem_abc'], [1, 'elem_def']]),
 *   [
 *     { id: 'elem_abc', type: 'button', text: 'Install', confidence: 0.95, ... },
 *     { id: 'elem_def', type: 'button', text: 'Cancel', confidence: 0.92, ... }
 *   ]
 * );
 *
 * // Output:
 * // 📍 Detected Elements (Set-of-Mark):
 * //
 * // [0] Button "Install"
 * //     Type: button | Confidence: 95% | Position: (100, 200)
 * //     Description: Install button for Cline extension
 * //
 * // [1] Button "Cancel"
 * //     Type: button | Confidence: 92% | Position: (300, 200)
 * //     Description: Cancel button for installation dialog
 */
export function formatSOMAsText(
  elementMapping: Map<number, string>,
  elements: DetectedElement[],
): string {
  if (elementMapping.size === 0) {
    return '📍 No elements detected in this screenshot.';
  }

  // Build element lookup by ID for fast access
  const elementById = new Map(elements.map((el) => [el.id, el]));

  const lines: string[] = [];

  // Header
  lines.push('📍 Detected Elements (Set-of-Mark):');
  lines.push('');

  // Format each numbered element
  const sortedEntries = Array.from(elementMapping.entries()).sort((a, b) => a[0] - b[0]);

  for (const [elementNumber, elementId] of sortedEntries) {
    const element = elementById.get(elementId);

    if (!element) {
      // Element not found - this shouldn't happen but handle gracefully
      lines.push(`[${elementNumber}] (Element data unavailable)`);
      lines.push('');
      continue;
    }

    // Element header with number and text/type
    const elementLabel = element.text
      ? `${capitalizeFirst(element.type)} "${element.text}"`
      : `${capitalizeFirst(element.type)}`;

    lines.push(`[${elementNumber}] ${elementLabel}`);

    // Element details on second line
    const confidence = Math.round(element.confidence * 100);
    const position = `(${Math.round(element.coordinates.x)}, ${Math.round(element.coordinates.y)})`;
    const detailsLine = `    Type: ${element.type} | Confidence: ${confidence}% | Position: ${position}`;
    lines.push(detailsLine);

    // Add semantic description if available
    const semanticCaption = element.metadata?.semantic_caption;
    const description = element.description;

    if (semanticCaption) {
      lines.push(`    Description: ${semanticCaption}`);
    } else if (description && description !== element.text) {
      lines.push(`    Description: ${description}`);
    }

    // Add detection method for transparency
    if (element.metadata?.detectionMethod) {
      const method = element.metadata.detectionMethod;
      const methodDisplay = method === 'omniparser' ? '🤖 OmniParser' : method;
      lines.push(`    Method: ${methodDisplay}`);
    }

    lines.push(''); // Blank line between elements
  }

  // Footer with usage hint
  lines.push('💡 To interact with an element, use: computer_click_element({ element_id: "N" })');
  lines.push('   where N is the element number shown above (e.g., "0", "1", "2")');

  return lines.join('\n');
}

/**
 * Generate a compact element summary for inline display
 *
 * @param elementMapping - Map of element numbers to element IDs
 * @param elements - Detected elements
 * @returns Compact one-line summary
 *
 * @example
 * formatSOMSummary(mapping, elements);
 * // "3 elements: [0] Install button, [1] Cancel button, [2] Settings link"
 */
export function formatSOMSummary(
  elementMapping: Map<number, string>,
  elements: DetectedElement[],
): string {
  if (elementMapping.size === 0) {
    return 'No elements detected';
  }

  const elementById = new Map(elements.map((el) => [el.id, el]));
  const sortedEntries = Array.from(elementMapping.entries()).sort((a, b) => a[0] - b[0]);

  const summaries = sortedEntries.slice(0, 3).map(([num, id]) => {
    const el = elementById.get(id);
    if (!el) return `[${num}] Unknown`;

    const label = el.text || el.type;
    return `[${num}] ${label}`;
  });

  const more = elementMapping.size > 3 ? `, +${elementMapping.size - 3} more` : '';
  return `${elementMapping.size} elements: ${summaries.join(', ')}${more}`;
}

/**
 * Capitalize first letter of a string
 *
 * @param str - String to capitalize
 * @returns Capitalized string
 */
function capitalizeFirst(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}
