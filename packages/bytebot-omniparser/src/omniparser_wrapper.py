"""OmniParser model wrapper for UI element detection and captioning."""

import time
import sys
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

from .config import settings


class OmniParserV2:
    """OmniParser v2.0 wrapper for UI element detection."""

    def __init__(self):
        """Initialize OmniParser models."""
        self.device = settings.device
        self.dtype = self._get_dtype()

        print(f"Loading OmniParser models on {self.device}...")

        # Load YOLO icon detection model
        self.icon_detector = self._load_icon_detector()

        # Load Florence-2 caption model
        self.caption_model, self.caption_processor = self._load_caption_model()

        print("✓ OmniParser models loaded successfully")

    def _get_dtype(self) -> torch.dtype:
        """Get torch dtype from config."""
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

    def parse_screenshot(
        self,
        image: np.ndarray,
        include_captions: bool = True,
        conf_threshold: Optional[float] = None
    ) -> Dict[str, Any]:
        """
        Parse UI screenshot to detect and caption elements.

        Args:
            image: Input screenshot as numpy array (RGB)
            include_captions: Whether to generate captions for elements
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
                    print(f"Warning: Failed to caption element: {e}")
                    detection["caption"] = "interactive element"

        processing_time = (time.time() - start_time) * 1000  # Convert to ms

        return {
            "elements": detections,
            "count": len(detections),
            "processing_time_ms": round(processing_time, 2),
            "image_size": {"width": image.shape[1], "height": image.shape[0]},
            "device": self.device
        }


# Global model instance (lazy loaded)
_model_instance: Optional[OmniParserV2] = None


def get_model() -> OmniParserV2:
    """Get or create global OmniParser model instance."""
    global _model_instance
    if _model_instance is None:
        _model_instance = OmniParserV2()
    return _model_instance
