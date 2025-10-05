"""Holo 1.5-7B model wrapper for UI localization using GGUF quantized models."""

import time
import re
import io
import base64
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
import numpy as np
from PIL import Image

try:
    from llama_cpp import Llama
    from llama_cpp.llama_chat_format import Qwen25VLChatHandler
except ImportError:
    raise ImportError(
        "llama-cpp-python is required for GGUF model support. "
        "Install with: pip install llama-cpp-python"
    )

from .config import settings


class Holo15:
    """Holo 1.5-7B wrapper for UI element localization using GGUF quantized models."""

    def __init__(self):
        """Initialize Holo 1.5-7B GGUF model."""
        self.device = settings.device
        self.model_repo = "mradermacher/Holo1.5-7B-GGUF"

        # Select quantization level based on device and memory
        # Q4_K_M: 4.8GB, best balance of quality and size
        # Q8_0: 8.2GB, best quality
        # Q4_K_S: 4.6GB, smallest with good quality
        self.model_filename = "Holo1.5-7B.Q4_K_M.gguf"
        self.mmproj_filename = "mmproj-Q8_0.gguf"

        # Model name and dtype for status endpoint compatibility
        self.model_name = f"{self.model_repo}/{self.model_filename}"
        self.dtype = "Q4_K_M (4-bit quantization)"

        print(f"Loading Holo 1.5-7B GGUF on {self.device}...")
        print(f"  Model: {self.model_repo}")
        print(f"  Quantization: {self.model_filename}")
        print(f"  Projector: {self.mmproj_filename}")

        # Load model and projector
        self.model, self.chat_handler = self._load_model()

        print(f"✓ Holo 1.5-7B GGUF loaded successfully (device={self.device})")

    def _get_n_gpu_layers(self) -> int:
        """Get number of layers to offload to GPU based on device."""
        if self.device == "cuda":
            # NVIDIA: Offload all layers to GPU
            return -1
        elif self.device == "mps":
            # Apple Silicon: Offload all layers to Metal
            return -1
        else:
            # CPU: No GPU layers
            return 0

    def _get_mmproj_gpu_layers(self) -> int:
        """Determine GPU offload for multimodal projector/CLIP encoder."""
        return -1 if self.device in {"cuda", "mps"} else 0

    def _load_model(self) -> Tuple[Llama, Qwen25VLChatHandler]:
        """Load Holo 1.5-7B GGUF model and multimodal projector."""
        try:
            # Initialize chat handler with multimodal projector
            chat_handler = Qwen25VLChatHandler.from_pretrained(
                repo_id=self.model_repo,
                filename=f"*{self.mmproj_filename}*",
            )

            # Load quantized model with automatic GPU offloading
            model = Llama.from_pretrained(
                repo_id=self.model_repo,
                filename=f"*{self.model_filename}*",
                chat_handler=chat_handler,
                n_ctx=8192,  # Increased context for images + prompts
                n_gpu_layers=self._get_n_gpu_layers(),
                mmproj_n_gpu_layers=self._get_mmproj_gpu_layers(),
                vision_device=self.device if self.device in {"cuda", "mps"} else "cpu",
                verbose=False,
            )

            return model, chat_handler

        except Exception as e:
            print(f"✗ Failed to load Holo 1.5-7B GGUF: {e}")
            raise

    def _smart_resize_image(self, image: Image.Image, max_pixels: int = 1280 * 28 * 28) -> Tuple[Image.Image, Dict[str, float]]:
        """
        Apply smart resize to image for coordinate alignment.

        Args:
            image: PIL Image
            max_pixels: Maximum number of pixels (default: 1280 * 28 * 28 for Qwen2.5-VL)

        Returns:
            Tuple of (resized_image, scale_factors)
        """
        original_size = image.size  # (width, height)
        original_pixels = original_size[0] * original_size[1]

        # If image is within limits, no resize needed
        if original_pixels <= max_pixels:
            return image, {
                'width_scale': 1.0,
                'height_scale': 1.0,
                'original_width': original_size[0],
                'original_height': original_size[1],
                'resized_width': original_size[0],
                'resized_height': original_size[1],
            }

        # Calculate resize factor to fit within max_pixels
        scale = (max_pixels / original_pixels) ** 0.5
        new_width = int(original_size[0] * scale)
        new_height = int(original_size[1] * scale)

        # Resize to nearest multiple of 28 (Qwen2.5-VL patch size)
        new_width = (new_width // 28) * 28
        new_height = (new_height // 28) * 28

        # Actually resize the image
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

    def _parse_description(self, text: str) -> Optional[str]:
        """
        Parse description from model output.

        Expected format: "Click(x, y) - <description>"

        Args:
            text: Model output text

        Returns:
            Description string or None if not found
        """
        # Look for description after coordinates
        desc_patterns = [
            r"Click\(\d+,\s*\d+\)\s*[-–—:]\s*(.+?)(?:\n|$)",  # Click(x, y) - description
            r"\(\d+,\s*\d+\)\s*[-–—:]\s*(.+?)(?:\n|$)",      # (x, y) - description
        ]

        for pattern in desc_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                desc = match.group(1).strip()
                # Clean up common suffixes
                desc = re.sub(r'\.$', '', desc)  # Remove trailing period
                return desc if desc else None

        return None

    def localize_element(
        self,
        image: np.ndarray,
        task_instruction: str,
        guidelines: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Localize a UI element using Holo 1.5-7B GGUF.

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

            # Convert image to base64 for llama-cpp-python
            buffered = io.BytesIO()
            resized_image.save(buffered, format="PNG")
            image_b64 = base64.b64encode(buffered.getvalue()).decode('ascii')
            image_url = f"data:image/png;base64,{image_b64}"

            # Create chat completion with image
            response = self.model.create_chat_completion(
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "image_url", "image_url": {"url": image_url}},
                            {"type": "text", "text": prompt_text}
                        ]
                    }
                ],
                max_tokens=settings.max_new_tokens,
                temperature=0.0,  # Deterministic
            )

            # Extract output text
            output_text = response["choices"][0]["message"]["content"]

            # Parse coordinates from output
            coords = self._parse_coordinates(output_text)

            if coords is None:
                print(f"  Warning: Failed to parse coordinates from output: {output_text}")
                return None

            # Parse description from output (e.g., "Click(x, y) - blue Settings button")
            description = self._parse_description(output_text)

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

            # Use parsed description if available, otherwise fall back to task instruction
            element_caption = description if description else task_instruction

            detection = {
                "bbox": [bbox_x, bbox_y, bbox_width, bbox_height],
                "center": [original_x, original_y],
                "confidence": settings.default_confidence,  # Holo doesn't provide confidence
                "type": "clickable",
                "caption": element_caption,
                "interactable": True,
                "content": element_caption,
                "source": "holo-localization",
                "raw_output": output_text,
                "task": task_instruction,  # Store original task for reference
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
        Parse UI screenshot using Holo 1.5-7B GGUF.

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
