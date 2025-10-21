import { Injectable, Logger, Optional } from '@nestjs/common';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as sharp from 'sharp';
import { NutService } from '../nut/nut.service';
import { GridOverlayService } from '../nut/grid-overlay.service';
import { ScreenshotAnnotator } from '../nut/screenshot-annotator';
import { FocusRegionService } from '../nut/focus-region.service';
import { ProgressBroadcaster } from '../progress/progress-broadcaster';
import { FOCUS_CONFIG } from '../config/focus-config';
import { TelemetryService } from '../telemetry/telemetry.service';
import { HoloClientService } from '@bytebot/cv';
import { isWindows, isLinux, isMacOS } from '../utils/platform';
import {
  ComputerAction,
  MoveMouseAction,
  TraceMouseAction,
  ClickContext,
  ClickMouseAction,
  PressMouseAction,
  DragMouseAction,
  ScrollAction,
  TypeKeysAction,
  PressKeysAction,
  TypeTextAction,
  ApplicationAction,
  Application,
  PasteTextAction,
  WriteFileAction,
  ReadFileAction,
  ScreenshotAction,
  ScreenshotRegionAction,
  ScreenshotCustomRegionAction,
} from '@bytebot/shared';

type ElementDetectionParams = {
  description?: string;
  region?: { x: number; y: number; width: number; height: number };
  includeAll?: boolean;
};

@Injectable()
export class ComputerUseService {
  private readonly logger = new Logger(ComputerUseService.name);
  private readonly calibrationWindow = Number.parseInt(
    process.env.BYTEBOT_CALIBRATION_WINDOW ?? '200',
    10,
  );
  private readonly calibrationDelayMs = Number.parseInt(
    process.env.BYTEBOT_CALIBRATION_DELAY ?? '75',
    10,
  );

  constructor(
    private readonly nutService: NutService,
    private readonly gridOverlayService: GridOverlayService,
    private readonly focusRegion: FocusRegionService,
    private readonly progressBroadcaster: ProgressBroadcaster,
    private readonly telemetryService: TelemetryService,
    @Optional() private readonly holoClient?: HoloClientService,
  ) {
    // Check Holo 1.5-7B availability on startup
    if (this.holoClient) {
      this.holoClient.isAvailable().then((available) => {
        if (available) {
          this.logger.log('✓ Holo 1.5-7B integration enabled');
        } else {
          this.logger.warn('⚠ Holo 1.5-7B client registered but service unavailable');
        }
      });
    } else {
      this.logger.log('Holo 1.5-7B integration disabled (BYTEBOT_CV_USE_HOLO=false or service not available)');
    }
  }

  // Heuristics and verification toggles
  private readonly preClickSnapEnabled =
    process.env.BYTEBOT_PRECLICK_SNAP !== 'false';
  private readonly snapRadius = Number.parseInt(
    process.env.BYTEBOT_SNAP_RADIUS ?? '6',
    10,
  );
  private readonly snapPenalty = Number.parseFloat(
    process.env.BYTEBOT_SNAP_PENALTY ?? '0.25',
  );
  private readonly snapMinImprovement = Number.parseFloat(
    process.env.BYTEBOT_SNAP_MIN_IMPROVEMENT ?? '30',
  );
  private readonly snapMaxShift = Number.parseInt(
    process.env.BYTEBOT_SNAP_MAX_SHIFT ?? '4',
    10,
  );
  private readonly clickVerifyEnabled =
    process.env.BYTEBOT_CLICK_RETRY_ON_NOCHANGE === 'true';
  private readonly clickVerifyDelayMs = Number.parseInt(
    process.env.BYTEBOT_CLICK_VERIFY_DELAY ?? '250',
    10,
  );
  private readonly clickVerifyRadius = Number.parseInt(
    process.env.BYTEBOT_CLICK_VERIFY_RADIUS ?? '12',
    10,
  );
  private readonly clickVerifyThreshold = Number.parseFloat(
    process.env.BYTEBOT_CLICK_VERIFY_THRESHOLD ?? '4.0',
  );
  private readonly clickRetryMax = Number.parseInt(
    process.env.BYTEBOT_CLICK_RETRY_MAX ?? '1',
    10,
  );
  private readonly hoverProbeEnabled =
    process.env.BYTEBOT_HOVER_PROBE !== 'false';
  private readonly hoverProbeOffset = Number.parseInt(
    process.env.BYTEBOT_HOVER_PROBE_OFFSET ?? '2',
    10,
  );
  private readonly hoverProbeThreshold = Number.parseFloat(
    process.env.BYTEBOT_HOVER_PROBE_THRESHOLD ?? '1.5',
  );
  private readonly smartClickSuccessRadius = (() => {
    const raw = Number.parseFloat(
      process.env.BYTEBOT_SMART_CLICK_SUCCESS_RADIUS ?? '12',
    );
    return Number.isFinite(raw) ? raw : 12;
  })();

  async detectElements(
    params: ElementDetectionParams,
  ): Promise<{
    action: 'element_detection';
    screenshot_path: string;
    params: ElementDetectionParams;
    elements?: any[];
  }> {
    this.logger.log('Preparing element detection request');

    const buffer = await this.nutService.screendump();
    const screenshotPath = await this.saveDetectionScreenshot(buffer);

    let elements: any[] | undefined;

    // Call Holo 1.5-7B if available
    if (this.holoClient) {
      try {
        const isAvailable = await this.holoClient.isAvailable();
        if (isAvailable) {
          this.logger.log('Calling Holo 1.5-7B for element detection...');
          const result = await this.holoClient.parseScreenshot(buffer);
          const universalElements = this.holoClient.convertToUniversalElements(result.elements);
          elements = universalElements;
          this.logger.log(`Holo 1.5-7B detected ${elements?.length || 0} elements`);
        } else {
          this.logger.warn('Holo 1.5-7B service unavailable, skipping element detection');
        }
      } catch (error) {
        this.logger.error(`Holo 1.5-7B detection failed: ${error.message}`, error.stack);
        // Continue without elements - agent can still work with screenshot
      }
    }

    return {
      action: 'element_detection',
      screenshot_path: screenshotPath,
      params,
      elements,
    };
  }

