import { DetectedElement, DetectionConfig, BoundingBox, ClickTarget } from '../types';
import { OCRDetector } from '../detectors/ocr/ocr-detector';
import { TemplateDetector } from '../detectors/template/template-detector';
import { EdgeDetector } from '../detectors/edge/edge-detector';

export class ElementDetectorService {
  private ocrDetector: OCRDetector;
  private templateDetector: TemplateDetector;
  private edgeDetector: EdgeDetector;

  constructor() {
    this.ocrDetector = new OCRDetector();
    this.templateDetector = new TemplateDetector();
    this.edgeDetector = new EdgeDetector();
  }

  async detectElements(
    screenshotBuffer: Buffer,
    config: DetectionConfig = this.getDefaultConfig()
  ): Promise<DetectedElement[]> {
    // Run detection methods in parallel
    const detectionPromises: Array<Promise<DetectedElement[]>> = [];

    if (config.enableOCR) {
      detectionPromises.push(this.ocrDetector.detect(screenshotBuffer, config.searchRegion));
    }

    if (config.enableTemplateMatching) {
      detectionPromises.push(this.templateDetector.detect(screenshotBuffer, config.searchRegion));
    }

    if (config.enableEdgeDetection) {
      detectionPromises.push(this.edgeDetector.detect(screenshotBuffer, config.searchRegion));
    }

    const detectionResults = await Promise.all(detectionPromises);

    // Merge and deduplicate results
    const allElements = detectionResults.flat();
    const mergedElements = this.mergeOverlappingElements(allElements);
    
    return mergedElements.filter(el => el.confidence >= config.confidenceThreshold);
  }

  async findElementByDescription(
    elements: DetectedElement[],
    description: string
  ): Promise<DetectedElement | null> {
    // Score elements based on description match
    const scoredElements = elements.map(element => ({
      element,
      score: this.calculateDescriptionMatch(element, description)
    }));

    // Sort by score and return best match if above threshold
    scoredElements.sort((a, b) => b.score - a.score);
    
    if (scoredElements.length > 0 && scoredElements[0].score > 0.6) {
      return scoredElements[0].element;
    }

    return null;
  }

  async getClickCoordinates(element: DetectedElement): Promise<ClickTarget> {
    // Calculate optimal click coordinates within element bounds
    const { coordinates } = element;
    
    // For buttons and clickable elements, aim for center
    // For text fields, aim slightly left of center
    // For dropdowns, aim for dropdown arrow if detected
    
    let targetX = coordinates.centerX;
    let targetY = coordinates.centerY;

    // Adjust based on element type
    switch (element.type) {
      case 'input':
        targetX = coordinates.x + (coordinates.width * 0.1); // Left side for text input
        break;
      case 'dropdown':
        targetX = coordinates.x + (coordinates.width * 0.9); // Right side for dropdown arrow
        break;
      default:
        // Use center for buttons, links, etc.
        break;
    }

    // Generate fallback coordinates in case primary target fails
    const fallbackCoordinates = [
      { x: coordinates.centerX, y: coordinates.centerY }, // Center
      { x: coordinates.x + 10, y: coordinates.y + 10 },   // Top-left + margin
      { x: coordinates.x + coordinates.width - 10, y: coordinates.centerY } // Right edge
    ];

    return {
      coordinates: { x: Math.round(targetX), y: Math.round(targetY) },
      confidence: element.confidence,
      method: element.metadata.detectionMethod,
      fallbackCoordinates
    };
  }

  private calculateDescriptionMatch(element: DetectedElement, description: string): number {
    const desc = description.toLowerCase();
    let score = 0;

    // Text similarity
    if (element.text) {
      const elementText = element.text.toLowerCase();
      if (elementText.includes(desc) || desc.includes(elementText)) {
        score += 0.8;
      } else {
        // Fuzzy matching logic here
        score += this.fuzzyMatch(elementText, desc) * 0.6;
      }
    }

    // Element type matching
    if (desc.includes('button') && element.type === 'button') score += 0.3;
    if (desc.includes('field') && element.type === 'input') score += 0.3;
    if (desc.includes('link') && element.type === 'link') score += 0.3;

    // Confidence bonus
    score *= element.confidence;

    return Math.min(score, 1.0);
  }

  private mergeOverlappingElements(elements: DetectedElement[]): DetectedElement[] {
    // Implementation to merge elements that overlap significantly
    // Keep the one with highest confidence
    const merged: DetectedElement[] = [];
    
    for (const element of elements) {
      const overlapping = merged.find(m => this.calculateOverlap(m.coordinates, element.coordinates) > 0.7);
      
      if (overlapping) {
        if (element.confidence > overlapping.confidence) {
          // Replace with higher confidence element
          const index = merged.indexOf(overlapping);
          merged[index] = element;
        }
      } else {
        merged.push(element);
      }
    }

    return merged;
  }

  private calculateOverlap(box1: BoundingBox, box2: BoundingBox): number {
    const xOverlap = Math.max(0, Math.min(box1.x + box1.width, box2.x + box2.width) - Math.max(box1.x, box2.x));
    const yOverlap = Math.max(0, Math.min(box1.y + box1.height, box2.y + box2.height) - Math.max(box1.y, box2.y));
    const overlapArea = xOverlap * yOverlap;
    const totalArea = (box1.width * box1.height) + (box2.width * box2.height) - overlapArea;
    
    return overlapArea / totalArea;
  }

  private fuzzyMatch(text1: string, text2: string): number {
    // Simple implementation - can be enhanced with better fuzzy matching
    const longer = text1.length > text2.length ? text1 : text2;
    const shorter = text1.length > text2.length ? text2 : text1;
    
    if (longer.length === 0) return 1.0;
    
    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  private getDefaultConfig(): DetectionConfig {
    return {
      enableOCR: true,
      enableTemplateMatching: true,
      enableEdgeDetection: true,
      confidenceThreshold: 0.5
    };
  }
}
