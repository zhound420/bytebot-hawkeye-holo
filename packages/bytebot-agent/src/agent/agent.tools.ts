import {
  computerClickElementTool,
  computerDetectElementsTool,
} from '../tools/computer-vision-tools';

/**
 * Common schema definitions for reuse
 */
const coordinateSchema = {
  type: 'object' as const,
  properties: {
    x: {
      type: 'number' as const,
      description: 'The x-coordinate',
    },
    y: {
      type: 'number' as const,
      description: 'The y-coordinate',
    },
  },
  required: ['x', 'y'],
};

const holdKeysSchema = {
  type: 'array' as const,
  items: { type: 'string' as const },
  description: 'Optional array of keys to hold during the action',
  nullable: true,
};

const buttonSchema = {
  type: 'string' as const,
  enum: ['left', 'right', 'middle'],
  description: 'The mouse button',
};

/**
 * Tool definitions for mouse actions
 */
export const _moveMouseTool = {
  name: 'computer_move_mouse',
  description: 'Moves the mouse cursor to the specified coordinates',
  input_schema: {
    type: 'object' as const,
    properties: {
      coordinates: {
        ...coordinateSchema,
        description: 'Target coordinates for mouse movement',
      },
    },
    required: ['coordinates'],
  },
};

export const _traceMouseTool = {
  name: 'computer_trace_mouse',
  description: 'Moves the mouse cursor along a specified path of coordinates',
  input_schema: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'array' as const,
        items: coordinateSchema,
        description: 'Array of coordinate objects representing the path',
      },
      holdKeys: holdKeysSchema,
    },
    required: ['path'],
  },
};

export const _clickMouseTool = {
  name: 'computer_click_mouse',
  description:
    '⚠️ FALLBACK ONLY (60% accuracy) - Grid-based or Smart Focus clicking. **NON-VISION MODELS: You MUST call computer_detect_elements FIRST before using this tool.** ONLY use after computer_detect_elements + computer_click_element has failed 2+ times. For ALL standard UI elements (buttons, links, fields, icons, menus), you MUST try CV-assisted detection first. This method should ONLY be used for: (1) Custom rendering (canvas/games), (2) Clicking outside standard UI elements, (3) Transient elements that close during detection. **If you cannot see screenshots, use computer_detect_elements to get element coordinates instead of guessing.** Provide either coordinates (from grid calculation) or description (for Smart Focus AI).',
  input_schema: {
    type: 'object' as const,
    properties: {
      coordinates: {
        ...coordinateSchema,
        description:
          'Click coordinates in pixels (Method 2: Grid-Based). Read grid overlay labels and count squares to calculate precise position (e.g., "6 squares right of 500 = 600"). Use when you have exact coordinates or need fast clicking. Omit to use Smart Focus instead.',
        nullable: true,
      },
      description: {
        type: 'string' as const,
        description:
          'Short description of target element (Method 3: Smart Focus). AI computes coordinates from description (e.g., "Submit button"). Use when coordinates are uncertain. Keep it 3–6 words. Can include optional grid hint like "~X=600,Y=420". Omit if providing exact coordinates.',
        minLength: 1,
        nullable: true,
      },
      button: buttonSchema,
      holdKeys: holdKeysSchema,
      clickCount: {
        type: 'integer' as const,
        description: 'Number of clicks to perform (e.g., 2 for double-click)',
        default: 1,
      },
      context: {
        type: 'object' as const,
        description:
          'Optional telemetry context including region bounds, zoom level, target description, and click source.',
        properties: {
          region: {
            type: 'object' as const,
            properties: {
              x: { type: 'number' as const },
              y: { type: 'number' as const },
              width: { type: 'number' as const },
              height: { type: 'number' as const },
            },
            additionalProperties: false,
            nullable: true,
          },
          zoomLevel: {
            type: 'number' as const,
            description: 'Zoom factor used when capturing the region',
            nullable: true,
          },
          targetDescription: {
            type: 'string' as const,
            description: 'Human-readable description of the intended target',
            nullable: true,
          },
          source: {
            type: 'string' as const,
            enum: [
              'manual',
              'smart_focus',
              'progressive_zoom',
              'binary_search',
            ],
            description: 'Origin of the click request for telemetry analysis',
            nullable: true,
          },
        },
      },
    },
    required: ['button', 'clickCount'],
  },
};