  async action(params: ComputerAction): Promise<any> {
    this.logger.log(`Executing computer action: ${params.action}`);

    switch (params.action) {
      case 'screen_info': {
        return this.screen_info();
      }
      case 'move_mouse': {
        await this.moveMouse(params);
        break;
      }
      case 'trace_mouse': {
        await this.traceMouse(params);
        break;
      }
      case 'click_mouse': {
        return this.clickMouse(params);
      }
      case 'press_mouse': {
        await this.pressMouse(params);
        break;
      }
      case 'drag_mouse': {
        await this.dragMouse(params);
        break;
      }

      case 'scroll': {
        await this.scroll(params);
        break;
      }
      case 'type_keys': {
        await this.typeKeys(params);
        break;
      }
      case 'press_keys': {
        await this.pressKeys(params);
        break;
      }
      case 'type_text': {
        await this.typeText(params);
        break;
      }
      case 'paste_text': {
        await this.pasteText(params);
        break;
      }
      case 'wait': {
        const waitParams = params;
        await this.delay(waitParams.duration);
        break;
      }
      case 'screenshot':
        return this.screenshot(params as ScreenshotAction);

      case 'screenshot_region': {
        return this.screenshotRegion(params as ScreenshotRegionAction);
      }

      case 'screenshot_custom_region': {
        const action = params as ScreenshotCustomRegionAction;
        const { x, y, width, height, gridSize } = action;
        const customRegion = await this.focusRegion.captureCustomRegion(
          x,
          y,
          width,
          height,
          gridSize ?? FOCUS_CONFIG.FOCUSED_GRID_SIZE,
          action.zoomLevel ?? FOCUS_CONFIG.CUSTOM_REGION_ZOOM_LEVEL,
        );

        let buffer = customRegion.image;
        const annotator = await ScreenshotAnnotator.from(buffer);
        const dimensions = annotator.dimensions;

        const shouldShowCursor = action.showCursor ?? true;
        let cursorLocal: { x: number; y: number } | undefined;

        if (shouldShowCursor) {
          try {
            const cursor = await this.nutService.getCursorPosition();
            cursorLocal = this.mapCursorToRegion(
              cursor,
              customRegion.offset,
              {
                width: customRegion.region.width,
                height: customRegion.region.height,
              },
              customRegion.zoomLevel ?? 1,
            );
          } catch (error) {
            this.logger.warn(
              `Failed to fetch cursor position for custom region screenshot: ${(error as Error).message}`,
            );
          }
        }

        // If a markTarget is provided, map global → local (respecting zoom) and draw crosshair
        if (action.markTarget?.coordinates) {
          try {
            const localX = Math.round(
              (action.markTarget.coordinates.x - customRegion.offset.x) *
                (customRegion.zoomLevel || 1),
            );
            const localY = Math.round(
              (action.markTarget.coordinates.y - customRegion.offset.y) *
                (customRegion.zoomLevel || 1),
            );

            const progressOverlay =
              this.gridOverlayService.createProgressOverlay(
                dimensions.width,
                dimensions.height,
                action.progressStep ?? 0,
                {
                  message:
                    action.progressMessage ??
                    `Target @ (${action.markTarget.coordinates.x}, ${action.markTarget.coordinates.y})`,
                },
              );

            if (progressOverlay) {
              annotator.addOverlay(progressOverlay);
            }

            const targetOverlay = this.gridOverlayService.createCursorOverlay(
              dimensions.width,
              dimensions.height,
              { x: localX, y: localY },
            );

            if (targetOverlay) {
              annotator.addOverlay(targetOverlay);
            }
          } catch (err) {
            this.logger.warn(
              `Failed to annotate custom region with target: ${
                (err as Error).message
              }`,
            );
          }
        }

        if (cursorLocal) {
          try {
            const cursorOverlay = this.gridOverlayService.createCursorOverlay(
              dimensions.width,
              dimensions.height,
              cursorLocal,
            );

            if (cursorOverlay) {
              annotator.addOverlay(cursorOverlay);
            }
          } catch (error) {
            this.logger.warn(
              `Failed to annotate cursor on custom region screenshot: ${(error as Error).message}`,
            );
          }
        }

        const rendered = await annotator.render();
        buffer = rendered.buffer;
        await this.persistScreenshot(buffer, 'screenshot_custom_region');
        const base64 = buffer.toString('base64');

        if (action.progressTaskId) {
          this.progressBroadcaster.broadcastStep({
            taskId: action.progressTaskId,
            step: action.progressStep ?? 0,
            description:
              action.progressMessage ?? 'Custom region captured (verification)',
            screenshot: base64,
            coordinates: action.markTarget?.coordinates,
          });
        }

        // Record progressive zoom event
        await this.recordActionEvent('screenshot_custom_region');
        return {
          image: base64,
          offset: customRegion.offset,
          region: customRegion.region,
          zoomLevel: customRegion.zoomLevel,
        };
      }

      case 'cursor_position':
        return this.cursor_position();

      case 'application': {
        await this.application(params);
        break;
      }

      case 'write_file': {
        return this.writeFile(params);
      }

      case 'read_file': {
        return this.readFile(params);
      }

      default:
        throw new Error(
          `Unsupported computer action: ${(params as any).action}`,
        );
    }
  }

  private async moveMouse(action: MoveMouseAction): Promise<void> {
    await this.nutService.mouseMoveEvent(action.coordinates);
    await this.recordActionEvent('move_mouse');
  }

  private async traceMouse(action: TraceMouseAction): Promise<void> {
    const { path, holdKeys } = action;

    // Move to the first coordinate
    await this.nutService.mouseMoveEvent(path[0]);

    // Hold keys if provided
    if (holdKeys) {
      await this.nutService.holdKeys(holdKeys, true);
    }

    // Move to each coordinate in the path
    for (const coordinates of path) {
      await this.nutService.mouseMoveEvent(coordinates);
    }

    // Release hold keys
    if (holdKeys) {
      await this.nutService.holdKeys(holdKeys, false);
    }
  }

