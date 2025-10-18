import { Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter } from 'events';
import { HoloClientService } from './holo-client.service';

export type InferencePipelineStage = 'resizing' | 'encoding' | 'inference' | 'parsing' | 'complete' | 'error';

export interface InferencePipeline {
  stage: InferencePipelineStage;
  progress: number; // 0-100
  currentStep: string;
  timing: {
    resizeMs?: number;
    inferenceMs?: number;
    parseMs?: number;
    totalMs?: number;
  };
}

export interface RequestDetails {
  systemPrompt?: string;
  userPrompt?: string;
  modelConfig?: Record<string, any>;
  imageInfo?: {
    original: string;
    resized: string;
    scaleFactors: Record<string, number>;
  };
}

export interface ModelResponse {
  rawOutput: string;
  outputLength: number;
  tokenEstimate?: number;
  parseStatus: 'success' | 'error';
  parseError?: string;
}

export interface EnhancedElementMetadata {
  bbox: number[];
  center: number[];
  confidence: number;
  type: string;
  caption: string;
  somNumber?: number;
}

export interface CVMethodActivity {
  method: string;
  active: boolean;
  startTime?: number;
  duration?: number;
  metadata?: Record<string, any>;
  // Enhanced transparency fields
  pipeline?: InferencePipeline;
  request?: RequestDetails;
  response?: ModelResponse;
  elements?: EnhancedElementMetadata[];
}

export interface DetectionHistoryEntry {
  timestamp: Date;
  description: string;
  elementsFound: number;
  primaryMethod: string;
  cached: boolean;
  duration: number;
  elements: Array<{
    id: string;
    semanticDescription?: string;
    confidence: number;
    coordinates: { x: number; y: number };
  }>;
}

export interface ClickHistoryEntry {
  timestamp: Date;
  elementId: string;
  coordinates: { x: number; y: number };
  success: boolean;
  detectionMethod: string;
}

export interface CVDetectionSummary {
  detections: {
    total: number;
    cached: number;
    cacheHitRate: number;
  };
  methods: {
    holo: number; // holo-1.5-7b detections
    ocr: number;
    template: number;
    feature: number;
    contour: number;
  };
  clicks: {
    total: number;
    successful: number;
    failed: number;
    successRate: number;
  };
  recentDetections: DetectionHistoryEntry[];
  recentClicks: ClickHistoryEntry[];
}

export interface CVActivitySnapshot {
  activeMethods: string[];
  totalActiveCount: number;
  methodDetails: Record<string, CVMethodActivity>;
  performance: {
    averageProcessingTime: number;
    totalMethodsExecuted: number;
    successRate: number;
  };
  holoDevice?: string; // Device type for Holo 1.5-7B (cuda, mps, cpu)
  holoModel?: string; // Model name (e.g., "Holo 1.5-7B (Qwen2.5-VL base)")
  holoPerformanceProfile?: string; // Performance profile (SPEED, BALANCED, QUALITY)
  holoQuantization?: string; // Quantization (Q4_K_M, Q8_0)
  holoProcessingTimeMs?: number; // Last processing time in milliseconds
  gpuName?: string; // GPU device name (e.g., "NVIDIA GeForce RTX 4090")
  gpuMemoryTotalMB?: number; // Total GPU memory in MB
  gpuMemoryUsedMB?: number; // Used GPU memory in MB
  gpuMemoryFreeMB?: number; // Free GPU memory in MB
  gpuMemoryUtilizationPercent?: number; // Memory utilization percentage
}

@Injectable()
export class CVActivityIndicatorService extends EventEmitter {
  private readonly logger = new Logger(CVActivityIndicatorService.name);
  private activeMethods = new Map<string, CVMethodActivity>();
  private methodHistory: CVMethodActivity[] = [];
  private readonly maxHistorySize = 100;

  // Detection and click tracking
  private detectionHistory: DetectionHistoryEntry[] = [];
  private clickHistory: ClickHistoryEntry[] = [];
  private readonly maxDetectionHistorySize = 50;
  private readonly maxClickHistorySize = 50;

  constructor(
    @Optional() private readonly holoClient?: HoloClientService,
  ) {
    super();
    this.logger.log('CV Activity Indicator Service initialized');
  }

