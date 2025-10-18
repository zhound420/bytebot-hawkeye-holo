"""Holo 1.5-7B model wrapper using official transformers implementation."""

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

from .config import settings, OFFICIAL_SYSTEM_PROMPT, NavigationStep


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

            # Load model
            model = AutoModelForImageTextToText.from_pretrained(
                self.model_repo,
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
    ) -> List[Dict[str, Any]]:
        """
        Create the navigation prompt using official format.

        Args:
            task: The task to complete (e.g., "Find the search bar")
            image: PIL Image of the screenshot
            step: Current step number

        Returns:
            List of message dicts for the model
        """
        # Format system prompt with output schema
        system_prompt = OFFICIAL_SYSTEM_PROMPT.format(
            output_format=NavigationStep.model_json_schema(),
            timestamp=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
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
        max_new_tokens: int = 128,
    ) -> str:
        """
        Run inference using the official transformers pipeline.

        Args:
            messages: Message list from get_navigation_prompt()
            image: Resized PIL Image
            max_new_tokens: Maximum tokens to generate

        Returns:
            Raw model output string
        """
        start_time = time.time()

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
    ) -> NavigationStep:
        """
        Main navigation function - analyze screenshot and return next action.

        Args:
            image_array: Screenshot as numpy array
            task: Task description (e.g., "Find the search bar")
            step: Current step number

        Returns:
            NavigationStep with note, thought, and action
        """
        # Convert to PIL Image
        pil_image = Image.fromarray(np.uint8(image_array))

        # Apply smart resize
        resized_image, scale_factors = self._smart_resize_image(pil_image)

        # Create navigation prompt
        messages = self.get_navigation_prompt(task, resized_image, step)

        # Run inference
        output_str = self.run_inference(messages, resized_image)

        # Parse NavigationStep from output
        navigation_step = self._parse_navigation_step(output_str, scale_factors)

        return navigation_step

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


# Global model instance
_model_instance: Optional[Holo15] = None


def get_model() -> Holo15:
    """Get or create the global model instance."""
    global _model_instance
    if _model_instance is None:
        _model_instance = Holo15()
    return _model_instance
