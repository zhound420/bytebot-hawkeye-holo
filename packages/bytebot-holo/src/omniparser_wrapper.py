"""OmniParser model wrapper for UI element detection and captioning."""

import time
import sys
import io
import base64
import traceback
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
import torch
import numpy as np
from PIL import Image
import cv2

# Add OmniParser to path
OMNIPARSER_DIR = Path(__file__).parent.parent / "OmniParser"
if OMNIPARSER_DIR.exists():
    sys.path.insert(0, str(OMNIPARSER_DIR))

from ultralytics import YOLO
from transformers import AutoProcessor, AutoModelForCausalLM

# Import BoxAnnotator and utilities from OmniParser
try:
    from util.box_annotator import BoxAnnotator
    from util.utils import (
        check_ocr_box,
        get_som_labeled_img,
        get_parsed_content_icon
    )
    import supervision as sv
    from torchvision.ops import box_convert
    OMNIPARSER_UTILS_AVAILABLE = True
except ImportError as e:
    # Fallback if OmniParser utils not available
    print(f"Warning: OmniParser utils not available: {e}")
    BoxAnnotator = None
    sv = None
    check_ocr_box = None
    get_som_labeled_img = None
    get_parsed_content_icon = None
    OMNIPARSER_UTILS_AVAILABLE = False

from .config import settings