  /**
   * Start tracking a CV method execution
   */
  startMethod(methodName: string, metadata?: Record<string, any>): string {
    const activityId = `${methodName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const activity: CVMethodActivity = {
      method: methodName,
      active: true,
      startTime: Date.now(),
      metadata: metadata || {}
    };

    this.activeMethods.set(activityId, activity);

    // Emit activity update
    this.emit('methodStarted', {
      id: activityId,
      method: methodName,
      metadata
    });

    this.emit('activityUpdate', this.getSnapshot());

    this.logger.debug(`Started CV method: ${methodName} (${activityId})`);
    return activityId;
  }

  /**
   * Stop tracking a CV method execution
   */
  stopMethod(activityId: string, success: boolean = true, result?: any): void {
    const activity = this.activeMethods.get(activityId);
    if (!activity) {
      this.logger.warn(`Attempted to stop unknown CV method activity: ${activityId}`);
      return;
    }

    const endTime = Date.now();
    const duration = activity.startTime ? endTime - activity.startTime : 0;

    // Update activity
    activity.active = false;
    activity.duration = duration;
    activity.metadata = {
      ...activity.metadata,
      success,
      result,
      endTime
    };

    // Move to history
    this.addToHistory(activity);
    this.activeMethods.delete(activityId);

    // Emit activity update
    this.emit('methodCompleted', {
      id: activityId,
      method: activity.method,
      duration,
      success,
      result
    });

    this.emit('activityUpdate', this.getSnapshot());

    this.logger.debug(`Completed CV method: ${activity.method} in ${duration}ms (success: ${success})`);
  }

  /**
   * Update metadata for an active method
   */
  updateMethodMetadata(activityId: string, metadata: Record<string, any>): void {
    const activity = this.activeMethods.get(activityId);
    if (activity) {
      activity.metadata = { ...activity.metadata, ...metadata };
      this.emit('activityUpdate', this.getSnapshot());
    }
  }

  /**
   * Get current activity snapshot for UI display
   */
  getSnapshot(): CVActivitySnapshot {
    const activeMethodsArray = Array.from(this.activeMethods.values());
    const activeMethods = activeMethodsArray.map(a => a.method);

    // Calculate performance metrics
    const recentHistory = this.methodHistory.slice(-50);
    const totalExecuted = recentHistory.length;
    const successfulExecutions = recentHistory.filter(h => h.metadata?.success === true).length;
    const successRate = totalExecuted > 0 ? successfulExecutions / totalExecuted : 1;

    const averageProcessingTime = recentHistory.length > 0
      ? recentHistory.reduce((sum, h) => sum + (h.duration || 0), 0) / recentHistory.length
      : 0;

    const methodDetails: Record<string, CVMethodActivity> = {};
    this.activeMethods.forEach((activity, id) => {
      methodDetails[id] = activity;
    });

    // Extract Holo 1.5-7B device info from active methods or recent history
    let holoDevice: string | undefined;
    for (const activity of this.activeMethods.values()) {
      if (activity.method === 'holo-1.5-7b' && activity.metadata?.device) {
        holoDevice = activity.metadata.device;
        break;
      }
    }
    // Fallback to recent history if not currently active
    if (!holoDevice) {
      const recentHolo = this.methodHistory
        .slice(-10)
        .reverse()
        .find(h => h.method === 'holo-1.5-7b' && h.metadata?.device);
      if (recentHolo) {
        holoDevice = recentHolo.metadata?.device;
      }
    }

    // Removed noisy debug log - activity is tracked via /cv-activity endpoints instead

    // Get model info if available (Holo 1.5-7B client)
    const modelStatus = this.holoClient?.getModelStatus();
    const holoModel = modelStatus ? "Holo 1.5-7B (Qwen2.5-VL base)" : undefined;

    // Get GPU info if available (Holo 1.5-7B client)
    const gpuInfo = this.holoClient?.getGPUInfo();

    // Get performance profile and quantization from Holo client or recent metadata
    let holoPerformanceProfile: string | undefined;
    let holoQuantization: string | undefined;
    let holoProcessingTimeMs: number | undefined;

    // Check active Holo methods first
    for (const activity of this.activeMethods.values()) {
      if (activity.method === 'holo-1.5-7b') {
        holoPerformanceProfile = activity.metadata?.performance_profile || activity.metadata?.performanceProfile;
        holoQuantization = activity.metadata?.quantization;
        holoProcessingTimeMs = activity.metadata?.processing_time_ms || activity.metadata?.processingTimeMs;
        break;
      }
    }

    // Fallback to recent history
    if (!holoPerformanceProfile || !holoQuantization) {
      const recentHolo = this.methodHistory
        .slice(-10)
        .reverse()
        .find(h => h.method === 'holo-1.5-7b' && h.metadata);
      if (recentHolo) {
        holoPerformanceProfile = holoPerformanceProfile || recentHolo.metadata?.performance_profile || recentHolo.metadata?.performanceProfile || 'BALANCED';
        holoQuantization = holoQuantization || recentHolo.metadata?.quantization || 'Q4_K_M';
        holoProcessingTimeMs = holoProcessingTimeMs || recentHolo.metadata?.processing_time_ms || recentHolo.metadata?.processingTimeMs || recentHolo.duration;
      }
    }

    return {
      activeMethods,
      totalActiveCount: activeMethods.length,
      methodDetails,
      performance: {
        averageProcessingTime,
        totalMethodsExecuted: this.methodHistory.length,
        successRate
      },
      holoDevice,
      holoModel,
      holoPerformanceProfile,
      holoQuantization,
      holoProcessingTimeMs,
      gpuName: gpuInfo?.gpu_name ?? undefined,
      gpuMemoryTotalMB: gpuInfo?.memory_total_mb ?? undefined,
      gpuMemoryUsedMB: gpuInfo?.memory_used_mb ?? undefined,
      gpuMemoryFreeMB: gpuInfo?.memory_free_mb ?? undefined,
      gpuMemoryUtilizationPercent: gpuInfo?.memory_utilization_percent ?? undefined,
    };
  }

  /**
   * Get method execution history for debugging
   */
  getMethodHistory(): CVMethodActivity[] {
    return [...this.methodHistory];
  }

  /**
   * Get performance statistics for specific methods
   */
  getMethodPerformance(methodName?: string): {
    method: string;
    executionCount: number;
    averageTime: number;
    successRate: number;
    lastExecuted?: number;
  }[] {
    const methodStats = new Map<string, {
      executions: CVMethodActivity[];
      lastExecuted: number;
    }>();

    // Group history by method
    this.methodHistory.forEach(activity => {
      if (methodName && activity.method !== methodName) return;

      if (!methodStats.has(activity.method)) {
        methodStats.set(activity.method, {
          executions: [],
          lastExecuted: 0
        });
      }

      const stats = methodStats.get(activity.method)!;
      stats.executions.push(activity);
      stats.lastExecuted = Math.max(stats.lastExecuted, activity.startTime || 0);
    });

    // Calculate statistics
    return Array.from(methodStats.entries()).map(([method, stats]) => {
      const executions = stats.executions;
      const executionCount = executions.length;
      const averageTime = executions.reduce((sum, e) => sum + (e.duration || 0), 0) / executionCount;
      const successfulExecutions = executions.filter(e => e.metadata?.success === true).length;
      const successRate = successfulExecutions / executionCount;

      return {
        method,
        executionCount,
        averageTime,
        successRate,
        lastExecuted: stats.lastExecuted > 0 ? stats.lastExecuted : undefined
      };
    });
  }

  /**
   * Check if any CV methods are currently active
   */
  hasActiveMethods(): boolean {
    return this.activeMethods.size > 0;
  }

  /**
   * Check if a specific method is currently active
   */
  isMethodActive(methodName: string): boolean {
    return Array.from(this.activeMethods.values()).some(a => a.method === methodName);
  }

  /**
   * Clear method history (useful for debugging/testing)
   */
  clearHistory(): void {
    this.methodHistory = [];
    this.logger.debug('CV method history cleared');
  }

  /**
   * Force stop all active methods (cleanup)
   */
  stopAllActiveMethods(): void {
    const activeIds = Array.from(this.activeMethods.keys());
    activeIds.forEach(id => this.stopMethod(id, false));
    this.logger.debug(`Stopped ${activeIds.length} active CV methods`);
  }

  private addToHistory(activity: CVMethodActivity): void {
    this.methodHistory.push({ ...activity });

    // Trim history if it gets too large
    if (this.methodHistory.length > this.maxHistorySize) {
      this.methodHistory = this.methodHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Helper method to wrap CV method execution with automatic tracking
   */
  async executeWithTracking<T>(
    methodName: string,
    operation: () => Promise<T>,
    metadata?: Record<string, any>
  ): Promise<T> {
    const activityId = this.startMethod(methodName, metadata);

    try {
      const result = await operation();
      this.stopMethod(activityId, true, result);
      return result;
    } catch (error) {
      this.stopMethod(activityId, false, { error: error.message });
      throw error;
    }
  }

  /**
   * Synchronous version of executeWithTracking
   */
  executeWithTrackingSync<T>(
    methodName: string,
    operation: () => T,
    metadata?: Record<string, any>
  ): T {
    const activityId = this.startMethod(methodName, metadata);

    try {
      const result = operation();
      this.stopMethod(activityId, true, result);
      return result;
    } catch (error) {
      this.stopMethod(activityId, false, { error: error.message });
      throw error;
    }
  }

  /**
   * Update inference pipeline stage for an active method
   */
  updatePipelineStage(activityId: string, pipeline: InferencePipeline): void {
    const activity = this.activeMethods.get(activityId);
    if (activity) {
      activity.pipeline = pipeline;
      this.emit('activityUpdate', this.getSnapshot());
    }
  }

  /**
   * Record detection request details
   */
  recordDetectionRequest(activityId: string, request: RequestDetails): void {
    const activity = this.activeMethods.get(activityId);
    if (activity) {
      activity.request = request;
      this.emit('activityUpdate', this.getSnapshot());
    }
  }

  /**
   * Record model response and parse status
   */
  recordModelResponse(activityId: string, response: ModelResponse): void {
    const activity = this.activeMethods.get(activityId);
    if (activity) {
      activity.response = response;
      this.emit('activityUpdate', this.getSnapshot());
    }
  }

  /**
   * Record detected elements with enhanced metadata
   */
  recordDetectedElements(activityId: string, elements: EnhancedElementMetadata[]): void {
    const activity = this.activeMethods.get(activityId);
    if (activity) {
      activity.elements = elements;
      this.emit('activityUpdate', this.getSnapshot());
    }
  }

  /**
   * Record a detection event for telemetry
   */
  recordDetection(entry: DetectionHistoryEntry): void {
    this.detectionHistory.unshift(entry);
    if (this.detectionHistory.length > this.maxDetectionHistorySize) {
      this.detectionHistory = this.detectionHistory.slice(0, this.maxDetectionHistorySize);
    }
    this.logger.debug(`Recorded detection: ${entry.description} (${entry.elementsFound} elements, method: ${entry.primaryMethod}, cached: ${entry.cached})`);
  }

  /**
   * Record a click event for telemetry
   */
  recordClick(entry: ClickHistoryEntry): void {
    this.clickHistory.unshift(entry);
    if (this.clickHistory.length > this.maxClickHistorySize) {
      this.clickHistory = this.clickHistory.slice(0, this.maxClickHistorySize);
    }
    this.logger.debug(`Recorded click: element ${entry.elementId} at (${entry.coordinates.x}, ${entry.coordinates.y}), success: ${entry.success}`);
  }

  /**
   * Get comprehensive detection and click summary for telemetry dashboard
   */
  getDetectionSummary(): CVDetectionSummary {
    // Calculate detection stats
    const totalDetections = this.detectionHistory.length;
    const cachedDetections = this.detectionHistory.filter(d => d.cached).length;
    const cacheHitRate = totalDetections > 0 ? cachedDetections / totalDetections : 0;

    // Count methods used
    const methodCounts = {
      holo: 0,
      ocr: 0,
      template: 0,
      feature: 0,
      contour: 0,
    };

    this.detectionHistory.forEach(detection => {
      const method = detection.primaryMethod.toLowerCase();
      if (method.includes('holo-1.5-7b')) {
        methodCounts.holo++;
      } else if (method.includes('ocr')) {
        methodCounts.ocr++;
      } else if (method.includes('template')) {
        methodCounts.template++;
      } else if (method.includes('feature')) {
        methodCounts.feature++;
      } else if (method.includes('contour')) {
        methodCounts.contour++;
      }
    });

    // Calculate click stats
    const totalClicks = this.clickHistory.length;
    const successfulClicks = this.clickHistory.filter(c => c.success).length;
    const failedClicks = totalClicks - successfulClicks;
    const clickSuccessRate = totalClicks > 0 ? successfulClicks / totalClicks : 0;

    return {
      detections: {
        total: totalDetections,
        cached: cachedDetections,
        cacheHitRate,
      },
      methods: methodCounts,
      clicks: {
        total: totalClicks,
        successful: successfulClicks,
        failed: failedClicks,
        successRate: clickSuccessRate,
      },
      recentDetections: this.detectionHistory.slice(0, 20),
      recentClicks: this.clickHistory.slice(0, 20),
    };
  }

  /**
   * Clear detection and click history (for testing/debugging)
   */
  clearDetectionHistory(): void {
    this.detectionHistory = [];
    this.clickHistory = [];
    this.logger.debug('CV detection and click history cleared');
  }
}