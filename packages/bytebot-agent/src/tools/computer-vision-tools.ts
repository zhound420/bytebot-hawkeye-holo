import { z } from 'zod';

const regionSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  })
  .describe('Optional region to search within');

export const computerDetectElementsSchema = z
  .object({
    description: z
      .string()
      .describe(
        'Description of the UI element to find (e.g., "Install button", "username field", "Save link"). Can be empty when includeAll is true for discovery mode.',
      ),
    region: regionSchema.optional(),
    includeAll: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'Return all detected elements (discovery mode). When true, description can be empty to get complete UI inventory.',
      ),
  })
  .refine(
    (data) => {
      // Allow empty description ONLY if includeAll is true
      if (data.description.length === 0 && data.includeAll !== true) {
        return false;
      }
      return true;
    },
    {
      message: 'Description required unless includeAll is true',
      path: ['description'],
    },
  );

export type ComputerDetectElementsInput = z.infer<
  typeof computerDetectElementsSchema
>;

const regionJsonSchema = {
  type: 'object' as const,
  properties: {
    x: { type: 'number' as const },
    y: { type: 'number' as const },
    width: { type: 'number' as const },
    height: { type: 'number' as const },
  },
  required: ['x', 'y', 'width', 'height'],
};

const coordinateJsonSchema = {
  type: 'object' as const,
  properties: {
    x: { type: 'number' as const },
    y: { type: 'number' as const },
  },
  required: ['x', 'y'],
};

const computerDetectElementsJsonSchema = {
  type: 'object' as const,
  properties: {
    description: {
      type: 'string' as const,
      description:
        'Description of the UI element to find (e.g., "Install button", "username field", "Save link"). Can be empty when includeAll is true for discovery mode.',
    },
    region: {
      ...regionJsonSchema,
      description: 'Optional region to search within',
    },
    includeAll: {
      type: 'boolean' as const,
      default: false,
      description:
        'Return all detected elements (discovery mode). When true, description can be empty to get complete UI inventory.',
    },
  },
  required: [], // description is optional when includeAll is true
  additionalProperties: false,
};

export const computerDetectElementsTool = {
  name: 'computer_detect_elements',
  description:
    '🎯 **MANDATORY FIRST TOOL FOR NON-VISION MODELS** - If you cannot see screenshots, THIS IS YOUR ONLY WAY to find UI elements. Returns numbered text list: [0] Button, [1] Link, [2] Icon with coordinates. Vision models receive SOM screenshots with numbered boxes. Detects buttons, links, fields, icons, menus using Holo 1.5-7B semantic AI (89% accuracy). **CRITICAL FOR NON-VISION:** Use includeAll:true with empty description FIRST to see ALL elements, then click with computer_click_element using element numbers. DO NOT skip this tool if you cannot see images. ALWAYS use before computer_click_mouse.',
  input_schema: computerDetectElementsJsonSchema,
};

export const computerClickElementSchema = z.object({
  element_id: z
    .string()
    .min(1)
    .describe('ID of the element from detect_elements response. Can also be a visible element number from the SOM-annotated screenshot (e.g., "5", "element 3", "box 12").'),
  fallback_coordinates: z
    .object({
      x: z.number(),
      y: z.number(),
    })
    .optional()
    .describe('Backup coordinates to try if element targeting fails'),
});

export type ComputerClickElementInput = z.infer<
  typeof computerClickElementSchema
>;

const computerClickElementJsonSchema = {
  type: 'object' as const,
  properties: {
    element_id: {
      type: 'string' as const,
      description: 'ID of the element from detect_elements response. Can also be a visible element number from the SOM-annotated screenshot (e.g., "5", "element 3", "box 12").',
    },
    fallback_coordinates: {
      ...coordinateJsonSchema,
      description: 'Backup coordinates to try if element targeting fails',
    },
  },
  required: ['element_id'],
  additionalProperties: false,
};

export const computerClickElementTool = {
  name: 'computer_click_element',
  description:
    '✅ PREFERRED CLICKING METHOD (89% accuracy) - Click a UI element using **SOM element numbers (BEST: 70-85% accuracy)** or element IDs from computer_detect_elements. **PREFERRED: Use visible element numbers** from SOM-annotated screenshots (element_id: "0", "5", "12") **instead of cryptic IDs** (element_id: "holo_abc123"). Uses actual detected element boundaries for precise targeting. This is significantly more reliable than manual grid-based coordinate clicking (60% accuracy). Always pair with computer_detect_elements.',
  input_schema: computerClickElementJsonSchema,
};