class OmniParserV2:
    """OmniParser v2.0 wrapper for UI element detection."""

    def __init__(self):
        """Initialize OmniParser models."""
        self.device = settings.device
        self.dtype = self._get_dtype()

        print(f"Loading OmniParser models on {self.device} with dtype={self.dtype}...")
        if self.device == "mps":
            print("  ℹ️  MPS detected: Using float32 to avoid dtype mismatch issues")

        # Load YOLO icon detection model
        self.icon_detector = self._load_icon_detector()

        # Load Florence-2 caption model
        self.caption_model, self.caption_processor = self._load_caption_model()

        print(f"✓ OmniParser models loaded successfully (device={self.device}, dtype={self.dtype})")

    def _get_dtype(self) -> torch.dtype:
        """Get torch dtype from config."""
        # Force float32 for MPS to avoid dtype mismatch issues
        # MPS doesn't handle mixed precision well (float16 model + float32 inputs)
        if self.device == "mps":
            return torch.float32

        dtype_map = {
            "float16": torch.float16,
            "float32": torch.float32,
            "bfloat16": torch.bfloat16,
        }
        return dtype_map.get(settings.model_dtype, torch.float16)

    def _load_icon_detector(self) -> YOLO:
        """Load YOLOv8 icon detection model."""
        model_path = settings.icon_detect_dir / "model.pt"

        if not model_path.exists():
            raise FileNotFoundError(
                f"Icon detection model not found at {model_path}. "
                "Run scripts/download_models.sh first."
            )

        model = YOLO(str(model_path))
        return model

    def _load_caption_model(self) -> Tuple[AutoModelForCausalLM, AutoProcessor]:
        """Load Florence-2 caption model."""
        model_path = settings.icon_caption_dir

        if not model_path.exists():
            raise FileNotFoundError(
                f"Caption model not found at {model_path}. "
                "Run scripts/download_models.sh first."
            )

        processor = AutoProcessor.from_pretrained(
            str(model_path),
            trust_remote_code=True
        )

        model = AutoModelForCausalLM.from_pretrained(
            str(model_path),
            torch_dtype=self.dtype,
            trust_remote_code=True
        ).to(self.device)

        if settings.cache_models:
            model.eval()

        return model, processor

    def detect_icons(
        self,
        image: np.ndarray,
        conf_threshold: Optional[float] = None
    ) -> List[Dict[str, Any]]:
        """
        Detect UI icons/elements using YOLOv8.

        Args:
            image: Input image as numpy array (RGB)
            conf_threshold: Confidence threshold (default from settings)

        Returns:
            List of detections with bounding boxes and confidence scores
        """
        conf_threshold = conf_threshold or settings.min_confidence

        # Run YOLO detection
        results = self.icon_detector.predict(
            image,
            conf=conf_threshold,
            device=self.device,
            verbose=False
        )

        detections = []
        for result in results:
            boxes = result.boxes
            for box in boxes:
                x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                confidence = float(box.conf[0])

                # Convert to x, y, width, height format
                detection = {
                    "bbox": [int(x1), int(y1), int(x2 - x1), int(y2 - y1)],
                    "confidence": confidence,
                    "center": [int((x1 + x2) / 2), int((y1 + y2) / 2)],
                    "type": "interactive_element"
                }
                detections.append(detection)

        return detections[:settings.max_detections]

    def caption_element(
        self,
        image: np.ndarray,
        bbox: List[int]
    ) -> str:
        """
        Generate caption for a UI element using Florence-2.

        Args:
            image: Full image as numpy array (RGB)
            bbox: Bounding box [x, y, width, height]

        Returns:
            Caption describing the element's function
        """
        # Extract element region
        x, y, w, h = bbox
        element_img = image[y:y+h, x:x+w]

        # Convert to PIL Image
        pil_image = Image.fromarray(element_img)

        # Generate caption using Florence-2
        prompt = "<CAPTION>"
        inputs = self.caption_processor(
            text=prompt,
            images=pil_image,
            return_tensors="pt"
        ).to(self.device)

        with torch.no_grad():
            generated_ids = self.caption_model.generate(
                input_ids=inputs["input_ids"],
                pixel_values=inputs["pixel_values"],
                max_new_tokens=50,
                num_beams=3,
                do_sample=False
            )

        caption = self.caption_processor.batch_decode(
            generated_ids,
            skip_special_tokens=True
        )[0]

        # Clean up caption
        caption = caption.replace("<CAPTION>", "").strip()

        return caption

    def generate_som_image(
        self,
        image: np.ndarray,
        detections: List[Dict[str, Any]]
    ) -> Optional[str]:
        """
        Generate Set-of-Mark (SOM) annotated image with numbered boxes.

        Args:
            image: Input image as numpy array (RGB)
            detections: List of detected elements with bboxes

        Returns:
            Base64 encoded annotated image, or None if annotation unavailable
        """
        if not BoxAnnotator or not sv:
            print("Warning: supervision library not available for SOM annotation")
            return None

        try:
            h, w = image.shape[:2]

            # Convert detections to supervision format
            xyxy_boxes = []
            for det in detections:
                x, y, width, height = det["bbox"]
                x1, y1, x2, y2 = x, y, x + width, y + height
                xyxy_boxes.append([x1, y1, x2, y2])

            if not xyxy_boxes:
                return None

            xyxy_boxes = np.array(xyxy_boxes)
            sv_detections = sv.Detections(xyxy=xyxy_boxes)

            # Create numbered labels (0, 1, 2, ...)
            labels = [str(i) for i in range(len(detections))]

            # Calculate annotation sizing based on image resolution
            box_overlay_ratio = w / 3200
            text_scale = 0.8 * box_overlay_ratio
            text_thickness = max(int(2 * box_overlay_ratio), 1)
            text_padding = max(int(3 * box_overlay_ratio), 1)
            thickness = max(int(3 * box_overlay_ratio), 1)

            # Create annotator with dynamic sizing
            box_annotator = BoxAnnotator(
                text_scale=text_scale,
                text_thickness=text_thickness,
                text_padding=text_padding,
                thickness=thickness
            )

            # Annotate the image
            annotated_frame = image.copy()
            annotated_frame = box_annotator.annotate(
                scene=annotated_frame,
                detections=sv_detections,
                labels=labels,
                image_size=(w, h)
            )

            # Convert to base64
            pil_img = Image.fromarray(annotated_frame)
            buffered = io.BytesIO()
            pil_img.save(buffered, format="PNG")
            encoded_image = base64.b64encode(buffered.getvalue()).decode('ascii')

            return encoded_image

        except Exception as e:
            print(f"Warning: Failed to generate SOM image: {e}")
            return None

    def parse_screenshot_full(
        self,
        image: np.ndarray,
        include_captions: bool = True,
        include_som: bool = True,
        include_ocr: bool = True,
        conf_threshold: Optional[float] = None,
        iou_threshold: float = 0.1,
        use_paddleocr: bool = True
    ) -> Dict[str, Any]:
        """
        Parse UI screenshot using FULL OmniParser pipeline with OCR + icon detection.

        This is the production-quality method that leverages OmniParser's complete feature set:
        - OCR text detection (PaddleOCR/EasyOCR)
        - Icon/element detection (YOLOv8)
        - Interactivity prediction (clickable vs decorative)
        - Overlap filtering (removes duplicates)
        - Batch caption processing (3-5x faster)
        - Structured output (type, interactivity, content, source)
        - Set-of-Mark visual annotations

        Args:
            image: Input screenshot as numpy array (RGB)
            include_captions: Whether to generate captions for elements
            include_som: Whether to generate Set-of-Mark annotated image
            include_ocr: Whether to run OCR text detection
            conf_threshold: Detection confidence threshold
            iou_threshold: IoU threshold for overlap removal (default: 0.1, official demo value)
            use_paddleocr: Use PaddleOCR (True) or EasyOCR (False)

        Returns:
            Dictionary with detected elements, OCR text, SOM image, and metadata
        """
        if not OMNIPARSER_UTILS_AVAILABLE:
            print("Warning: OmniParser utils not available, falling back to basic detection")
            return self.parse_screenshot(image, include_captions, include_som, conf_threshold)

        start_time = time.time()
        conf_threshold = conf_threshold or settings.min_confidence

        # Get performance profile settings
        profile_settings = settings.get_profile_settings()

        # Apply profile: OCR enable/disable
        if not profile_settings["enable_ocr"]:
            include_ocr = False
            print("OCR disabled by performance profile")

        # Convert numpy array to PIL Image for OmniParser
        pil_image = Image.fromarray(image)
        h, w = image.shape[:2]

        # Selective OCR: Pre-detect icons to decide if OCR is necessary
        should_run_ocr = include_ocr
        if include_ocr and profile_settings["enable_ocr"]:
            # Quick icon detection to assess if OCR is needed
            try:
                quick_detections = self.detect_icons(image, conf_threshold)
                num_icons = len(quick_detections)

                # Skip OCR if we have sufficient high-quality icon detections
                # This is a smart optimization for BALANCED mode
                if num_icons >= 15:  # Plenty of elements already
                    should_run_ocr = False
                    print(f"Selective OCR: Skipping OCR (found {num_icons} icons, sufficient coverage)")
                else:
                    print(f"Selective OCR: Running OCR (only {num_icons} icons detected, need text detection)")
            except Exception as e:
                print(f"Warning: Pre-detection failed, will attempt OCR anyway: {e}")

        # Step 1: Run OCR if determined necessary
        ocr_bbox = None
        ocr_text = []
        if should_run_ocr and check_ocr_box:
            try:
                ocr_result, _ = check_ocr_box(
                    pil_image,
                    display_img=False,
                    output_bb_format='xyxy',
                    goal_filtering=None,
                    easyocr_args={'paragraph': False, 'text_threshold': 0.5},  # Lowered from 0.9 for better detection
                    use_paddleocr=use_paddleocr
                )
                ocr_text, ocr_bbox = ocr_result
                print(f"OCR detected {len(ocr_text)} text elements")
            except Exception as e:
                print(f"Warning: OCR failed: {e}")
                ocr_text = []
                ocr_bbox = None

        # Step 2: Run full OmniParser pipeline if available
        if get_som_labeled_img and include_captions:
            try:
                # Calculate annotation sizing
                box_overlay_ratio = w / 3200
                draw_bbox_config = {
                    'text_scale': 0.8 * box_overlay_ratio,
                    'text_thickness': max(int(2 * box_overlay_ratio), 1),
                    'text_padding': max(int(3 * box_overlay_ratio), 1),
                    'thickness': max(int(3 * box_overlay_ratio), 1),
                }

                # Get caption model processor
                caption_processor = {
                    'model': self.caption_model,
                    'processor': self.caption_processor
                }

                # Get optimal batch size for current device and profile
                batch_size = settings.get_batch_size(self.device)

                # Get caption prompt from profile
                caption_prompt = f"<{profile_settings['caption_prompt']}>"

                # Run full pipeline: OCR + icon detection + captioning + SOM
                som_image_b64, label_coordinates, parsed_content_list = get_som_labeled_img(
                    pil_image,
                    model=self.icon_detector,
                    BOX_TRESHOLD=conf_threshold,
                    output_coord_in_ratio=False,  # Keep absolute coordinates
                    ocr_bbox=ocr_bbox,
                    draw_bbox_config=draw_bbox_config if include_som else None,
                    caption_model_processor=caption_processor,
                    ocr_text=ocr_text,
                    use_local_semantics=include_captions,
                    iou_threshold=iou_threshold,
                    scale_img=False,
                    prompt=caption_prompt,  # Profile-based caption detail level
                    batch_size=batch_size  # Profile-optimized batch size (MPS: 32, GPU: 128)
                )

                # Convert parsed_content_list to our format
                # Validate structure before processing
                if not isinstance(parsed_content_list, list):
                    raise TypeError(f"parsed_content_list must be list, got {type(parsed_content_list)}")

                elements = []
                for i, elem in enumerate(parsed_content_list):
                    # Validate each element is a dict
                    if not isinstance(elem, dict):
                        raise TypeError(
                            f"Element {i} must be dict, got {type(elem)}. "
                            f"Value: {elem}. "
                            f"List length: {len(parsed_content_list)}"
                        )

                    # Validate required keys
                    if 'bbox' not in elem:
                        raise KeyError(
                            f"Element {i} missing 'bbox' key. "
                            f"Available keys: {list(elem.keys())}"
                        )

                    bbox_norm = elem['bbox']  # [x_ratio, y_ratio, w_ratio, h_ratio]
                    x1 = int(bbox_norm[0] * w)
                    y1 = int(bbox_norm[1] * h)
                    x2 = int(bbox_norm[2] * w)
                    y2 = int(bbox_norm[3] * h)

                    element = {
                        "bbox": [x1, y1, x2 - x1, y2 - y1],
                        "center": [int((x1 + x2) / 2), int((y1 + y2) / 2)],
                        "confidence": 1.0,  # OmniParser doesn't return confidence per element
                        "type": elem['type'],  # 'text' or 'icon'
                        "interactable": elem.get('interactivity', True),  # Interactivity prediction
                        "content": elem.get('content', ''),  # OCR text or caption
                        "source": elem.get('source', 'unknown'),  # Detection source
                        "element_id": i,  # Element index for SOM mapping
                        "caption": elem.get('content', '') if elem['type'] == 'icon' else None
                    }
                    elements.append(element)

                # Apply max_captions limit from profile
                # Prioritize interactable elements and those with captions
                max_captions = profile_settings['max_captions']
                if len(elements) > max_captions:
                    # Sort by interactability (True first) and then by having caption content
                    elements_sorted = sorted(
                        elements,
                        key=lambda e: (not e['interactable'], not bool(e.get('caption') or e.get('content'))),
                        reverse=False
                    )
                    total_detected = len(elements)
                    elements = elements_sorted[:max_captions]
                    print(f"Performance profile limit: returning top {max_captions} of {total_detected} elements")
                else:
                    total_detected = len(elements)

                processing_time = (time.time() - start_time) * 1000

                result = {
                    "elements": elements,
                    "count": len(elements),
                    "total_detected": total_detected,
                    "processing_time_ms": round(processing_time, 2),
                    "image_size": {"width": w, "height": h},
                    "device": self.device,
                    "ocr_detected": len(ocr_text) if include_ocr else 0,
                    "icon_detected": sum(1 for e in elements if e['type'] == 'icon'),
                    "text_detected": sum(1 for e in elements if e['type'] == 'text'),
                    "interactable_count": sum(1 for e in elements if e['interactable']),
                }

                if include_som and som_image_b64:
                    result["som_image"] = som_image_b64

                return result

            except Exception as e:
                print(f"Warning: Full OmniParser pipeline failed: {e}")
                print(f"  Error type: {type(e).__name__}")
                if 'parsed_content_list' in locals():
                    print(f"  parsed_content_list type: {type(parsed_content_list)}")
                    print(f"  parsed_content_list length: {len(parsed_content_list) if isinstance(parsed_content_list, list) else 'N/A'}")
                    if isinstance(parsed_content_list, list) and len(parsed_content_list) > 0:
                        print(f"  First element type: {type(parsed_content_list[0])}")
                        print(f"  First element preview: {str(parsed_content_list[0])[:200]}")
                print(f"Falling back to basic detection")
                # Fall through to basic detection

        # Fallback to basic detection if full pipeline unavailable
        return self.parse_screenshot(image, include_captions, include_som, conf_threshold)

    def parse_screenshot(
        self,
        image: np.ndarray,
        include_captions: bool = True,
        include_som: bool = True,
        conf_threshold: Optional[float] = None
    ) -> Dict[str, Any]:
        """
        Parse UI screenshot to detect and caption elements (BASIC method).

        For production use, prefer parse_screenshot_full() which includes OCR,
        interactivity detection, overlap filtering, and batch processing.

        Args:
            image: Input screenshot as numpy array (RGB)
            include_captions: Whether to generate captions for elements
            include_som: Whether to generate Set-of-Mark annotated image
            conf_threshold: Detection confidence threshold

        Returns:
            Dictionary with detected elements and metadata
        """
        start_time = time.time()

        # Detect icons/elements
        detections = self.detect_icons(image, conf_threshold)

        # Generate captions if requested
        if include_captions:
            for detection in detections:
                try:
                    caption = self.caption_element(image, detection["bbox"])
                    detection["caption"] = caption
                except Exception as e:
                    print(f"Error: Failed to caption element: {e}")
                    print(f"Full traceback:\n{traceback.format_exc()}")
                    detection["caption"] = "interactive element"

        # Generate SOM annotated image if requested
        som_image = None
        if include_som:
            som_image = self.generate_som_image(image, detections)

        processing_time = (time.time() - start_time) * 1000  # Convert to ms

        result = {
            "elements": detections,
            "count": len(detections),
            "processing_time_ms": round(processing_time, 2),
            "image_size": {"width": image.shape[1], "height": image.shape[0]},
            "device": self.device
        }

        if som_image:
            result["som_image"] = som_image

        return result


# Global model instance (lazy loaded)
_model_instance: Optional[OmniParserV2] = None


def get_model() -> OmniParserV2:
    """Get or create global OmniParser model instance."""
    global _model_instance
    if _model_instance is None:
        _model_instance = OmniParserV2()
    return _model_instance
