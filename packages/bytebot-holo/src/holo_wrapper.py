"""Holo 1.5-7B model wrapper for UI localization."""

import time
import re
import io
import base64
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
import torch
import numpy as np
from PIL import Image

from transformers import AutoModelForImageTextToText, AutoProcessor
from transformers.models.qwen2_vl.image_processing_qwen2_vl import smart_resize

from .config import settings


class Holo15:
    """Holo 1.5-7B wrapper for UI element localization."""

    def __init__(self):
        """Initialize Holo 1.5-7B model."""
        self.device = settings.device
        self.dtype = self._get_dtype()
        self.model_name = "Hcompany/Holo1.5-7B"

        print(f"Loading Holo 1.5-7B on {self.device} with dtype={self.dtype}...")
        print(f"  Model: {self.model_name}")

        # Load model and processor
        self.model, self.processor = self._load_model()

        print(f"✓ Holo 1.5-7B loaded successfully (device={self.device}, dtype={self.dtype})")

    def _get_dtype(self) -> torch.dtype:
        """Get torch dtype from config."""
        # Holo 1.5 works best with bfloat16 (Qwen2.5-VL base)
        # Fall back to float16 for older GPUs, float32 for MPS
        if self.device == "mps":
            print("  ℹ️  MPS detected: Using float32")
            return torch.float32

        dtype_map = {
            "float16": torch.float16,
            "float32": torch.float32,
            "bfloat16": torch.bfloat16,
        }

        # Default to bfloat16 for Holo 1.5 if not specified
        requested_dtype = settings.model_dtype
        if requested_dtype not in dtype_map:
            print(f"  ℹ️  Unknown dtype '{requested_dtype}', using bfloat16")
            return torch.bfloat16

        return dtype_map[requested_dtype]

    def _load_model(self) -> Tuple[AutoModelForImageTextToText, AutoProcessor]:
        """Load Holo 1.5-7B model and processor."""
        try:
            # Load processor first
            processor = AutoProcessor.from_pretrained(
                self.model_name,
                trust_remote_code=True
            )

            # Load model with optimizations
            model = AutoModelForImageTextToText.from_pretrained(
                self.model_name,
                torch_dtype=self.dtype,
                device_map="auto",  # Automatic device placement
                trust_remote_code=True,
                attn_implementation="flash_attention_2" if self.device == "cuda" else "sdpa",  # Flash Attention 2 for CUDA
            ).eval()  # Set to eval mode

            return model, processor

        except Exception as e:
            print(f"✗ Failed to load Holo 1.5-7B: {e}")
            print(f"  Attempting fallback without Flash Attention...")

            # Fallback without Flash Attention
            processor = AutoProcessor.from_pretrained(
                self.model_name,
                trust_remote_code=True
            )

            model = AutoModelForImageTextToText.from_pretrained(
                self.model_name,
                torch_dtype=self.dtype,
                device_map="auto",
                trust_remote_code=True,
            ).eval()

            return model, processor

    def _smart_resize_image(self, image: Image.Image) -> Tuple[Image.Image, Dict[str, float]]:
        """
        Apply smart_resize to image for coordinate alignment.

        Args:
            image: PIL Image

        Returns:
            Tuple of (resized_image, scale_factors)
        """
        original_size = image.size  # (width, height)

        # Calculate optimal dimensions using smart_resize
        # Note: PIL uses (width, height), but smart_resize expects (height, width)
        # and returns (new_height, new_width)
        new_height, new_width = smart_resize(
            height=original_size[1],  # Convert PIL width,height to height,width
            width=original_size[0],
            factor=28,  # Qwen2.5-VL uses 28x28 patches
            min_pixels=256 * 28 * 28,  # Minimum resolution
            max_pixels=1280 * 28 * 28  # Maximum resolution (Qwen2.5-VL default)
        )

        # Actually resize the image to calculated dimensions
        resized_image = image.resize((new_width, new_height), Image.Resampling.LANCZOS)

        # Calculate scale factors for coordinate conversion
        scale_factors = {
            'width_scale': original_size[0] / new_width,
            'height_scale': original_size[1] / new_height,
            'original_width': original_size[0],
            'original_height': original_size[1],
            'resized_width': new_width,
            'resized_height': new_height,
        }

        return resized_image, scale_factors

    def _parse_coordinates(self, text: str) -> Optional[Tuple[int, int]]:
        """
        Parse coordinates from model output.

        Expected formats:
        - "Click(x, y)"
        - "Click(352, 348)"
        - "(x, y)"

        Args:
            text: Model output text

        Returns:
            Tuple of (x, y) or None if parsing fails
        """
        # Try multiple regex patterns
        patterns = [
            r"Click\((\d+),\s*(\d+)\)",  # Click(x, y)
            r"\((\d+),\s*(\d+)\)",       # (x, y)
            r"x[:\s]*(\d+)[,\s]+y[:\s]*(\d+)",  # x: 123, y: 456
            r"(\d+)[,\s]+(\d+)",         # Just two numbers
        ]

        for pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                try:
                    x, y = int(match.group(1)), int(match.group(2))
                    return (x, y)
                except (ValueError, IndexError):
                    continue

        return None

    def localize_element(
        self,
        image: np.ndarray,
        task_instruction: str,
        guidelines: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Localize a UI element using Holo 1.5-7B.

        Args:
            image: Input image as numpy array (RGB)
            task_instruction: Task description (e.g., "Click the submit button")
            guidelines: Optional guidelines for the model

        Returns:
            Detection dict with coordinates, or None if localization fails
        """
        try:
            # Convert to PIL Image
            pil_image = Image.fromarray(image)

            # Apply smart resize for coordinate alignment
            resized_image, scale_factors = self._smart_resize_image(pil_image)
        except Exception as e:
            print(f"✗ Holo error in image preprocessing: {e}")
            return None

        try:
            # Prepare prompt with guidelines
            if guidelines is None:
                guidelines = settings.holo_guidelines

            prompt_text = f"{guidelines}\n{task_instruction}" if guidelines else task_instruction

            # Prepare messages for chat template
            messages = [{
                "role": "user",
                "content": [
                    {"type": "image", "image": resized_image},
                    {"type": "text", "text": prompt_text}
                ]
            }]

            # Apply chat template
            text = self.processor.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True
            )

            # Process inputs
            inputs = self.processor(
                text=[text],
                images=[resized_image],
                return_tensors="pt",
                padding=True
            ).to(self.model.device)

            # Generate coordinates
            with torch.no_grad():
                generated_ids = self.model.generate(
                    **inputs,
                    max_new_tokens=settings.max_new_tokens,
                    do_sample=False,  # Deterministic
                )

            # Decode output
            generated_ids_trimmed = [
                out_ids[len(in_ids):] for in_ids, out_ids in zip(inputs.input_ids, generated_ids)
            ]
            output_text = self.processor.batch_decode(
                generated_ids_trimmed,
                skip_special_tokens=True,
                clean_up_tokenization_spaces=False
            )[0]

            # Parse coordinates from output
            coords = self._parse_coordinates(output_text)

            if coords is None:
                print(f"  Warning: Failed to parse coordinates from output: {output_text}")
                return None

            # Scale coordinates back to original image size
            x, y = coords
            original_x = int(x * scale_factors['width_scale'])
            original_y = int(y * scale_factors['height_scale'])

            # Validate coordinates are within bounds
            if not (0 <= original_x <= scale_factors['original_width'] and
                    0 <= original_y <= scale_factors['original_height']):
                print(f"  Warning: Coordinates out of bounds: ({original_x}, {original_y})")
                # Clamp to bounds
                original_x = max(0, min(original_x, int(scale_factors['original_width'])))
                original_y = max(0, min(original_y, int(scale_factors['original_height'])))

            # Create bounding box around click point (configurable size)
            box_size = settings.click_box_size
            half_size = box_size // 2

            bbox_x = max(0, original_x - half_size)
            bbox_y = max(0, original_y - half_size)
            bbox_width = box_size
            bbox_height = box_size

            # Ensure bbox doesn't exceed image bounds
            if bbox_x + bbox_width > scale_factors['original_width']:
                bbox_width = int(scale_factors['original_width']) - bbox_x
            if bbox_y + bbox_height > scale_factors['original_height']:
                bbox_height = int(scale_factors['original_height']) - bbox_y

            detection = {
                "bbox": [bbox_x, bbox_y, bbox_width, bbox_height],
                "center": [original_x, original_y],
                "confidence": settings.default_confidence,  # Holo doesn't provide confidence
                "type": "clickable",
                "caption": task_instruction,
                "interactable": True,
                "content": task_instruction,
                "source": "holo-localization",
                "raw_output": output_text,
            }

            return detection
        except Exception as e:
            print(f"✗ Holo error during localization (task: '{task_instruction}'): {e}")
            return None

    def detect_multiple_elements(
        self,
        image: np.ndarray,
        detection_prompts: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Detect multiple UI elements using multiple localization prompts.

        Args:
            image: Input image as numpy array (RGB)
            detection_prompts: List of prompts to try (default from settings)

        Returns:
            List of detected elements
        """
        if detection_prompts is None:
            detection_prompts = settings.detection_prompts

        detections = []
        seen_coords = set()

        for prompt in detection_prompts:
            try:
                detection = self.localize_element(image, prompt)

                if detection is not None:
                    # Deduplicate based on center coordinates
                    center = tuple(detection["center"])

                    # Check if we've seen a similar coordinate
                    is_duplicate = False
                    for seen_coord in seen_coords:
                        distance = ((center[0] - seen_coord[0]) ** 2 +
                                  (center[1] - seen_coord[1]) ** 2) ** 0.5
                        if distance < settings.deduplication_radius:
                            is_duplicate = True
                            break

                    if not is_duplicate:
                        seen_coords.add(center)
                        detection["element_id"] = len(detections)
                        detections.append(detection)

            except Exception as e:
                print(f"  Warning: Failed to localize with prompt '{prompt}': {e}")
                continue

        return detections

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
            Base64 encoded annotated image, or None if annotation fails
        """
        try:
            from PIL import ImageDraw, ImageFont

            # Convert to PIL
            pil_image = Image.fromarray(image)
            draw = ImageDraw.Draw(pil_image)

            # Try to load a font
            try:
                font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 20)
            except:
                font = ImageFont.load_default()

            # Draw boxes and labels
            for i, det in enumerate(detections):
                x, y, w, h = det["bbox"]

                # Draw rectangle
                draw.rectangle(
                    [(x, y), (x + w, y + h)],
                    outline="red",
                    width=3
                )

                # Draw label
                label = str(i)
                draw.text((x + 5, y + 5), label, fill="red", font=font)

            # Convert to base64
            buffered = io.BytesIO()
            pil_image.save(buffered, format="PNG")
            encoded_image = base64.b64encode(buffered.getvalue()).decode('ascii')

            return encoded_image

        except Exception as e:
            print(f"Warning: Failed to generate SOM image: {e}")
            return None

    def parse_screenshot(
        self,
        image: np.ndarray,
        task: Optional[str] = None,
        detect_multiple: bool = True,
        include_som: bool = True,
    ) -> Dict[str, Any]:
        """
        Parse UI screenshot using Holo 1.5-7B.

        Args:
            image: Input screenshot as numpy array (RGB)
            task: Optional specific task instruction (single element mode)
            detect_multiple: Whether to detect multiple elements (default: True)
            include_som: Whether to generate Set-of-Mark annotated image

        Returns:
            Dictionary with detected elements and metadata
        """
        start_time = time.time()

        if task:
            # Single element mode: localize specific task
            detection = self.localize_element(image, task)
            detections = [detection] if detection else []
        elif detect_multiple:
            # Multi-element mode: run multiple detection prompts
            detections = self.detect_multiple_elements(image)
        else:
            # Default to multi-element mode
            detections = self.detect_multiple_elements(image)

        # Generate SOM annotated image if requested
        som_image = None
        if include_som and detections:
            som_image = self.generate_som_image(image, detections)

        processing_time = (time.time() - start_time) * 1000  # Convert to ms

        # Log detection result for visibility
        if detections:
            print(f"✓ Holo detected {len(detections)} element(s) in {processing_time:.1f}ms")
        else:
            print(f"⚠ Holo found 0 elements (task: {task}, detect_multiple: {detect_multiple})")

        result = {
            "elements": detections,
            "count": len(detections),
            "processing_time_ms": round(processing_time, 2),
            "image_size": {"width": image.shape[1], "height": image.shape[0]},
            "device": self.device,
        }

        if som_image:
            result["som_image"] = som_image

        return result


# Global model instance (lazy loaded)
_model_instance: Optional[Holo15] = None


def get_model() -> Holo15:
    """Get or create global Holo 1.5-7B model instance."""
    global _model_instance
    if _model_instance is None:
        _model_instance = Holo15()
    return _model_instance