export const _pressMouseTool = {
  name: 'computer_press_mouse',
  description: 'Presses or releases a specified mouse button',
  input_schema: {
    type: 'object' as const,
    properties: {
      coordinates: {
        ...coordinateSchema,
        description: 'Optional coordinates (defaults to current position)',
        nullable: true,
      },
      button: buttonSchema,
      press: {
        type: 'string' as const,
        enum: ['up', 'down'],
        description: 'Whether to press down or release up',
      },
    },
    required: ['button', 'press'],
  },
};

export const _dragMouseTool = {
  name: 'computer_drag_mouse',
  description: 'Drags the mouse along a path while holding a button',
  input_schema: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'array' as const,
        items: coordinateSchema,
        description: 'Array of coordinates representing the drag path',
      },
      button: buttonSchema,
      holdKeys: holdKeysSchema,
    },
    required: ['path', 'button'],
  },
};

export const _scrollTool = {
  name: 'computer_scroll',
  description: 'Scrolls the mouse wheel in the specified direction',
  input_schema: {
    type: 'object' as const,
    properties: {
      coordinates: {
        ...coordinateSchema,
        description: 'Coordinates where the scroll should occur',
      },
      direction: {
        type: 'string' as const,
        enum: ['up', 'down', 'left', 'right'],
        description: 'The direction to scroll',
      },
      scrollCount: {
        type: 'integer' as const,
        description: 'Number of scroll steps',
      },
      holdKeys: holdKeysSchema,
    },
    required: ['coordinates', 'direction', 'scrollCount'],
  },
};

/**
 * Tool definitions for keyboard actions
 */
export const _typeKeysTool = {
  name: 'computer_type_keys',
  description:
    'Types a sequence of keys (preferred for navigation and activation via keyboard shortcuts, e.g., Ctrl+L, Tab, Enter).',
  input_schema: {
    type: 'object' as const,
    properties: {
      keys: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'Array of key names to type in sequence',
      },
      delay: {
        type: 'number' as const,
        description: 'Optional delay in milliseconds between key presses',
        nullable: true,
      },
    },
    required: ['keys'],
  },
};

export const _pressKeysTool = {
  name: 'computer_press_keys',
  description:
    'Presses or releases specific keys (useful for holding modifiers)',
  input_schema: {
    type: 'object' as const,
    properties: {
      keys: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'Array of key names to press or release',
      },
      press: {
        type: 'string' as const,
        enum: ['up', 'down'],
        description: 'Whether to press down or release up',
      },
    },
    required: ['keys', 'press'],
  },
};

export const _typeTextTool = {
  name: 'computer_type_text',
  description:
    'Types a string of text character by character. Use this tool for strings less than 25 characters, or passwords/sensitive form fields.',
  input_schema: {
    type: 'object' as const,
    properties: {
      text: {
        type: 'string' as const,
        description: 'The text string to type',
      },
      delay: {
        type: 'number' as const,
        description: 'Optional delay in milliseconds between characters',
        nullable: true,
      },
      isSensitive: {
        type: 'boolean' as const,
        description: 'Flag to indicate sensitive information',
        nullable: true,
      },
    },
    required: ['text'],
  },
};

export const _pasteTextTool = {
  name: 'computer_paste_text',
  description:
    'Copies text to the clipboard and pastes it. Use this tool for typing long text strings or special characters not on the standard keyboard.',
  input_schema: {
    type: 'object' as const,
    properties: {
      text: {
        type: 'string' as const,
        description: 'The text string to type',
      },
      isSensitive: {
        type: 'boolean' as const,
        description: 'Flag to indicate sensitive information',
        nullable: true,
      },
    },
    required: ['text'],
  },
};

