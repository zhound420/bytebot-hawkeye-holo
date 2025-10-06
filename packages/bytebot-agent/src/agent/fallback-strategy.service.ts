import { Injectable, Logger } from '@nestjs/common';
import { ModelTier } from '../models/model-capabilities.config';

/**
 * Fallback strategy recommendation
 */
export interface FallbackStrategy {
  method: string;
  description: string;
  priority: number; // 1 = highest, 3 = lowest
  example?: string;
}

/**
 * Fallback Strategy Service
 *
 * Provides intelligent fallback suggestions when primary methods fail
 * Adapts recommendations based on model tier and failure context
 */
@Injectable()
export class FallbackStrategyService {
  private readonly logger = new Logger('FallbackStrategyService');

  /**
   * Get fallback strategies for CV detection failure
   *
   * @param tier - Model capability tier
   * @param failureCount - Number of failed CV attempts
   * @param description - Element description that failed
   * @returns Ordered list of fallback strategies (highest priority first)
   */
  getCVDetectionFallbacks(
    tier: ModelTier,
    failureCount: number,
    description?: string,
  ): FallbackStrategy[] {
    // Tier 1: Strong CV - Suggest refining CV query first
    if (tier === 'tier1') {
      return [
        {
          method: 'Refine CV Query',
          description: 'Try a broader or more specific description',
          priority: 1,
          example: description
            ? `Instead of "${description}", try: "button", "${description.split(' ')[0]}", or use includeAll mode`
            : 'Use computer_detect_elements({ description: "", includeAll: true })',
        },
        {
          method: 'Discovery Mode',
          description: 'List all detectable elements to find alternatives',
          priority: 2,
          example:
            'computer_detect_elements({ description: "", includeAll: true })',
        },
        {
          method: 'Keyboard Shortcuts',
          description: 'Use application-specific shortcuts',
          priority: 3,
          example:
            'Ctrl+P (command palette), Ctrl+F (find), Tab navigation',
        },
      ];
    }

    // Tier 2: Medium CV - Balanced keyboard + CV
    if (tier === 'tier2') {
      if (failureCount >= 2) {
        // After 2 failures, prioritize keyboard
        return [
          {
            method: 'Keyboard Shortcuts',
            description: 'Most reliable fallback for your model tier',
            priority: 1,
            example:
              'Ctrl+P (command palette), Ctrl+F (find), Tab navigation',
          },
          {
            method: 'Discovery Mode',
            description: 'List all detectable elements',
            priority: 2,
            example:
              'computer_detect_elements({ description: "", includeAll: true })',
          },
          {
            method: 'Grid-Based Clicking',
            description: 'Manual coordinate clicking as last resort',
            priority: 3,
            example:
              'computer_click_mouse({ coordinates: {x, y}, description: "..." })',
          },
        ];
      } else {
        // First failure - try refining CV first
        return [
          {
            method: 'Refine CV Query',
            description: 'Try a broader description',
            priority: 1,
            example: 'Try "button" instead of specific button text',
          },
          {
            method: 'Keyboard Shortcuts',
            description: 'Reliable alternative',
            priority: 2,
            example: 'Ctrl+P, Tab navigation, Ctrl+F',
          },
          {
            method: 'Discovery Mode',
            description: 'List all detectable elements',
            priority: 3,
            example:
              'computer_detect_elements({ description: "", includeAll: true })',
          },
        ];
      }
    }

    // Tier 3: Weak CV - Keyboard-first always
    return [
      {
        method: 'Keyboard Shortcuts',
        description:
          'PRIMARY method for your model tier (most reliable)',
        priority: 1,
        example:
          'Ctrl+P (command palette), Ctrl+F (find), Tab/Shift+Tab navigation, Ctrl+L (address bar)',
      },
      {
        method: 'Grid-Based Clicking',
        description: 'Manual coordinate clicking',
        priority: 2,
        example:
          'computer_click_mouse({ coordinates: {x, y}, description: "..." })',
      },
      {
        method: 'Discovery Mode',
        description: 'Try CV in discovery mode (may still fail)',
        priority: 3,
        example:
          'computer_detect_elements({ description: "", includeAll: true })',
      },
    ];
  }

  /**
   * Get fallback strategies for click failure
   *
   * @param tier - Model capability tier
   * @param failureCount - Number of failed click attempts
   * @returns Ordered list of fallback strategies
   */
  getClickFallbacks(
    tier: ModelTier,
    failureCount: number,
  ): FallbackStrategy[] {
    return [
      {
        method: 'Take Fresh Screenshot',
        description: 'UI may have changed - verify current state',
        priority: 1,
        example: 'computer_screenshot()',
      },
      {
        method: 'Keyboard Shortcuts',
        description: 'More reliable than clicking',
        priority: 2,
        example: 'Enter/Space to activate focused element, Tab to navigate',
      },
      {
        method: 'Retry Detection',
        description: 'Element may have moved',
        priority: 3,
        example: 'computer_detect_elements() with updated description',
      },
    ];
  }