  private async clickMouse(
    action: ClickMouseAction,
  ): Promise<{ actual: { x: number; y: number }; success: boolean }> {
    const { coordinates, button, holdKeys, clickCount, context, description } =
      action;

    const targetCoordinates = coordinates
      ? { x: coordinates.x, y: coordinates.y }
      : undefined;

    let adjustedCoordinates = targetCoordinates;
    if (
      targetCoordinates &&
      this.telemetryService.isDriftCompensationEnabled()
    ) {
      const drift = await this.telemetryService.getCurrentDrift();
      if (drift.x !== 0 || drift.y !== 0) {
        adjustedCoordinates = {
          x: Math.round(targetCoordinates.x - drift.x),
          y: Math.round(targetCoordinates.y - drift.y),
        };
        this.logger.debug(
          `Applying drift compensation (${drift.x.toFixed(2)}, ${drift.y.toFixed(2)}) → adjusted target (${adjustedCoordinates.x}, ${adjustedCoordinates.y})`,
        );
      }
    }

    let destination = adjustedCoordinates ?? targetCoordinates;

    // If a region context is provided, clamp destination inside it to avoid stray clicks
    if (destination && (action as any).context?.region) {
      const r = (action as any).context.region as {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      const clampedX = Math.max(
        r.x,
        Math.min(destination.x, r.x + r.width - 1),
      );
      const clampedY = Math.max(
        r.y,
        Math.min(destination.y, r.y + r.height - 1),
      );
      if (clampedX !== destination.x || clampedY !== destination.y) {
        this.logger.debug(
          `Clamped click target (${destination.x}, ${destination.y}) to region [${r.x},${r.y},${r.width}x${r.height}] → (${clampedX}, ${clampedY})`,
        );
        destination = { x: clampedX, y: clampedY };
      }
    }

    // Optional: refine destination to nearest high-contrast feature within a small radius
    if (destination && this.preClickSnapEnabled) {
      try {
        const refined = await this.refineClickTarget(destination);
        if (
          refined &&
          (refined.x !== destination.x || refined.y !== destination.y)
        ) {
          this.logger.debug(
            `Pre-click snap adjusted target (${destination.x}, ${destination.y}) → (${refined.x}, ${refined.y})`,
          );
          destination = refined;
        }
      } catch (e) {
        this.logger.warn(
          `Pre-click snap failed: ${(e as Error).message ?? String(e)}`,
        );
      }
    }

    if (destination) {
      await this.nutService.mouseMoveEvent(destination);
    }

    if (holdKeys) {
      await this.nutService.holdKeys(holdKeys, true);
    }

    // Optionally capture a small ROI before clicking to detect UI changes
    let preClickROI: { data: Buffer; width: number; height: number } | null =
      null;
    let roiCenter: { x: number; y: number } | null = null;
    if (this.clickVerifyEnabled) {
      try {
        roiCenter = destination ?? (await this.nutService.getCursorPosition());
        preClickROI = await this.captureRoiGray(
          roiCenter,
          this.clickVerifyRadius,
        );
      } catch (e) {
        this.logger.warn(
          `Failed to capture pre-click ROI: ${(e as Error)?.message ?? String(e)}`,
        );
      }
    }

    // Hover-probe before clicking: sample ROI at current and slight offset
    if (this.hoverProbeEnabled) {
      try {
        const center =
          destination ?? (await this.nutService.getCursorPosition());
        const roiA = await this.captureRoiGray(center, 15);
        const offsetPt = { x: center.x + this.hoverProbeOffset, y: center.y };
        await this.nutService.mouseMoveEvent(offsetPt);
        const roiB = await this.captureRoiGray(offsetPt, 15);
        // move back to center
        await this.nutService.mouseMoveEvent(center);
        const hoverDiff = this.meanAbsoluteDifference(roiA, roiB);
        this.logger.debug(
          `Hover probe diff: ${hoverDiff.toFixed(2)} (thr ${this.hoverProbeThreshold})`,
        );
        await this.telemetryService.recordEvent('hover_probe', {
          diff: hoverDiff,
        });
        // Note: we currently log this as a signal. Future: adjust destination if diff is too low and intent suggests hoverable.
      } catch (e) {
        this.logger.warn(`Hover probe failed: ${(e as Error).message}`);
      }
    }

    if (clickCount > 1) {
      for (let i = 0; i < clickCount; i++) {
        await this.nutService.mouseClickEvent(button);
        await this.delay(150);
      }
    } else {
      await this.nutService.mouseClickEvent(button);
    }

    if (holdKeys) {
      await this.nutService.holdKeys(holdKeys, false);
    }

    await this.delay(this.calibrationDelayMs);
    const actualPointer = await this.nutService.getCursorPosition();

    const clickTaskId = context?.clickTaskId;

    const telemetryContext: ClickContext = {
      region: context?.region,
      zoomLevel: context?.zoomLevel,
      targetDescription: context?.targetDescription ?? description,
      source: context?.source ?? 'manual',
      clickTaskId,
    };

    const finalTarget = destination ?? targetCoordinates;
    let success = true;
    if (finalTarget) {
      const deltaToTarget = {
        x: actualPointer.x - finalTarget.x,
        y: actualPointer.y - finalTarget.y,
      };
      const distance = Math.hypot(deltaToTarget.x, deltaToTarget.y);
      success = distance <= this.smartClickSuccessRadius;
      await this.telemetryService.recordEvent('smart_click_complete', {
        success,
        distance,
        delta: deltaToTarget,
        target: targetCoordinates ?? finalTarget,
        adjusted: destination ?? undefined,
        actual: actualPointer,
        clickTaskId,
      });
    }

    if (targetCoordinates) {
      await this.telemetryService.recordClick(
        targetCoordinates,
        actualPointer,
        telemetryContext,
        destination,
      );

      if (this.telemetryService.isCalibrationEnabled()) {
        const snapshot = await this.captureCalibrationSnapshot(actualPointer);
        if (snapshot) {
          await this.telemetryService.storeCalibrationSnapshot(snapshot, {
            target: targetCoordinates,
            actual: actualPointer,
            context: telemetryContext,
          });
        }
      }
    } else {
      // Record untargeted click for visibility
      await this.telemetryService.recordUntargetedClick(
        actualPointer,
        telemetryContext,
      );
    }

    // Post-click verification: compare pre/post ROI and retry once if unchanged
    if (this.clickVerifyEnabled && preClickROI && roiCenter) {
      try {
        // Delay a bit more to let UI settle
        await this.delay(this.clickVerifyDelayMs);
        const postROI = await this.captureRoiGray(
          roiCenter,
          this.clickVerifyRadius,
        );
        const diff = this.meanAbsoluteDifference(preClickROI, postROI);
        this.logger.debug(
          `Post-click ROI mean abs diff: ${diff.toFixed(2)} (threshold ${this.clickVerifyThreshold})`,
        );
        await this.telemetryService.recordEvent('post_click_diff', { diff });
        if (diff < this.clickVerifyThreshold && this.clickRetryMax > 0) {
          const hasTargetMeta =
            !!targetCoordinates || !!telemetryContext.targetDescription;
          if (hasTargetMeta) {
            this.logger.warn(
              `Minimal UI change detected near (${roiCenter.x}, ${roiCenter.y}); retrying click with slight offsets…`,
            );
            const intent = this.inferIntent(
              telemetryContext.targetDescription ?? description,
            );
            const offsets = this.getRetryOffsetsForIntent(intent);
            const attempts = Math.min(this.clickRetryMax, offsets.length);
            await this.telemetryService.recordEvent('retry_click', {
              attempts,
              intent,
            });
            for (let i = 0; i < attempts; i++) {
              const o = offsets[i];
              const nx = roiCenter.x + o.dx;
              const ny = roiCenter.y + o.dy;
              try {
                await this.nutService.mouseMoveEvent({ x: nx, y: ny });
                await this.nutService.mouseClickEvent(button);
              } catch (re) {
                this.logger.warn(
                  `Offset retry click failed: ${(re as Error).message}`,
                );
              }
            }
          } else {
            this.logger.warn(
              `Minimal UI change near (${roiCenter.x}, ${roiCenter.y}); performing one re-click without offsets (no target metadata).`,
            );
            try {
              await this.nutService.mouseClickEvent(button);
              await this.telemetryService.recordEvent('retry_click', {
                attempts: 1,
                intent: 'unknown',
              });
            } catch (re) {
              this.logger.warn(
                `Simple retry click failed: ${(re as Error).message}`,
              );
            }
          }
        }
      } catch (e) {
        this.logger.warn(
          `Click verification failed: ${(e as Error).message ?? String(e)}`,
        );
      }
    }

    return { actual: actualPointer, success };
  }

  // Record non-click actions for panel visibility
  private async recordActionEvent(name: string): Promise<void> {
    await this.telemetryService.recordEvent('action', { name });
  }

  private inferIntent(
    desc?: string,
  ): 'button' | 'link' | 'field' | 'icon' | 'menu' | 'unknown' {
    const d = (desc || '').toLowerCase();
    if (/button|cta|submit|ok|apply|save/.test(d)) return 'button';
    if (/link|anchor|hyperlink/.test(d)) return 'link';
    if (/field|input|textbox|search|address|email|password/.test(d))
      return 'field';
    if (/icon|favicon|glyph|checkbox|radio/.test(d)) return 'icon';
    if (/menu|dropdown|toolbar|tab/.test(d)) return 'menu';
    return 'unknown';
  }

  private getRetryOffsetsForIntent(
    intent: string,
  ): Array<{ dx: number; dy: number }> {
    switch (intent) {
      case 'icon':
        return [
          { dx: 0, dy: 0 },
          { dx: 2, dy: 0 },
          { dx: -2, dy: 0 },
          { dx: 0, dy: 2 },
          { dx: 0, dy: -2 },
        ];
      case 'field':
        return [
          { dx: 0, dy: 0 },
          { dx: 1, dy: 0 },
          { dx: -1, dy: 0 },
        ];
      case 'button':
      case 'menu':
        return [
          { dx: 0, dy: 0 },
          { dx: 3, dy: 0 },
          { dx: -3, dy: 0 },
          { dx: 0, dy: 3 },
          { dx: 0, dy: -3 },
        ];
      case 'link':
        return [
          { dx: 0, dy: 0 },
          { dx: 2, dy: 1 },
          { dx: -2, dy: -1 },
        ];
      default:
        return [
          { dx: 0, dy: 0 },
          { dx: 3, dy: 0 },
          { dx: 0, dy: 3 },
        ];
    }
  }

  private async pressMouse(action: PressMouseAction): Promise<void> {
    const { coordinates, button, press } = action;

    // Move to coordinates if provided
    if (coordinates) {
      await this.nutService.mouseMoveEvent(coordinates);
    }

    // Perform press
    if (press === 'down') {
      await this.nutService.mouseButtonEvent(button, true);
    } else {
      await this.nutService.mouseButtonEvent(button, false);
    }
    await this.recordActionEvent('press_mouse');
  }

  private async dragMouse(action: DragMouseAction): Promise<void> {
    const { path, button, holdKeys } = action;

    // Move to the first coordinate
    await this.nutService.mouseMoveEvent(path[0]);

    // Hold keys if provided
    if (holdKeys) {
      await this.nutService.holdKeys(holdKeys, true);
    }

    // Perform drag
    await this.nutService.mouseButtonEvent(button, true);
    for (const coordinates of path) {
      await this.nutService.mouseMoveEvent(coordinates);
    }
    await this.nutService.mouseButtonEvent(button, false);

    // Release hold keys
    if (holdKeys) {
      await this.nutService.holdKeys(holdKeys, false);
    }
    await this.recordActionEvent('drag_mouse');
  }

  private async scroll(action: ScrollAction): Promise<void> {
    const { coordinates, direction, scrollCount, holdKeys } = action;

    // Move to coordinates if provided
    if (coordinates) {
      await this.nutService.mouseMoveEvent(coordinates);
    }

    // Hold keys if provided
    if (holdKeys) {
      await this.nutService.holdKeys(holdKeys, true);
    }

    // Perform scroll
    for (let i = 0; i < scrollCount; i++) {
      await this.nutService.mouseWheelEvent(direction, 1);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    // Release hold keys
    if (holdKeys) {
      await this.nutService.holdKeys(holdKeys, false);
    }
    await this.recordActionEvent('scroll');
  }

  private async typeKeys(action: TypeKeysAction): Promise<void> {
    const { keys, delay } = action;
    await this.nutService.sendKeys(keys);

    // Windows-specific: UI updates slower than Linux, add settle delay
    // This prevents screenshots from capturing stale UI state before updates render
    if (isWindows()) {
      await this.delay(300);  // 300ms for UI to update
    }

    if (delay && delay > 0) {
      await this.delay(delay);
    }
    await this.recordActionEvent('type_keys');
  }

  private async pressKeys(action: PressKeysAction): Promise<void> {
    const { keys, press } = action;
    await this.nutService.holdKeys(keys, press === 'down');

    // Windows-specific: UI settle delay
    if (isWindows()) {
      await this.delay(300);
    }

    await this.recordActionEvent('press_keys');
  }

  private async typeText(action: TypeTextAction): Promise<void> {
    const { text, delay } = action;
    await this.nutService.typeText(text, delay);

    // Windows-specific: UI settle delay
    if (isWindows()) {
      await this.delay(300);
    }

    await this.recordActionEvent('type_text');
  }

  private async pasteText(action: PasteTextAction): Promise<void> {
    const { text } = action;
    await this.nutService.pasteText(text);

    // Windows-specific: UI settle delay
    if (isWindows()) {
      await this.delay(300);
    }

    await this.recordActionEvent('paste_text');
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async screenshot(action?: ScreenshotAction): Promise<{
    image: string;
    width?: number;
    height?: number;
    offset?: { x: number; y: number };
  }> {
    this.logger.log(`Taking screenshot`);
    let buffer = await this.nutService.screendump();
    const annotator = await ScreenshotAnnotator.from(buffer);
    const dimensions = annotator.dimensions;

    const shouldShowCursor = action?.showCursor ?? true;
    let cursorPosition: { x: number; y: number } | undefined;

    if (shouldShowCursor) {
      try {
        cursorPosition = await this.nutService.getCursorPosition();
      } catch (error) {
        this.logger.warn(
          `Failed to fetch cursor position for screenshot: ${(error as Error).message}`,
        );
      }
    }

    const gridOverlayEnabled =
      action?.gridOverlay !== undefined
        ? action.gridOverlay
        : FOCUS_CONFIG.GRID_ENABLED;

    if (gridOverlayEnabled) {
      this.logger.debug('Adding coordinate grid overlay to screenshot');
      try {
        const debugMode = process.env.BYTEBOT_GRID_DEBUG === 'true';

        const overlay = debugMode
          ? this.gridOverlayService.createDebugGridOverlay(
              dimensions.width,
              dimensions.height,
            )
          : this.gridOverlayService.createGridOverlay(
              dimensions.width,
              dimensions.height,
              {
                gridSize: action?.gridSize ?? undefined,
              },
            );

        if (overlay) {
          annotator.addOverlay(overlay);
          this.logger.debug('Grid overlay added successfully');
        }
      } catch (error) {
        this.logger.warn(`Failed to add grid overlay: ${error.message}`);
      }
    }

    if (
      action?.highlightRegions ||
      action?.progressStep !== undefined ||
      action?.markTarget
    ) {
      try {
        const overlay = this.gridOverlayService.createProgressOverlay(
          dimensions.width,
          dimensions.height,
          action?.progressStep ?? 0,
          {
            message: action?.progressMessage,
            highlightAllRegions: action?.highlightRegions,
          },
        );

        if (overlay) {
          annotator.addOverlay(overlay);
        }
      } catch (error) {
        this.logger.warn(`Failed to add progress indicators: ${error.message}`);
      }
    }

    if (action?.markTarget?.coordinates) {
      try {
        const targetOverlay = this.gridOverlayService.createCursorOverlay(
          dimensions.width,
          dimensions.height,
          action.markTarget.coordinates,
        );

        if (targetOverlay) {
          annotator.addOverlay(targetOverlay);
        }
      } catch (error) {
        this.logger.warn(
          `Failed to annotate target on screenshot: ${(error as Error).message}`,
        );
      }
    }

    if (cursorPosition) {
      try {
        const overlay = this.gridOverlayService.createCursorOverlay(
          dimensions.width,
          dimensions.height,
          cursorPosition,
        );

        if (overlay) {
          annotator.addOverlay(overlay);
        }
      } catch (error) {
        this.logger.warn(
          `Failed to annotate cursor on screenshot: ${(error as Error).message}`,
        );
      }
    }

    const rendered = await annotator.render();
    buffer = rendered.buffer;
    await this.persistScreenshot(buffer, 'screenshot');
    const width = Number.isFinite(rendered.width) ? rendered.width : undefined;
    const height = Number.isFinite(rendered.height)
      ? rendered.height
      : undefined;
    const base64 = buffer.toString('base64');

    if (action?.progressTaskId) {
      this.progressBroadcaster.broadcastStep({
        taskId: action.progressTaskId,
        step: action.progressStep ?? 0,
        description: action.progressMessage ?? 'Screenshot captured',
        screenshot: base64,
        coordinates: action.markTarget?.coordinates,
      });
    }

    await this.recordActionEvent('screenshot');
    return { image: base64, width, height };
  }

  private async screenshotRegion(action: ScreenshotRegionAction): Promise<{
    image: string;
    offset?: { x: number; y: number };
    region?: { x: number; y: number; width: number; height: number };
    zoomLevel?: number;
  }> {
    this.logger.log(`Taking focused region screenshot: ${action.region}`);

    const regionResult = await this.focusRegion.captureFocusedRegion(
      action.region,
      {
        gridSize: action.gridSize ?? FOCUS_CONFIG.REGION_GRID_SIZE,
        enhance:
          typeof action.enhance === 'boolean'
            ? action.enhance
            : FOCUS_CONFIG.AUTO_ENHANCE,
        includeOffset: action.includeOffset ?? true,
        zoomLevel: action.zoomLevel ?? FOCUS_CONFIG.REGION_ZOOM_LEVEL,
      },
    );

    let buffer = regionResult.image;
    const annotator = await ScreenshotAnnotator.from(buffer);
    const dimensions = annotator.dimensions;

    const shouldShowCursor = action.showCursor ?? true;
    let cursorLocal: { x: number; y: number } | undefined;

    if (shouldShowCursor) {
      try {
        const cursor = await this.nutService.getCursorPosition();
        cursorLocal = this.mapCursorToRegion(
          cursor,
          regionResult.offset,
          {
            width: regionResult.region.width,
            height: regionResult.region.height,
          },
          regionResult.zoomLevel ?? 1,
        );
      } catch (error) {
        this.logger.warn(
          `Failed to fetch cursor position for region screenshot: ${(error as Error).message}`,
        );
      }
    }

    if (
      action.addHighlight ||
      action.progressStep !== undefined ||
      action.progressMessage
    ) {
      try {
        const overlay = this.gridOverlayService.createProgressOverlay(
          dimensions.width,
          dimensions.height,
          action.progressStep ?? 0,
          {
            message:
              action.progressMessage ?? `Focused region: ${action.region}`,
            frameImage: action.addHighlight ?? false,
          },
        );

        if (overlay) {
          annotator.addOverlay(overlay);
        }
      } catch (error) {
        this.logger.warn(
          `Failed to add progress indicators to region screenshot: ${error.message}`,
        );
      }
    }

    if (cursorLocal) {
      try {
        const cursorOverlay = this.gridOverlayService.createCursorOverlay(
          dimensions.width,
          dimensions.height,
          cursorLocal,
        );

        if (cursorOverlay) {
          annotator.addOverlay(cursorOverlay);
        }
      } catch (error) {
        this.logger.warn(
          `Failed to annotate cursor on region screenshot: ${(error as Error).message}`,
        );
      }
    }

    const rendered = await annotator.render();
    buffer = rendered.buffer;
    await this.persistScreenshot(buffer, 'screenshot_region');
    const base64 = buffer.toString('base64');

    if (action.progressTaskId) {
      this.progressBroadcaster.broadcastStep({
        taskId: action.progressTaskId,
        step: action.progressStep ?? 0,
        description:
          action.progressMessage ?? `Region ${action.region} captured`,
        screenshot: base64,
        coordinates: action.includeOffset ? regionResult.offset : undefined,
      });
    }

    // Record progressive zoom event
    await this.recordActionEvent('screenshot_region');

    return {
      image: base64,
      offset: action.includeOffset ? regionResult.offset : undefined,
      region: regionResult.region,
      zoomLevel: regionResult.zoomLevel,
    };
  }

  private async cursor_position(): Promise<{ x: number; y: number }> {
    this.logger.log(`Getting cursor position`);
    return await this.nutService.getCursorPosition();
  }

  private async persistScreenshot(
    buffer: Buffer,
    actionType: string,
  ): Promise<void> {
    if (process.env.BYTEBOT_SAVE_SCREENSHOTS !== 'true') {
      return;
    }

    const directory =
      process.env.BYTEBOT_SCREENSHOT_PATH ?? path.join(os.tmpdir(), 'bytebot-screenshots');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${actionType}-${timestamp}.png`;
    const filePath = path.join(directory, filename);

    try {
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(filePath, buffer);
      this.logger.debug(`Saved ${actionType} screenshot to ${filePath}`);
    } catch (error) {
      this.logger.debug(
        `Failed to persist ${actionType} screenshot to ${filePath}: ${(error as Error).message}`,
      );
    }
  }

  private mapCursorToRegion(
    cursor: { x: number; y: number } | undefined,
    offset: { x: number; y: number },
    size: { width: number; height: number },
    zoomLevel: number = 1,
  ): { x: number; y: number } | undefined {
    if (!cursor) {
      return undefined;
    }

    const withinX = cursor.x >= offset.x && cursor.x < offset.x + size.width;
    const withinY = cursor.y >= offset.y && cursor.y < offset.y + size.height;

    if (!withinX || !withinY) {
      return undefined;
    }

    return {
      x: Math.round((cursor.x - offset.x) * zoomLevel),
      y: Math.round((cursor.y - offset.y) * zoomLevel),
    };
  }

  private async saveDetectionScreenshot(buffer: Buffer): Promise<string> {
    const directory =
      process.env.BYTEBOT_SCREENSHOT_PATH ??
      path.join(os.tmpdir(), 'bytebot-screenshots');
    const filename = `element-detection-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}.png`;
    const filePath = path.join(directory, filename);

    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(filePath, buffer);

    return filePath;
  }

  private async screen_info(): Promise<{ width: number; height: number }> {
    this.logger.log(`Getting screen info`);
    try {
      const buffer = await this.nutService.screendump();
      const meta = await sharp(buffer).metadata();
      const width = meta.width ?? 0;
      const height = meta.height ?? 0;
      return { width, height };
    } catch (error: any) {
      this.logger.warn(`Failed to get screen info: ${error.message}`);
      return { width: 0, height: 0 };
    }
  }

  private async refineClickTarget(target: {
    x: number;
    y: number;
  }): Promise<{ x: number; y: number }> {
    try {
      const full = await this.nutService.screendump();
      const meta = await sharp(full).metadata();
      const width = meta.width ?? 0;
      const height = meta.height ?? 0;
      if (width === 0 || height === 0) return target;

      const R = Math.max(1, Math.min(this.snapRadius, 24));
      const left = Math.max(0, Math.min(target.x - R, width - 1));
      const top = Math.max(0, Math.min(target.y - R, height - 1));
      const roiW = Math.min(R * 2 + 1, width - left);
      const roiH = Math.min(R * 2 + 1, height - top);

      const roi = await sharp(full)
        .extract({ left, top, width: roiW, height: roiH })
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const data = roi.data;
      const w = roi.info.width;
      const h = roi.info.height;
      const cx = Math.min(Math.max(target.x - left, 1), w - 2);
      const cy = Math.min(Math.max(target.y - top, 1), h - 2);

      // scoring at center to measure improvement
      const scoreAt = (x: number, y: number) => {
        const c = data[idx(x, y)];
        let local = 0;
        local += Math.abs(c - data[idx(x - 1, y - 1)]);
        local += Math.abs(c - data[idx(x, y - 1)]);
        local += Math.abs(c - data[idx(x + 1, y - 1)]);
        local += Math.abs(c - data[idx(x - 1, y)]);
        local += Math.abs(c - data[idx(x + 1, y)]);
        local += Math.abs(c - data[idx(x - 1, y + 1)]);
        local += Math.abs(c - data[idx(x, y + 1)]);
        local += Math.abs(c - data[idx(x + 1, y + 1)]);
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.hypot(dx, dy);
        return (
          local -
          (Number.isFinite(this.snapPenalty) ? this.snapPenalty : 0.25) * dist
        );
      };

      const baseScore = scoreAt(cx, cy);
      let best = { x: cx, y: cy, score: baseScore };
      const alpha = Number.isFinite(this.snapPenalty) ? this.snapPenalty : 0.25;

      const idx = (x: number, y: number) => y * w + x;

      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const score = scoreAt(x, y);
          if (score > best.score) {
            best = { x, y, score };
          }
        }
      }

      const newX = left + best.x;
      const newY = top + best.y;
      const improvement = best.score - baseScore;
      const shift = Math.hypot(best.x - cx, best.y - cy);
      const maxShift = Math.max(1, this.snapMaxShift);
      const minImprove = Number.isFinite(this.snapMinImprovement)
        ? this.snapMinImprovement
        : 30;
      if (improvement >= minImprove && shift <= maxShift) {
        return { x: newX, y: newY };
      }
      // Reject snap if improvement is small or shift is large
      return target;
    } catch {
      return target;
    }
  }

  private async captureRoiGray(
    center: { x: number; y: number },
    radius: number,
  ): Promise<{ data: Buffer; width: number; height: number }> {
    const full = await this.nutService.screendump();
    const meta = await sharp(full).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (width === 0 || height === 0) {
      return { data: Buffer.alloc(0), width: 0, height: 0 };
    }
    const R = Math.max(1, Math.min(radius, 64));
    const left = Math.max(0, Math.min(center.x - R, width - 1));
    const top = Math.max(0, Math.min(center.y - R, height - 1));
    const roiW = Math.min(R * 2 + 1, width - left);
    const roiH = Math.min(R * 2 + 1, height - top);
    const roi = await sharp(full)
      .extract({ left, top, width: roiW, height: roiH })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { data: roi.data, width: roi.info.width, height: roi.info.height };
  }

  private meanAbsoluteDifference(
    a: { data: Buffer; width: number; height: number },
    b: { data: Buffer; width: number; height: number },
  ): number {
    if (
      a.width !== b.width ||
      a.height !== b.height ||
      a.data.length !== b.data.length
    ) {
      return Number.POSITIVE_INFINITY; // treat as changed
    }
    const len = a.data.length;
    let sum = 0;
    for (let i = 0; i < len; i++) {
      sum += Math.abs(a.data[i] - b.data[i]);
    }
    return sum / len;
  }

  private async captureCalibrationSnapshot(actual: {
    x: number;
    y: number;
  }): Promise<Buffer | null> {
    const halfWindow = Math.max(Math.floor(this.calibrationWindow / 2), 50);
    const width = Math.max(this.calibrationWindow, 100);
    const height = Math.max(this.calibrationWindow, 100);

    const regionX = Math.max(actual.x - halfWindow, 0);
    const regionY = Math.max(actual.y - halfWindow, 0);

    try {
      const snapshot = await this.focusRegion.captureCustomRegion(
        regionX,
        regionY,
        width,
        height,
        FOCUS_CONFIG.FOCUSED_GRID_SIZE,
        FOCUS_CONFIG.CUSTOM_REGION_ZOOM_LEVEL,
      );

      return snapshot.image;
    } catch (error) {
      this.logger.warn(
        `Failed to capture calibration snapshot: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private async application(action: ApplicationAction): Promise<void> {
    if (isWindows()) {
      return this.applicationWindows(action);
    } else if (isLinux()) {
      return this.applicationLinux(action);
    } else if (isMacOS()) {
      return this.applicationMacOS(action);
    }
    throw new Error(
      `Unsupported platform for application action: ${os.platform()}`,
    );
  }

  /**
   * Find the full path to a Windows application executable
   * Uses registry lookup and common installation paths
   */
  private async findWindowsApplicationPath(
    executableName: string,
    appName: Application,
  ): Promise<string> {
    const execAsync = promisify(exec);

    // System executables (always in PATH)
    const systemExecutables = ['cmd.exe', 'explorer.exe', 'powershell.exe'];
    if (systemExecutables.includes(executableName.toLowerCase())) {
      return executableName;
    }

    // Try Windows App Paths registry (both HKLM and HKCU)
    const registryPaths = [
      `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executableName}`,
      `HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executableName}`,
    ];

    for (const regPath of registryPaths) {
      try {
        const { stdout } = await execAsync(
          `reg query "${regPath}" /ve`,
          { timeout: 2000 },
        );
        // Parse registry output: "(Default)    REG_SZ    C:\Path\To\App.exe"
        const match = stdout.match(/REG_SZ\s+(.+)/);
        if (match && match[1]) {
          const path = match[1].trim();
          this.logger.debug(
            `Found ${executableName} in registry: ${path}`,
          );
          return path;
        }
      } catch (error: any) {
        // Registry key not found, try next
        this.logger.debug(
          `Registry path not found: ${regPath}`,
        );
      }
    }

    // Try common installation paths based on application
    const commonPaths: Record<string, string[]> = {
      vscode: [
        `${process.env.LOCALAPPDATA}\\Programs\\Microsoft VS Code\\Code.exe`,
        `${process.env.ProgramFiles}\\Microsoft VS Code\\Code.exe`,
        `${process.env['ProgramFiles(x86)']}\\Microsoft VS Code\\Code.exe`,
      ],
      firefox: [
        `${process.env.ProgramFiles}\\Mozilla Firefox\\firefox.exe`,
        `${process.env['ProgramFiles(x86)']}\\Mozilla Firefox\\firefox.exe`,
      ],
      '1password': [
        `${process.env.LOCALAPPDATA}\\1Password\\1Password.exe`,
        `${process.env.ProgramFiles}\\1Password\\1Password.exe`,
      ],
      thunderbird: [
        `${process.env.ProgramFiles}\\Mozilla Thunderbird\\thunderbird.exe`,
        `${process.env['ProgramFiles(x86)']}\\Mozilla Thunderbird\\thunderbird.exe`,
      ],
    };

    const paths = commonPaths[appName] || [];
    for (const path of paths) {
      try {
        // Check if file exists using PowerShell Test-Path (more reliable than fs.existsSync in Windows containers)
        const { stdout } = await execAsync(
          `powershell -Command "Test-Path '${path}'"`,
          { timeout: 2000 },
        );
        if (stdout.trim().toLowerCase() === 'true') {
          this.logger.debug(
            `Found ${executableName} at common path: ${path}`,
          );
          return path;
        }
      } catch (error: any) {
        // Path doesn't exist, try next
      }
    }

    // Last resort: try 'where' command (searches PATH)
    try {
      const { stdout } = await execAsync(
        `where ${executableName}`,
        { timeout: 2000 },
      );
      const path = stdout.trim().split('\n')[0]; // Take first result
      if (path) {
        this.logger.debug(
          `Found ${executableName} via 'where' command: ${path}`,
        );
        return path;
      }
    } catch (error: any) {
      // 'where' failed
      this.logger.debug(
        `'where' command failed for ${executableName}`,
      );
    }

    // Fallback: return original executable name (will likely fail but let PowerShell error)
    this.logger.warn(
      `Could not find full path for ${executableName}, using name as-is (may fail)`,
    );
    return executableName;
  }

  private async applicationWindows(action: ApplicationAction): Promise<void> {
    const execAsync = promisify(exec);

    // Windows application mapping
    const commandMap: Record<string, string> = {
      firefox: 'firefox.exe',
      '1password': '1Password.exe',
      thunderbird: 'thunderbird.exe',
      vscode: 'Code.exe',
      terminal: 'cmd.exe', // Can also use 'powershell.exe' or 'wt.exe' (Windows Terminal)
      directory: 'explorer.exe',
    };

    // Process name for detection (without .exe)
    const processMap: Record<Application, string> = {
      firefox: 'firefox',
      '1password': '1Password',
      thunderbird: 'thunderbird',
      vscode: 'Code',
      terminal: 'cmd',
      directory: 'explorer',
      desktop: 'explorer', // Desktop is managed by explorer
    };

    // Special case: Show desktop (minimize all windows)
    if (action.application === 'desktop') {
      try {
        // Windows+D shortcut to show desktop
        await execAsync(
          `powershell -Command "(New-Object -ComObject shell.application).minimizeall()"`,
          { timeout: 5000 },
        );
        this.logger.log('Desktop shown (all windows minimized)');
      } catch (error: any) {
        this.logger.warn(
          `Failed to show desktop: ${error.message || String(error)}`,
        );
      }
      return;
    }

    // Check if application is already running
    let appOpen = false;
    try {
      const { stdout } = await execAsync(
        `powershell -Command "Get-Process -Name '${processMap[action.application]}' -ErrorAction SilentlyContinue | Select-Object -First 1"`,
        { timeout: 5000 },
      );
      appOpen = stdout.trim().length > 0;
    } catch (error: any) {
      // Process not found, treat as not open
      this.logger.debug(
        `Process check error (treating as not running): ${error.message}`,
      );
    }

    if (appOpen) {
      this.logger.log(
        `Application ${action.application} is already running, attempting to focus...`,
      );

      // Activate and maximize the window using reusable method
      await this.activateWindow(processMap[action.application]);
      return;
    }

    // Application not running, launch it
    this.logger.log(
      `Launching application ${action.application} (${commandMap[action.application]})...`,
    );

    try {
      const executableName = commandMap[action.application];

      // Find full path to executable
      const fullPath = await this.findWindowsApplicationPath(
        executableName,
        action.application,
      );

      this.logger.log(
        `Resolved path for ${executableName}: ${fullPath}`,
      );

      // Special handling for directory (open File Explorer)
      if (action.application === 'directory') {
        await execAsync(`start ${fullPath}`, { timeout: 5000 });
      } else {
        // Use Start-Process to launch with WindowStyle Maximized
        // Escape path for PowerShell (handle spaces and special chars)
        const escapedPath = fullPath.replace(/'/g, "''");
        await execAsync(
          `powershell -Command "Start-Process '${escapedPath}' -WindowStyle Maximized"`,
          { timeout: 10000 },
        );
      }

      // Verify the process actually started (wait 3 seconds for Windows to fully launch and focus)
      // Windows needs more time than Linux for window focus to stabilize
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Additional wait for window to receive focus
      await this.waitForWindowFocus(processMap[action.application], 2000);

      // Activate the window (SetForegroundWindow) to make it receive keyboard input
      // This is the critical step that was missing - window exists but needs explicit activation
      await this.activateWindow(processMap[action.application]);

      try {
        const { stdout } = await execAsync(
          `powershell -Command "Get-Process -Name '${processMap[action.application]}' -ErrorAction SilentlyContinue | Select-Object -First 1"`,
          { timeout: 3000 },
        );

        if (stdout.trim().length > 0) {
          this.logger.log(
            `✓ Application ${action.application} launched successfully and verified`,
          );
        } else {
          this.logger.warn(
            `Application ${action.application} may not have started - process not found after launch`,
          );
        }
      } catch (verifyError: any) {
        this.logger.warn(
          `Could not verify ${action.application} started: ${verifyError.message}`,
        );
      }
    } catch (error: any) {
      this.logger.error(
        `Failed to launch ${action.application}: ${error.message || String(error)}`,
      );
      throw new Error(
        `Failed to launch ${action.application}: ${error.message || String(error)}`,
      );
    }
  }

  /**
   * Wait for a Windows application window to receive focus
   * Polls for MainWindowHandle and foreground status
   */
  private async waitForWindowFocus(
    processName: string,
    maxWaitMs: number,
  ): Promise<void> {
    const execAsync = promisify(exec);
    const startTime = Date.now();
    const pollInterval = 500; // Check every 500ms

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const { stdout } = await execAsync(
          `powershell -Command "Get-Process -Name '${processName}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1 | Select-Object MainWindowHandle"`,
          { timeout: 1000 },
        );

        if (stdout.trim().length > 0 && stdout.includes('MainWindowHandle')) {
          this.logger.debug(`Window focus verified for ${processName}`);
          // Additional small delay to ensure input queue is ready
          await new Promise(resolve => setTimeout(resolve, 200));
          return;
        }
      } catch (error: any) {
        // Ignore errors during polling
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    // Timeout - window may not have focus but continue anyway
    this.logger.warn(
      `Timeout waiting for ${processName} window focus after ${maxWaitMs}ms`,
    );
  }

  /**
   * Activate a Windows application window (bring to foreground)
   * Uses Win32 API ShowWindow + SetForegroundWindow
   */
  private async activateWindow(processName: string): Promise<void> {
    const execAsync = promisify(exec);

    this.logger.debug(`Activating window for process: ${processName}`);

    try {
      // PowerShell script to call Win32 API for window activation
      const focusScript = `
        $proc = Get-Process -Name '${processName}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
        if ($proc) {
          Add-Type @"
            using System;
            using System.Runtime.InteropServices;
            public class WinAPI {
              [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
              [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
            }
"@
          [WinAPI]::ShowWindow($proc.MainWindowHandle, 3)  # 3 = SW_MAXIMIZE
          [WinAPI]::SetForegroundWindow($proc.MainWindowHandle)
        }
      `;

      await execAsync(
        `powershell -Command "${focusScript.replace(/"/g, '\\"').replace(/\n/g, ';')}"`,
        { timeout: 5000 },
      );

      this.logger.debug(`✓ Window activated successfully for ${processName}`);
    } catch (error: any) {
      this.logger.warn(
        `Failed to activate window for ${processName}: ${error.message || String(error)}`,
      );
      // Don't throw - activation is best-effort
    }
  }

  private async applicationLinux(action: ApplicationAction): Promise<void> {
    const execAsync = promisify(exec);

    // Helper to spawn a command and forget about it
    const spawnAndForget = (
      command: string,
      args: string[],
      options: Record<string, any> = {},
    ): void => {
      const child = spawn(command, args, {
        env: { ...process.env, DISPLAY: ':0.0' }, // ensure DISPLAY is set for GUI tools
        stdio: 'ignore',
        detached: true,
        ...options,
      });
      child.unref(); // Allow the parent process to exit independently
    };

    if (action.application === 'desktop') {
      spawnAndForget('sudo', ['-u', 'user', 'wmctrl', '-k', 'on']);
      return;
    }

    const commandMap: Record<string, string> = {
      firefox: 'firefox-esr',
      '1password': '1password',
      thunderbird: 'thunderbird',
      vscode: 'code',
      terminal: 'xfce4-terminal',
      directory: 'thunar',
    };

    const processMap: Record<Application, string> = {
      firefox: 'Navigator.firefox-esr',
      '1password': '1password.1Password',
      thunderbird: 'Mail.thunderbird',
      vscode: 'code.Code',
      terminal: 'xfce4-terminal.Xfce4-Terminal',
      directory: 'Thunar',
      desktop: 'xfdesktop.Xfdesktop',
    };

    // check if the application is already open using wmctrl -lx
    let appOpen = false;
    try {
      const { stdout } = await execAsync(
        `sudo -u user wmctrl -lx | grep ${processMap[action.application]}`,
        { timeout: 5000 }, // 5 second timeout
      );
      appOpen = stdout.trim().length > 0;
    } catch (error: any) {
      // grep returns exit code 1 when no match is found – treat as "not open"
      // Also handle timeout errors
      if (error.code !== 1 && !error.message?.includes('timeout')) {
        throw error;
      }
    }

    if (appOpen) {
      this.logger.log(`Application ${action.application} is already open`);

      // Fire and forget - activate window
      spawnAndForget('sudo', [
        '-u',
        'user',
        'wmctrl',
        '-x',
        '-a',
        processMap[action.application],
      ]);

      // Fire and forget - maximize window
      spawnAndForget('sudo', [
        '-u',
        'user',
        'wmctrl',
        '-x',
        '-r',
        processMap[action.application],
        '-b',
        'add,maximized_vert,maximized_horz',
      ]);

      return;
    }

    // application is not open, open it - fire and forget
    spawnAndForget('sudo', [
      '-u',
      'user',
      'nohup',
      commandMap[action.application],
    ]);

    this.logger.log(`Application ${action.application} launched`);

    // Just return immediately
    return;
  }

  private async applicationMacOS(action: ApplicationAction): Promise<void> {
    const execAsync = promisify(exec);

    // macOS application mapping
    const appMap: Record<string, string> = {
      firefox: 'Firefox',
      '1password': '1Password',
      thunderbird: 'Thunderbird',
      vscode: 'Visual Studio Code',
      terminal: 'Terminal',
      directory: 'Finder',
    };

    // Special case: Show desktop
    if (action.application === 'desktop') {
      try {
        // F11 or Mission Control to show desktop
        await execAsync(
          `osascript -e 'tell application "System Events" to key code 103'`,
          { timeout: 5000 },
        );
        this.logger.log('Desktop shown');
      } catch (error: any) {
        this.logger.warn(`Failed to show desktop: ${error.message}`);
      }
      return;
    }

    const appName = appMap[action.application];
    if (!appName) {
      throw new Error(`Unknown application: ${action.application}`);
    }

    try {
      // Check if app is running
      const { stdout: runningCheck } = await execAsync(
        `osascript -e 'tell application "System Events" to (name of processes) contains "${appName}"'`,
        { timeout: 5000 },
      );

      const isRunning = runningCheck.trim() === 'true';

      if (isRunning) {
        this.logger.log(
          `Application ${action.application} is already running, activating...`,
        );
        // Activate and maximize
        await execAsync(
          `osascript -e 'tell application "${appName}" to activate' -e 'tell application "System Events" to tell process "${appName}" to set frontmost to true'`,
          { timeout: 5000 },
        );
      } else {
        this.logger.log(`Launching application ${action.application}...`);
        // Launch and activate
        await execAsync(`open -a "${appName}"`, { timeout: 10000 });
      }

      this.logger.log(
        `Application ${action.application} handled successfully`,
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to handle ${action.application}: ${error.message}`,
      );
      throw new Error(
        `Failed to handle ${action.application}: ${error.message}`,
      );
    }
  }

  private async writeFile(
    action: WriteFileAction,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const execAsync = promisify(exec);

      // Decode base64 data
      const buffer = Buffer.from(action.data, 'base64');

      // Resolve path - if relative, make it relative to user's home directory
      let targetPath = action.path;
      if (!path.isAbsolute(targetPath)) {
        targetPath = path.join('/home/user/Desktop', targetPath);
      }

      // Ensure directory exists using sudo
      const dir = path.dirname(targetPath);
      try {
        await execAsync(`sudo mkdir -p "${dir}"`);
      } catch (error) {
        // Directory might already exist, which is fine
        this.logger.debug(`Directory creation: ${error.message}`);
      }

      // Write to a temporary file first
      const tempFile = path.join(os.tmpdir(), `bytebot_temp_${Date.now()}_${Math.random().toString(36).substring(7)}`);
      await fs.writeFile(tempFile, buffer);

      // Move the file to the target location using sudo
      try {
        await execAsync(`sudo cp "${tempFile}" "${targetPath}"`);
        await execAsync(`sudo chown user:user "${targetPath}"`);
        await execAsync(`sudo chmod 644 "${targetPath}"`);
        // Clean up temp file
        await fs.unlink(tempFile).catch(() => {});
      } catch (error) {
        // Clean up temp file on error
        await fs.unlink(tempFile).catch(() => {});
        throw error;
      }

      this.logger.log(`File written successfully to: ${targetPath}`);
      return {
        success: true,
        message: `File written successfully to: ${targetPath}`,
      };
    } catch (error) {
      this.logger.error(`Error writing file: ${error.message}`, error.stack);
      return {
        success: false,
        message: `Error writing file: ${error.message}`,
      };
    }
  }

  private async readFile(action: ReadFileAction): Promise<{
    success: boolean;
    data?: string;
    name?: string;
    size?: number;
    mediaType?: string;
    message?: string;
  }> {
    try {
      const execAsync = promisify(exec);

      // Resolve path - if relative, make it relative to user's home directory
      let targetPath = action.path;
      if (!path.isAbsolute(targetPath)) {
        targetPath = path.join('/home/user/Desktop', targetPath);
      }

      // Copy file to temp location using sudo to read it
      const tempFile = path.join(os.tmpdir(), `bytebot_read_${Date.now()}_${Math.random().toString(36).substring(7)}`);

      try {
        // Copy the file to a temporary location we can read
        await execAsync(`sudo cp "${targetPath}" "${tempFile}"`);
        await execAsync(`sudo chmod 644 "${tempFile}"`);

        // Read file as buffer from temp location
        const buffer = await fs.readFile(tempFile);

        // Get file stats for size using sudo
        const { stdout: statOutput } = await execAsync(
          `sudo stat -c "%s" "${targetPath}"`,
        );
        const fileSize = parseInt(statOutput.trim(), 10);

        // Clean up temp file
        await fs.unlink(tempFile).catch(() => {});

        // Convert to base64
        const base64Data = buffer.toString('base64');

        // Extract filename from path
        const fileName = path.basename(targetPath);

        // Determine media type based on file extension
        const ext = path.extname(targetPath).toLowerCase().slice(1);
        const mimeTypes: Record<string, string> = {
          pdf: 'application/pdf',
          docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          doc: 'application/msword',
          txt: 'text/plain',
          html: 'text/html',
          json: 'application/json',
          xml: 'text/xml',
          csv: 'text/csv',
          rtf: 'application/rtf',
          odt: 'application/vnd.oasis.opendocument.text',
          epub: 'application/epub+zip',
          png: 'image/png',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          webp: 'image/webp',
          gif: 'image/gif',
          svg: 'image/svg+xml',
        };

        const mediaType = mimeTypes[ext] || 'application/octet-stream';

        this.logger.log(`File read successfully from: ${targetPath}`);
        return {
          success: true,
          data: base64Data,
          name: fileName,
          size: fileSize,
          mediaType: mediaType,
        };
      } catch (error) {
        // Clean up temp file on error
        await fs.unlink(tempFile).catch(() => {});
        throw error;
      }
    } catch (error) {
      this.logger.error(`Error reading file: ${error.message}`, error.stack);
      return {
        success: false,
        message: `Error reading file: ${error.message}`,
      };
    }
  }
}
