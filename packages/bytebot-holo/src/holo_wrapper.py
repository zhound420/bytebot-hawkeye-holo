"""Holo 1.5-7B model wrapper using official transformers implementation."""

import base64
import io
import json
import time
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple
import numpy as np
from PIL import Image
import torch

try:
    from transformers import AutoProcessor, AutoModelForImageTextToText
    from transformers.models.qwen2_vl.image_processing_qwen2_vl import smart_resize
except ImportError:
    raise ImportError(
        "transformers is required for official Holo 1.5 implementation. "
        "Install with: pip install transformers>=4.40.0"
    )

from .config import settings, OFFICIAL_SYSTEM_PROMPT, DESKTOP_SYSTEM_PROMPT, NavigationStep


class Holo15:
    """
    Holo 1.5-7B wrapper using official transformers backend.
    Based on the HuggingFace Hcompany/Holo1.5-Navigation demo.
    """

    def __init__(self):
        """Initialize Holo 1.5-7B using transformers."""
        self.device = settings.device
        self.model_repo = settings.model_repo

        # Determine torch dtype
        if settings.torch_dtype == "auto":
            # Auto-select based on device
            if self.device == "cuda":
                self.torch_dtype = torch.bfloat16  # Best for modern NVIDIA GPUs
            elif self.device == "mps":
                self.torch_dtype = torch.float32  # MPS doesn't support bfloat16
            else:
                self.torch_dtype = torch.float32  # CPU fallback
        elif settings.torch_dtype == "bfloat16":
            self.torch_dtype = torch.bfloat16
        elif settings.torch_dtype == "float16":
            self.torch_dtype = torch.float16
        else:
            self.torch_dtype = torch.float32

        print(f"Loading Holo 1.5-7B (transformers) on {self.device}...")
        print(f"  Model repo: {self.model_repo}")
        print(f"  Torch dtype: {self.torch_dtype}")
        print(f"  Trust remote code: {settings.trust_remote_code}")

        # Load model and processor
        self.model, self.processor = self._load_model()

        print(f"✓ Holo 1.5-7B loaded successfully (device={self.device}, dtype={self.torch_dtype})")

    def _load_model(self) -> Tuple[AutoModelForImageTextToText, AutoProcessor]:
        """Load model and processor using official transformers API."""
        try:
            # Load processor
            processor = AutoProcessor.from_pretrained(
                self.model_repo,
                trust_remote_code=settings.trust_remote_code,
                cache_dir=str(settings.cache_dir) if settings.cache_models else None,
            )

            # Fix for decoder_config.to_dict() bug in transformers 4.49.0+
            # Load config and ensure decoder_config is a proper config object
            from transformers import AutoConfig
            from transformers.models.qwen2.configuration_qwen2 import Qwen2Config
            config = AutoConfig.from_pretrained(
                self.model_repo,
                trust_remote_code=settings.trust_remote_code,
                cache_dir=str(settings.cache_dir) if settings.cache_models else None,
            )

            # Convert dict configs to proper config objects (CRITICAL for text generation)
            # text_config must be Qwen2Config, not generic PretrainedConfig
            if hasattr(config, 'text_config') and isinstance(config.text_config, dict):
                config.text_config = Qwen2Config(**config.text_config)

            if hasattr(config, 'vision_config') and isinstance(config.vision_config, dict):
                from transformers.models.qwen2_5_vl.configuration_qwen2_5_vl import Qwen2_5_VLVisionConfig
                config.vision_config = Qwen2_5_VLVisionConfig(**config.vision_config)

            # Load model with fixed config
            model = AutoModelForImageTextToText.from_pretrained(
                self.model_repo,
                config=config,
                torch_dtype=self.torch_dtype,
                trust_remote_code=settings.trust_remote_code,
                cache_dir=str(settings.cache_dir) if settings.cache_models else None,
            )

            # Move model to device
            if self.device == "cuda":
                model = model.to("cuda")
                # Verify GPU is actually being used
                if torch.cuda.is_available():
                    gpu_name = torch.cuda.get_device_name(0)
                    total_mem = torch.cuda.get_device_properties(0).total_memory / (1024 ** 3)
                    print(f"✓ Model loaded on GPU: {gpu_name} ({total_mem:.1f}GB VRAM)")
            elif self.device == "mps":
                model = model.to("mps")
                print("✓ Model loaded on Apple Silicon MPS")
            else:
                # CPU mode
                print("⚠ Model loaded on CPU (slower inference)")

            return model, processor

        except Exception as e:
            print(f"✗ Failed to load Holo 1.5-7B: {e}")
            raise

    def _smart_resize_image(
        self,
        image: Image.Image,
    ) -> Tuple[Image.Image, Dict[str, float]]:
        """
        Apply smart resize to image using official Qwen2.5-VL logic.

        This ensures coordinates from the model match the resized image dimensions.

        Args:
            image: PIL Image

        Returns:
            Tuple of (resized_image, scale_factors)
        """
        original_width, original_height = image.size

        # Get processor config
        image_proc_config = self.processor.image_processor

        # Use official smart_resize from Qwen2.5-VL
        resized_height, resized_width = smart_resize(
            height=original_height,
            width=original_width,
            factor=image_proc_config.patch_size * image_proc_config.merge_size,
            min_pixels=image_proc_config.min_pixels,
            max_pixels=image_proc_config.max_pixels,
        )

        # Resize image
        resized_image = image.resize(
            size=(resized_width, resized_height),
            resample=Image.Resampling.LANCZOS,
        )

        # Calculate scale factors for coordinate conversion
        scale_factors = {
            'width_scale': original_width / resized_width,
            'height_scale': original_height / resized_height,
            'original_width': original_width,
            'original_height': original_height,
            'resized_width': resized_width,
            'resized_height': resized_height,
        }

        print(f"  Smart resize: {original_width}x{original_height} → {resized_width}x{resized_height}")
        print(f"  Scale factors: width={scale_factors['width_scale']:.3f}, height={scale_factors['height_scale']:.3f}")

        return resized_image, scale_factors

    def get_navigation_prompt(
        self,
        task: str,
        image: Image.Image,
        step: int = 1,
        use_desktop_prompt: bool = True,  # Default to desktop prompt for Bytebot
        platform: str = "desktop",  # Platform hint: windows/macos/linux/desktop/web
    ) -> List[Dict[str, Any]]:
        """
        Create the navigation prompt using official or desktop-optimized format.

        Args:
            task: The task to complete (e.g., "Find the search bar")
            image: PIL Image of the screenshot
            step: Current step number
            use_desktop_prompt: Use DESKTOP_SYSTEM_PROMPT (True) or OFFICIAL_SYSTEM_PROMPT (False)
            platform: Platform context (windows/macos/linux/desktop/web)

        Returns:
            List of message dicts for the model
        """
        # Select system prompt based on context (Phase 2.1 - desktop optimization)
        base_prompt = DESKTOP_SYSTEM_PROMPT if use_desktop_prompt else OFFICIAL_SYSTEM_PROMPT

        # Detect platform if not specified
        if platform == "desktop":
            import platform as platform_module
            system = platform_module.system().lower()
            if system == "darwin":
                platform = "macOS"
            elif system == "windows":
                platform = "Windows"
            elif system == "linux":
                platform = "Linux"
            else:
                platform = "desktop"

        # Format system prompt with output schema and platform context
        system_prompt = base_prompt.format(
            output_format=NavigationStep.model_json_schema(),
            timestamp=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            platform=platform,  # Add platform context
        )

        # Build messages in official format
        messages = [
            {
                "role": "system",
                "content": [
                    {"type": "text", "text": system_prompt},
                ],
            },
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": f"<task>\n{task}\n</task>\n"},
                    {"type": "text", "text": f"<observation step={step}>\n"},
                    {"type": "text", "text": "<screenshot>\n"},
                    {"type": "image", "image": image},
                    {"type": "text", "text": "\n</screenshot>\n"},
                    {"type": "text", "text": "\n</observation>\n"},
                ],
            },
        ]

        return messages

    def run_inference(
        self,
        messages: List[Dict[str, Any]],
        image: Image.Image,
        max_new_tokens: Optional[int] = None,
    ) -> str:
        """
        Run inference using the official transformers pipeline.

        Args:
            messages: Message list from get_navigation_prompt()
            image: Resized PIL Image
            max_new_tokens: Maximum tokens to generate (default: settings.max_new_tokens)

        Returns:
            Raw model output string
        """
        start_time = time.time()

        # Use settings value if not provided (256-1024 depending on profile)
        if max_new_tokens is None:
            max_new_tokens = settings.max_new_tokens

        # Apply chat template to messages
        text_prompt = self.processor.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True,
        )

        # Process text and image together
        inputs = self.processor(
            text=[text_prompt],
            images=[image],
            padding=True,
            return_tensors="pt",
        )

        # Move inputs to device
        inputs = inputs.to(self.model.device)

        # Generate response
        # Using do_sample=False for deterministic output (matches official demo)
        generated_ids = self.model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=False,  # Greedy decoding for consistency
        )

        # Trim input_ids from generated_ids to get only generated part
        generated_ids_trimmed = [
            out_ids[len(in_ids):]
            for in_ids, out_ids in zip(inputs.input_ids, generated_ids)
        ]

        # Decode generated tokens
        decoded_output = self.processor.batch_decode(
            generated_ids_trimmed,
            skip_special_tokens=True,
            clean_up_tokenization_spaces=False,
        )

        inference_time = (time.time() - start_time) * 1000
        output = decoded_output[0] if decoded_output else ""

        print(f"  Model inference: {inference_time:.1f}ms, Output length: {len(output)} chars")

        return output

    def navigate(
        self,
        image_array: np.ndarray,
        task: str,
        step: int = 1,
    ) -> tuple[NavigationStep, Dict[str, Any]]:
        """
        Main navigation function - analyze screenshot and return next action.

        Args:
            image_array: Screenshot as numpy array
            task: Task description (e.g., "Find the search bar")
            step: Current step number

        Returns:
            Tuple of (NavigationStep, timing_dict) with detailed timing breakdown
        """
        timing = {}

        # Convert to PIL Image
        start = time.time()
        pil_image = Image.fromarray(np.uint8(image_array))
        timing['convert_ms'] = (time.time() - start) * 1000

        # Apply smart resize
        start = time.time()
        resized_image, scale_factors = self._smart_resize_image(pil_image)
        timing['resize_ms'] = (time.time() - start) * 1000

        # Create navigation prompt
        start = time.time()
        messages = self.get_navigation_prompt(task, resized_image, step)
        timing['prompt_ms'] = (time.time() - start) * 1000

        # Run inference
        start = time.time()
        output_str = self.run_inference(messages, resized_image)
        timing['inference_ms'] = (time.time() - start) * 1000
        timing['raw_output'] = output_str
        timing['output_length'] = len(output_str)

        # Parse NavigationStep from output
        start = time.time()
        try:
            navigation_step = self._parse_navigation_step(output_str, scale_factors)
            timing['parse_ms'] = (time.time() - start) * 1000
            timing['parse_status'] = 'success'
        except Exception as e:
            timing['parse_ms'] = (time.time() - start) * 1000
            timing['parse_status'] = 'error'
            timing['parse_error'] = str(e)
            raise

        return navigation_step, timing

    def _parse_navigation_step(
        self,
        output_str: str,
        scale_factors: Dict[str, float],
    ) -> NavigationStep:
        """
        Parse model output into NavigationStep object.

        Args:
            output_str: Raw model output
            scale_factors: Scale factors for coordinate conversion

        Returns:
            Parsed NavigationStep with coordinates scaled back to original image
        """
        # Try to extract JSON from output
        try:
            # Remove markdown code blocks if present
            if "```json" in output_str:
                start = output_str.find("```json") + 7
                end = output_str.find("```", start)
                json_str = output_str[start:end].strip()
            elif "```" in output_str:
                start = output_str.find("```") + 3
                end = output_str.find("```", start)
                json_str = output_str[start:end].strip()
            else:
                json_str = output_str.strip()

            # Parse JSON
            data = json.loads(json_str)

            # Convert to NavigationStep
            navigation_step = NavigationStep(**data)

            # Scale coordinates back to original image size
            self._scale_coordinates(navigation_step.action, scale_factors)

            return navigation_step

        except Exception as e:
            print(f"⚠ Warning: Failed to parse NavigationStep: {e}")
            print(f"  Output: {output_str[:200]}...")

            # Return a fallback NavigationStep
            from .config import AnswerAction
            return NavigationStep(
                note=f"Parsing error: {str(e)}",
                thought="Failed to parse model output",
                action=AnswerAction(
                    action="answer",
                    content=f"Error: {str(e)}"
                )
            )

    def _scale_coordinates(
        self,
        action: Any,
        scale_factors: Dict[str, float],
    ) -> None:
        """
        Scale coordinates in action back to original image dimensions.

        Modifies action in-place.
        """
        # Only scale actions with x, y coordinates
        if hasattr(action, 'x') and hasattr(action, 'y'):
            if action.x is not None and action.y is not None:
                original_x = int(action.x * scale_factors['width_scale'])
                original_y = int(action.y * scale_factors['height_scale'])

                print(f"  Coordinate scaling: ({action.x}, {action.y}) → ({original_x}, {original_y})")

                action.x = original_x
                action.y = original_y

    def detect_multiple_elements(
        self,
        image_array: np.ndarray,
        max_detections: int = 20,
        max_new_tokens: int = 512,  # Increased from 256 for comprehensive detection
    ) -> List[Dict[str, Any]]:
        """
        Detect multiple UI elements using a single comprehensive prompt.

        OPTIMIZATION: Uses ONE navigate() call instead of 4 sequential calls,
        reducing detection time from 8-16s to 2-4s (4× speedup).

        The model analyzes the screenshot comprehensively and returns reasoning
        in the 'thought' field, then provides an 'answer' action with all detected
        elements in structured format.

        Args:
            image_array: Screenshot as numpy array
            max_detections: Maximum elements to return
            max_new_tokens: Token limit for generation (512 for ~20-40 elements)

        Returns:
            List of detected elements with bbox, center, confidence, caption
        """
        # Single comprehensive prompt (Phase 1 optimization)
        # Leverages model's ability to analyze full UI context in one pass
        comprehensive_task = (
            f"Analyze this UI screenshot and identify up to {max_detections} interactive elements. "
            "Include buttons, links, input fields, dropdowns, checkboxes, tabs, menus, icons, and navigation controls. "
            "For each element, note its center coordinates (x, y in pixels) and functional description. "
            "List all elements you can identify in this screenshot, prioritizing the most important interactive controls."
        )

        try:
            # Single navigate() call (4× faster than old approach)
            print(f"  Running comprehensive UI analysis (max {max_detections} elements)...")
            navigation_step, timing = self.navigate(
                image_array=image_array,
                task=comprehensive_task,
                step=1,
            )

            # Log model's reasoning (Phase 2.2 - thought field insights)
            if navigation_step.thought:
                print(f"  Model reasoning: {navigation_step.thought[:120]}...")

            action = navigation_step.action

            # The model should return either:
            # 1. A click_element action with the first/most important element
            # 2. An answer action with structured element list

            elements = []

            # Try to parse structured element list from answer.content
            if action.action == 'answer' and hasattr(action, 'content'):
                elements = self._parse_element_list_from_answer(action.content, max_detections)
                if elements:
                    print(f"  Parsed {len(elements)} elements from comprehensive analysis")
                    return elements

            # Fallback: If model returned a single click action, extract that one element
            if hasattr(action, 'x') and hasattr(action, 'y'):
                if action.x is not None and action.y is not None:
                    element = {
                        "bbox": [action.x - 20, action.y - 20, 40, 40],
                        "center": [action.x, action.y],
                        "confidence": 0.80,  # Higher confidence for comprehensive analysis
                        "type": "clickable",
                        "caption": getattr(action, 'element', navigation_step.thought[:50]),
                        "element_id": 0,
                    }
                    elements.append(element)
                    print(f"  Detected 1 element (fallback mode): {element['caption'][:30]}...")
                    return elements

            # If we got here, model didn't return elements in expected format
            print(f"  ⚠ No elements extracted from model response (action: {action.action})")
            print(f"  Note: {navigation_step.note[:100]}...")
            return []

        except Exception as e:
            print(f"  ✗ Comprehensive detection failed: {str(e)}")
            return []

    def _parse_element_list_from_answer(
        self,
        answer_content: str,
        max_detections: int,
    ) -> List[Dict[str, Any]]:
        """
        Parse structured element list from answer.content.

        Expects format like:
        "Elements detected:
        1. Button at (100, 200): Install button
        2. Input at (150, 300): Username field
        ..."

        Args:
            answer_content: Answer action content from model
            max_detections: Maximum elements to extract

        Returns:
            List of detected elements
        """
        import re

        elements = []

        # Try to parse coordinate patterns like "(123, 456)" or "x=123, y=456"
        # Common patterns:
        # - "at (x, y): description"
        # - "x=123, y=456 - description"
        # - "coordinates: (x, y), label: description"

        # Pattern: captures (x, y) coordinates
        coord_pattern = r'\((\d+),\s*(\d+)\)'
        matches = re.finditer(coord_pattern, answer_content)

        for idx, match in enumerate(matches):
            if idx >= max_detections:
                break

            x = int(match.group(1))
            y = int(match.group(2))

            # Extract description from surrounding text
            # Look for text after the coordinates (next 50 chars)
            start_pos = match.end()
            description_text = answer_content[start_pos:start_pos + 80].strip()

            # Clean up description (remove common prefixes/separators)
            description = description_text.split('\n')[0]  # Take first line
            description = re.sub(r'^[\s\-:,]+', '', description)  # Remove leading separators
            description = description[:50]  # Limit length

            if not description:
                description = f"Element {idx + 1}"

            element = {
                "bbox": [x - 20, y - 20, 40, 40],
                "center": [x, y],
                "confidence": 0.75,
                "type": "clickable",
                "caption": description,
                "element_id": idx,
            }
            elements.append(element)

        return elements

    def generate_som_image(
        self,
        image: Image.Image,
        elements: List[Dict[str, Any]],
    ) -> str:
        """
        Generate Set-of-Mark annotated image with numbered bounding boxes.

        Draws RED boxes with WHITE numbered labels [0], [1], [2]...

        Args:
            image: PIL Image
            elements: List of detected elements with 'center' and 'bbox'

        Returns:
            Base64 encoded PNG image with SOM annotations
        """
        from PIL import ImageDraw, ImageFont

        # Create a copy to draw on
        annotated = image.copy()
        draw = ImageDraw.Draw(annotated)

        # Try to load a font, fall back to default if unavailable
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 16)
        except:
            font = ImageFont.load_default()

        for idx, element in enumerate(elements):
            # Get bounding box
            bbox = element.get("bbox", None)
            center = element.get("center", None)

            if bbox:
                x, y, w, h = bbox
                # Draw red rectangle
                draw.rectangle(
                    [(x, y), (x + w, y + h)],
                    outline="red",
                    width=2,
                )

                # Draw label background (white box)
                label = f"[{idx}]"
                # For default font, estimate text size
                text_width = len(label) * 10
                text_height = 18

                label_x = x
                label_y = max(0, y - text_height - 2)

                draw.rectangle(
                    [(label_x, label_y), (label_x + text_width, label_y + text_height)],
                    fill="white",
                    outline="red",
                    width=1,
                )

                # Draw label text
                draw.text(
                    (label_x + 2, label_y),
                    label,
                    fill="red",
                    font=font,
                )

        # Convert to base64
        buffered = io.BytesIO()
        annotated.save(buffered, format="PNG")
        img_bytes = buffered.getvalue()
        img_base64 = base64.b64encode(img_bytes).decode('utf-8')

        return img_base64

    def parse_screenshot(
        self,
        image_array: np.ndarray,
        task: Optional[str] = None,
        detect_multiple: bool = True,
        include_som: bool = True,
        max_detections: Optional[int] = None,
        min_confidence: Optional[float] = None,
        return_raw_outputs: Optional[bool] = None,
        performance_profile: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Parse UI screenshot using Holo 1.5-7B transformers (backward compatible).

        Supports two modes:
        1. Single-element mode (task provided): Localize specific element
        2. Multi-element mode (detect_multiple=True): Detect multiple elements

        Args:
            image_array: Input screenshot as numpy array (RGB)
            task: Optional specific task instruction (single element mode)
            detect_multiple: Whether to detect multiple elements (default: True)
            include_som: Whether to generate Set-of-Mark annotated image
            max_detections: Optional cap for detections (default: 20)
            min_confidence: Optional confidence floor (ignored for transformers)
            return_raw_outputs: Whether to include raw outputs (not implemented)
            performance_profile: Optional profile (speed/balanced/quality)

        Returns:
            Dictionary with detected elements and metadata (old format)
        """
        start_time = time.time()

        # Default values
        effective_max = max_detections or 20
        profile_key = (performance_profile or 'balanced').lower()

        elements = []
        timing_data = {}
        raw_output = None
        parse_status = 'success'
        parse_error = None

        if task:
            # Single element mode: localize specific task
            print(f"  Single-element mode: task='{task}'")
            navigation_step, timing_data = self.navigate(
                image_array=image_array,
                task=task,
                step=1,
            )

            raw_output = timing_data.get('raw_output')
            parse_status = timing_data.get('parse_status', 'success')
            parse_error = timing_data.get('parse_error')

            action = navigation_step.action

            # Only create element if action has coordinates
            if hasattr(action, 'x') and hasattr(action, 'y'):
                if action.x is not None and action.y is not None:
                    element = {
                        "bbox": [action.x - 20, action.y - 20, 40, 40],
                        "center": [action.x, action.y],
                        "confidence": 0.85,
                        "type": "clickable",
                        "caption": getattr(action, 'element', navigation_step.thought[:50]),
                        "element_id": 0,
                    }
                    elements.append(element)

        elif detect_multiple:
            # Multi-element mode: run multiple detection prompts
            print(f"  Multi-element mode: max_detections={effective_max}")
            elements = self.detect_multiple_elements(
                image_array,
                max_detections=effective_max,
            )

        # Generate SOM annotated image if requested
        som_image = None
        if include_som and elements:
            print(f"  Generating SOM image with {len(elements)} elements...")
            pil_image = Image.fromarray(np.uint8(image_array))
            som_image = self.generate_som_image(pil_image, elements)

        processing_time = (time.time() - start_time) * 1000  # Convert to ms

        # Log detection result
        if elements:
            print(f"✓ Detected {len(elements)} element(s) in {processing_time:.1f}ms")
        else:
            print(f"⚠ Found 0 elements (task={task}, detect_multiple={detect_multiple})")

        result = {
            "elements": elements,
            "count": len(elements),
            "processing_time_ms": round(processing_time, 2),
            "image_size": {"width": image_array.shape[1], "height": image_array.shape[0]},
            "device": self.device,
            "profile": profile_key,
            "max_detections": effective_max,
            "min_confidence": min_confidence if min_confidence is not None else 0.3,
        }

        # Add detailed timing breakdown if available
        if timing_data:
            result["timing"] = {
                "resize_ms": timing_data.get('resize_ms'),
                "inference_ms": timing_data.get('inference_ms'),
                "parse_ms": timing_data.get('parse_ms'),
                "total_ms": round(processing_time, 2),
            }

        # Add raw output and parse status if requested
        if return_raw_outputs and raw_output:
            result["raw_output"] = raw_output
            result["output_length"] = len(raw_output)
            result["parse_status"] = parse_status
            if parse_error:
                result["parse_error"] = parse_error

        if som_image:
            result["som_image"] = som_image

        return result


# Global model instance
_model_instance: Optional[Holo15] = None


def get_model() -> Holo15:
    """Get or create the global model instance."""
    global _model_instance
    if _model_instance is None:
        _model_instance = Holo15()
    return _model_instance