  /**
   * Get tier-specific primary method recommendation
   *
   * @param tier - Model capability tier
   * @param context - Interaction context (e.g., "button", "menu", "text field")
   * @returns Recommended primary method
   */
  getPrimaryMethod(tier: ModelTier, context?: string): FallbackStrategy {
    if (tier === 'tier1') {
      return {
        method: 'CV Detection',
        description: 'Your model has strong CV capabilities',
        priority: 1,
        example: context
          ? `computer_detect_elements({ description: "${context}" })`
          : 'computer_detect_elements({ description: "..." })',
      };
    }

    if (tier === 'tier2') {
      return {
        method: 'CV Detection (with keyboard fallback)',
        description: 'Try CV first, keyboard if it fails',
        priority: 1,
        example: context
          ? `computer_detect_elements({ description: "${context}" }) OR keyboard shortcuts`
          : 'CV detection first, then Ctrl+P/Tab/Ctrl+F',
      };
    }

    // Tier 3
    return {
      method: 'Keyboard Shortcuts',
      description: 'Most reliable for your model tier',
      priority: 1,
      example:
        'Ctrl+P (command palette), Tab navigation, Ctrl+F (find), Ctrl+L (address bar)',
    };
  }

  /**
   * Format fallback strategies as text for injection into prompts/messages
   *
   * @param strategies - List of fallback strategies
   * @returns Formatted markdown text
   */
  formatStrategiesAsText(strategies: FallbackStrategy[]): string {
    const lines = ['**Recommended Fallback Strategies:**\n'];

    for (const strategy of strategies) {
      lines.push(
        `${strategy.priority}. **${strategy.method}**: ${strategy.description}`,
      );
      if (strategy.example) {
        lines.push(`   Example: \`${strategy.example}\``);
      }
    }

    return lines.join('\n');
  }

  /**
   * Get keyboard shortcuts for common UI patterns
   *
   * @param pattern - UI pattern (e.g., "menu", "search", "navigate")
   * @returns Relevant keyboard shortcuts
   */
  getKeyboardShortcuts(pattern: string): string[] {
    const shortcuts: Record<string, string[]> = {
      menu: [
        'Alt (show menu bar)',
        'Alt+F (File menu)',
        'Alt+E (Edit menu)',
        'Alt+V (View menu)',
      ],
      search: [
        'Ctrl+F (find in page)',
        'Ctrl+H (find and replace)',
        '/ (search in many apps)',
      ],
      navigate: [
        'Tab (next element)',
        'Shift+Tab (previous element)',
        'Ctrl+Tab (next tab)',
        'Ctrl+Shift+Tab (previous tab)',
      ],
      command: [
        'Ctrl+P (VS Code quick open)',
        'Ctrl+Shift+P (VS Code/Firefox command palette)',
        'Alt+Space (window menu)',
      ],
      browser: [
        'Ctrl+L (address bar)',
        'Ctrl+T (new tab)',
        'Ctrl+W (close tab)',
        'Ctrl+R (reload)',
        'Ctrl+F (find)',
      ],
      vscode: [
        'Ctrl+P (quick open)',
        'Ctrl+Shift+P (command palette)',
        'Ctrl+F (find)',
        'Ctrl+S (save)',
        'Ctrl+B (toggle sidebar)',
      ],
      filemanager: [
        'Ctrl+L (location bar)',
        'Arrows (navigate)',
        'Enter (open)',
        'F2 (rename)',
        'Delete (delete)',
      ],
    };

    const normalizedPattern = pattern.toLowerCase();

    for (const [key, shortcuts] of Object.entries(shortcuts)) {
      if (normalizedPattern.includes(key)) {
        return shortcuts;
      }
    }

    // Default shortcuts
    return [
      'Tab/Shift+Tab (navigate)',
      'Enter/Space (activate)',
      'Ctrl+F (find)',
      'Esc (cancel/close)',
    ];
  }

  /**
   * Suggest alternative approach when stuck
   *
   * @param tier - Model capability tier
   * @param stuckContext - Description of what's stuck (e.g., "can't find Install button")
   * @returns Suggestion text
   */
  suggestAlternativeApproach(
    tier: ModelTier,
    stuckContext: string,
  ): string {
    const shortcuts = this.getKeyboardShortcuts(stuckContext);

    if (tier === 'tier3') {
      return `Your model tier struggles with CV detection. Try keyboard shortcuts instead:

${shortcuts.map((s) => `• ${s}`).join('\n')}

If you're still stuck after trying keyboard shortcuts, request help with:
set_task_status({ status: "needs_help", description: "${stuckContext}" })`;
    }

    if (tier === 'tier2') {
      return `CV detection failed. Try these keyboard shortcuts:

${shortcuts.map((s) => `• ${s}`).join('\n')}

Or use discovery mode to see all elements:
computer_detect_elements({ description: "", includeAll: true })

If still stuck, request help.`;
    }

    // Tier 1
    return `CV detection failed (unusual for your model). Try:

1. Discovery mode: computer_detect_elements({ description: "", includeAll: true })
2. Keyboard shortcuts: ${shortcuts[0]}
3. Different description (broader or more specific)

If the element truly isn't detectable, request help.`;
  }
}