/**
 * Tool definitions for utility actions
 */
export const _waitTool = {
  name: 'computer_wait',
  description: 'Pauses execution for a specified duration',
  input_schema: {
    type: 'object' as const,
    properties: {
      duration: {
        type: 'integer' as const,
        enum: [500],
        description: 'The duration to wait in milliseconds',
      },
    },
    required: ['duration'],
  },
};

export const _screenshotTool = {
  name: 'computer_screenshot',
  description: 'Captures a screenshot of the current screen. ⚠️ NON-VISION MODELS: If you cannot see images, DO NOT call this tool repeatedly. Screenshots appear as "[Image content...]" text to you. Instead, use computer_detect_elements to get a TEXT LIST of all UI elements. Taking multiple screenshots will NOT help if you cannot see them - use element detection instead.',
  input_schema: {
    type: 'object' as const,
    properties: {},
  },
};

export const _screenshotRegionTool = {
  name: 'computer_screenshot_region',
  description:
    'Captures a focused screenshot of one of the predefined 3x3 screen regions with an optional finer grid overlay',
  input_schema: {
    type: 'object' as const,
    properties: {
      region: {
        type: 'string' as const,
        enum: [
          'top-left',
          'top-center',
          'top-right',
          'middle-left',
          'middle-center',
          'middle-right',
          'bottom-left',
          'bottom-center',
          'bottom-right',
        ],
        description: 'Named region of the screen to capture',
      },
      gridSize: {
        type: 'integer' as const,
        description: 'Optional grid size in pixels for the focused capture',
        nullable: true,
      },
      enhance: {
        type: 'boolean' as const,
        description: 'Enable image enhancement for better readability',
        nullable: true,
      },
      includeOffset: {
        type: 'boolean' as const,
        description: 'Include global screen offset labels in the grid',
        nullable: true,
      },
    },
    required: ['region'],
  },
};

export const _screenshotCustomRegionTool = {
  name: 'computer_screenshot_custom_region',
  description:
    'Captures a custom rectangular region of the screen and overlays a fine grid with global coordinates',
  input_schema: {
    type: 'object' as const,
    properties: {
      x: {
        type: 'number' as const,
        description: 'Left coordinate of the region',
      },
      y: {
        type: 'number' as const,
        description: 'Top coordinate of the region',
      },
      width: {
        type: 'number' as const,
        description: 'Width of the region in pixels',
      },
      height: {
        type: 'number' as const,
        description: 'Height of the region in pixels',
      },
      gridSize: {
        type: 'integer' as const,
        description: 'Optional grid size in pixels for the custom capture',
        nullable: true,
      },
    },
    required: ['x', 'y', 'width', 'height'],
  },
};

export const _cursorPositionTool = {
  name: 'computer_cursor_position',
  description: 'Gets the current (x, y) coordinates of the mouse cursor',
  input_schema: {
    type: 'object' as const,
    properties: {},
  },
};

export const _screenInfoTool = {
  name: 'computer_screen_info',
  description: 'Returns the current screen width and height in pixels',
  input_schema: {
    type: 'object' as const,
    properties: {},
  },
};

export const _applicationTool = {
  name: 'computer_application',
  description: 'Opens or focuses an application and ensures it is fullscreen',
  input_schema: {
    type: 'object' as const,
    properties: {
      application: {
        type: 'string' as const,
        enum: [
          'firefox',
          '1password',
          'thunderbird',
          'vscode',
          'terminal',
          'desktop',
          'directory',
        ],
        description: 'The application to open or focus',
      },
    },
    required: ['application'],
  },
};

/**
 * Tool definitions for task management
 */
