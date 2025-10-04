/**
 * Semantic mapping between visual captions (what Holo 1.5-7B sees)
 * and functional names (what users call elements)
 *
 * This bridges the gap between Holo 1.5-7B's visual understanding
 * and user's functional intent.
 */

export interface SemanticMapping {
  visualPatterns: string[];  // Patterns to match in Holo 1.5-7B captions
  functionalNames: string[]; // What users actually call this element
  applications?: string[];   // Specific to certain apps (optional)
}

/**
 * Universal semantic mappings across all applications
 */
export const UNIVERSAL_SEMANTIC_MAPPINGS: SemanticMapping[] = [
  // Extensions/Plugins/Addons
  {
    visualPatterns: ['puzzle', 'puzzle piece', 'jigsaw'],
    functionalNames: ['extensions', 'extension', 'addons', 'addon', 'plugins', 'plugin', 'modules', 'module'],
  },

  // Settings/Preferences
  {
    visualPatterns: ['gear', 'cog', 'cogwheel', 'settings icon'],
    functionalNames: ['settings', 'setting', 'preferences', 'preference', 'options', 'option', 'configuration', 'config'],
  },

  // Search/Find
  {
    visualPatterns: ['magnifying glass', 'magnifier', 'search icon'],
    functionalNames: ['search', 'find', 'lookup', 'locate', 'query'],
  },

  // Files/Explorer
  {
    visualPatterns: ['folder', 'folder icon', 'directory'],
    functionalNames: ['files', 'file', 'explorer', 'browser', 'navigator', 'tree', 'workspace'],
  },

  // Menu/Navigation
  {
    visualPatterns: ['hamburger', 'hamburger menu', 'three lines'],
    functionalNames: ['menu', 'navigation', 'nav', 'sidebar'],
  },

  // Close/Exit
  {
    visualPatterns: ['x', 'cross', 'close icon'],
    functionalNames: ['close', 'exit', 'dismiss', 'cancel'],
  },

  // Debug/Run
  {
    visualPatterns: ['play', 'play button', 'triangle'],
    functionalNames: ['run', 'start', 'execute', 'debug', 'launch'],
  },

  // Terminal/Console
  {
    visualPatterns: ['terminal', 'console', 'command line'],
    functionalNames: ['terminal', 'console', 'shell', 'command', 'cli'],
  },

  // Git/Source Control
  {
    visualPatterns: ['branch', 'git', 'source control'],
    functionalNames: ['git', 'source control', 'version control', 'scm', 'repository'],
  },

  // Notifications
  {
    visualPatterns: ['bell', 'notification', 'alert'],
    functionalNames: ['notifications', 'notification', 'alerts', 'alert', 'messages'],
  },
];

/**
 * Application-specific semantic mappings
 */
export const APP_SPECIFIC_MAPPINGS: Record<string, SemanticMapping[]> = {
  vscode: [
    {
      visualPatterns: ['puzzle', 'puzzle piece'],
      functionalNames: ['extensions', 'marketplace'],
    },
    {
      visualPatterns: ['folder', 'folder tree'],
      functionalNames: ['explorer', 'files'],
    },
    {
      visualPatterns: ['magnifying glass'],
      functionalNames: ['search', 'find in files'],
    },
  ],

  chrome: [
    {
      visualPatterns: ['puzzle', 'puzzle piece'],
      functionalNames: ['extensions', 'chrome extensions'],
    },
    {
      visualPatterns: ['three dots', 'menu'],
      functionalNames: ['menu', 'more options', 'chrome menu'],
    },
  ],

  firefox: [
    {
      visualPatterns: ['puzzle', 'puzzle piece'],
      functionalNames: ['addons', 'add-ons', 'extensions'],
    },
  ],
};

/**
 * Expand a user's functional query with visual synonyms
 *
 * Example:
 * Input: "extensions icon"
 * Output: ["extensions", "icon", "puzzle", "puzzle piece", "addons", "plugins"]
 */
export function expandFunctionalQuery(
  query: string,
  applicationContext: string = 'desktop'
): string[] {
  const queryLower = query.toLowerCase();
  const expansions = new Set<string>();

  // Add original query words
  const words = queryLower.split(/\s+/).filter(w => w.length > 2);
  words.forEach(w => expansions.add(w));

  // Check universal mappings
  for (const mapping of UNIVERSAL_SEMANTIC_MAPPINGS) {
    // If query contains any functional name, add visual patterns
    const functionalMatch = mapping.functionalNames.some(name =>
      queryLower.includes(name)
    );
    if (functionalMatch) {
      mapping.visualPatterns.forEach(pattern => expansions.add(pattern));
      mapping.functionalNames.forEach(name => expansions.add(name));
    }

    // If query contains any visual pattern, add functional names
    const visualMatch = mapping.visualPatterns.some(pattern =>
      queryLower.includes(pattern)
    );
    if (visualMatch) {
      mapping.functionalNames.forEach(name => expansions.add(name));
      mapping.visualPatterns.forEach(pattern => expansions.add(pattern));
    }
  }

  // Check app-specific mappings
  const appMappings = APP_SPECIFIC_MAPPINGS[applicationContext.toLowerCase()] || [];
  for (const mapping of appMappings) {
    const functionalMatch = mapping.functionalNames.some(name =>
      queryLower.includes(name)
    );
    if (functionalMatch) {
      mapping.visualPatterns.forEach(pattern => expansions.add(pattern));
      mapping.functionalNames.forEach(name => expansions.add(name));
    }

    const visualMatch = mapping.visualPatterns.some(pattern =>
      queryLower.includes(pattern)
    );
    if (visualMatch) {
      mapping.functionalNames.forEach(name => expansions.add(name));
      mapping.visualPatterns.forEach(pattern => expansions.add(pattern));
    }
  }

  return Array.from(expansions);
}

/**
 * Score how well a Holo 1.5-7B caption matches a user query
 * Takes into account both visual and functional synonyms
 * Weights functional terms 2x higher than visual terms for better matching
 *
 * @param omniparserCaption - Caption from Holo 1.5-7B (param name kept for backward compat)
 */
export function scoreSemanticMatch(
  omniparserCaption: string,  // Note: param name kept for backward compatibility
  userQuery: string,
  applicationContext: string = 'desktop',
  options: { weightFunctionalTerms?: number } = {}
): number {
  const captionLower = omniparserCaption.toLowerCase();
  const queryLower = userQuery.toLowerCase();
  const expandedQuery = expandFunctionalQuery(userQuery, applicationContext);

  // Extract original query terms (functional) vs expanded visual terms
  const originalQueryTerms = queryLower.split(/\s+/).filter(w => w.length > 2);
  const functionalWeight = options.weightFunctionalTerms ?? 2.0;

  let matchCount = 0;
  let totalWeight = 0;

  for (const term of expandedQuery) {
    // Determine if this is a functional term (from original query) or visual term (from expansion)
    const isFunctionalTerm = originalQueryTerms.some(qt =>
      qt.includes(term) || term.includes(qt)
    );

    // Weight functional terms higher than visual terms
    let weight = 1.0;
    if (isFunctionalTerm) {
      weight = functionalWeight; // Default 2.0x for functional terms
    } else if (term.length > 5) {
      weight = 1.5; // Longer visual terms are more specific
    }

    totalWeight += weight;

    if (captionLower.includes(term)) {
      matchCount += weight;
    }
  }

  return totalWeight > 0 ? matchCount / totalWeight : 0;
}