export const _setTaskStatusTool = {
  name: 'set_task_status',
  description: 'Sets the status of the current task',
  input_schema: {
    type: 'object' as const,
    properties: {
      status: {
        type: 'string' as const,
        enum: ['completed', 'needs_help'],
        description: 'The status of the task',
      },
      description: {
        type: 'string' as const,
        description:
          'If the task is completed, a summary of the task. If the task needs help, a description of the issue or clarification needed.',
      },
    },
    required: ['status', 'description'],
  },
};

export const _createTaskTool = {
  name: 'create_task',
  description: 'Creates a new task',
  input_schema: {
    type: 'object' as const,
    properties: {
      description: {
        type: 'string' as const,
        description: 'The description of the task',
      },
      type: {
        type: 'string' as const,
        enum: ['IMMEDIATE', 'SCHEDULED'],
        description: 'The type of the task (defaults to IMMEDIATE)',
      },
      scheduledFor: {
        type: 'string' as const,
        format: 'date-time',
        description: 'RFC 3339 / ISO 8601 datetime for scheduled tasks',
      },
      priority: {
        type: 'string' as const,
        enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'],
        description: 'The priority of the task (defaults to MEDIUM)',
      },
    },
    required: ['description'],
  },
};

/**
 * Tool definition for reading files
 */
export const _readFileTool = {
  name: 'computer_read_file',
  description:
    'Reads a file from the specified path and returns it as a document content block with base64 encoded data',
  input_schema: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string' as const,
        description: 'The file path to read from',
      },
    },
    required: ['path'],
  },
};

export const _writeFileTool = {
  name: 'computer_write_file',
  description:
    'Writes base64 encoded data to the specified file path, creating or overwriting the file as needed',
  input_schema: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string' as const,
        description: 'The file path to write to',
      },
      data: {
        type: 'string' as const,
        description: 'Base64 encoded file contents to write',
      },
    },
    required: ['path', 'data'],
  },
};

/**
 * Export all tools as an array
 *
 * IMPORTANT: CV-first tools are listed first to enforce the preferred workflow.
 * Models should ALWAYS try computer_detect_elements + computer_click_element
 * before falling back to grid-based computer_click_mouse.
 */
export const agentTools = [
  // CV-FIRST TOOLS (Primary clicking method - 89% accuracy)
  computerDetectElementsTool,
  computerClickElementTool,

  // SCREENSHOT TOOLS (Observation)
  _screenshotTool,
  _screenshotRegionTool,
  _screenshotCustomRegionTool,
  _screenInfoTool,

  // MOUSE TOOLS (Navigation and fallback)
  _moveMouseTool,
  _traceMouseTool,
  _clickMouseTool,  // ⚠️ FALLBACK ONLY - Use CV tools first
  _pressMouseTool,
  _dragMouseTool,
  _scrollTool,
  _cursorPositionTool,

  // KEYBOARD TOOLS
  _typeKeysTool,
  _pressKeysTool,
  _typeTextTool,
  _pasteTextTool,

  // APPLICATION MANAGEMENT
  _applicationTool,

  // UTILITY TOOLS
  _waitTool,
  _readFileTool,
  _writeFileTool,

  // TASK MANAGEMENT
  _setTaskStatusTool,
  _createTaskTool,
];

/**
 * Direct Vision Mode tools - excludes CV intermediate tools
 *
 * When directVisionMode is enabled, vision models get only native computer use tools:
 * - screenshot, mouse, keyboard actions
 * - NO computer_detect_elements or computer_click_element
 *
 * This gives models like Claude Opus 4 and GPT-4o direct control via their vision
 * capabilities without Holo 1.5-7B intermediate processing.
 */
export const directVisionModeTools = agentTools.filter(
  (tool) =>
    tool.name !== 'computer_detect_elements' &&
    tool.name !== 'computer_click_element',
);

/**
 * Get tools based on task configuration
 * @param directVisionMode - If true, exclude CV tools (Holo 1.5-7B detection)
 * @returns Filtered tool array
 */
export function getToolsForTask(directVisionMode: boolean = false) {
  return directVisionMode ? directVisionModeTools : agentTools;
}
