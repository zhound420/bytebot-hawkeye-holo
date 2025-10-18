"""Holo 1.5-7B model wrapper for UI localization using GGUF quantized models."""

import json
import time
import re
import io
import base64
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

from .config import settings, PERFORMANCE_PROFILES, ADAPTIVE_CONFIDENCE_THRESHOLDS, CONFIDENCE_ZONES


class Holo15:
    """Holo 1.5-7B wrapper for UI element localization using GGUF quantized models."""

    def __init__(self):
        """Initialize Holo 1.5-7B GGUF model."""
        self.device = settings.device
        self.model_repo = settings.model_repo

        # Allow quantization overrides while auto-tuning for capable GPUs
        self.model_filename, self.mmproj_filename, self.dtype = self._select_quantization()

        # Runtime knobs
        self.n_ctx = settings.n_ctx
        self.n_threads = settings.n_threads
        self.n_batch = settings.n_batch
        self.n_gpu_layers = settings.n_gpu_layers if settings.n_gpu_layers is not None else self._get_n_gpu_layers()
        self.mmproj_n_gpu_layers = (
            settings.mmproj_n_gpu_layers
            if settings.mmproj_n_gpu_layers is not None
            else self._get_mmproj_gpu_layers()
        )
        self.temperature = settings.temperature
        self.top_p = settings.top_p
        self.max_retries = max(settings.max_retries, 0)
        self.retry_backoff = max(settings.retry_backoff_seconds, 0.0)

        # Model name and dtype for status endpoint compatibility
        self.model_name = f"{self.model_repo}/{self.model_filename}"

        print(f"Loading Holo 1.5-7B GGUF on {self.device}...")
        print(f"  Model repo: {self.model_repo}")
        print(f"  Model file: {self.model_filename}")
        print(f"  Projector: {self.mmproj_filename}")
        print(f"  Context window: {self.n_ctx}")
        print(
            "  Offload: n_gpu_layers=%s, mmproj_n_gpu_layers=%s"
            % (self.n_gpu_layers, self.mmproj_n_gpu_layers)
        )
        if self.n_threads:
            print(f"  Threads: {self.n_threads}")
        if self.n_batch:
            print(f"  Batch size: {self.n_batch}")

        # Load model and projector
        self.model, self.chat_handler = self._load_model()

        print(f"✓ Holo 1.5-7B GGUF loaded successfully (device={self.device})")

    def _select_quantization(self) -> Tuple[str, str, str]:
        """Select quantization strategy with optional auto-upgrade."""
        if settings.model_path and settings.model_path.exists():
            local_name = settings.model_path.name
            if settings.mmproj_path and settings.mmproj_path.exists():
                mmproj_name = settings.mmproj_path.name
            else:
                mmproj_name = settings.mmproj_filename
            dtype = self._describe_quant(local_name)
            return local_name, mmproj_name, dtype

        requested_model = settings.model_filename.strip()
        requested_mmproj = settings.mmproj_filename.strip()

        auto_requested = requested_model.lower() == "auto"
        model_filename = requested_model

        if auto_requested:
            model_filename = self._auto_select_model_filename()
        elif self.device in {"cuda", "mps"} and requested_model == "Holo1.5-7B.Q4_K_M.gguf":
            upgraded = self._auto_select_model_filename()
            if upgraded != requested_model:
                print(
                    "→ Auto-upgrading quantization based on GPU capacity: "
                    f"{requested_model} → {upgraded}"
                )
                model_filename = upgraded

        if requested_mmproj.lower() == "auto":
            mmproj_filename = "mmproj-Q8_0.gguf"
        else:
            mmproj_filename = requested_mmproj

        dtype = self._describe_quant(model_filename)
        return model_filename, mmproj_filename, dtype

    def _auto_select_model_filename(self) -> str:
        """Heuristically choose the best quantization for the current device."""
        default = "Holo1.5-7B.Q4_K_M.gguf"

        if self.device == "cuda":
            try:
                import torch

                props = torch.cuda.get_device_properties(0)
                total_gb = props.total_memory / (1024 ** 3)
                if total_gb >= 16:
                    print("→ Detected >=16GB VRAM, selecting Q8_0 for max quality")
                    return "Holo1.5-7B.Q8_0.gguf"
                if total_gb >= 10:
                    print("→ Detected >=10GB VRAM, keeping balanced Q4_K_M quantization")
                    return "Holo1.5-7B.Q4_K_M.gguf"
            except Exception as exc:
                print(f"Warning: Unable to inspect CUDA device memory: {exc}")
            return default

        if self.device == "mps":
            # On Apple Silicon the 4-bit model provides the best latency-memory balance
            return "Holo1.5-7B.Q4_K_M.gguf"

        # CPU-only: stick to 4-bit for manageability
        return default

    @staticmethod
    def _describe_quant(model_filename: str) -> str:
        """Human readable quantization description."""
        lookup = {
            "Holo1.5-7B.Q4_K_M.gguf": "Q4_K_M (4-bit quantization)",
            "Holo1.5-7B.Q4_K_S.gguf": "Q4_K_S (compact 4-bit quantization)",
            "Holo1.5-7B.Q8_0.gguf": "Q8_0 (8-bit quantization)",
        }
        return lookup.get(model_filename, model_filename)

    def _get_n_gpu_layers(self) -> int:
        """Get number of layers to offload to GPU based on device with auto-tuning."""
        if self.device == "cuda":
            # NVIDIA: Offload all layers to GPU (tested and working)
            return -1
        elif self.device == "mps":
            # Apple Silicon: Use auto-tuning based on available memory
            # Qwen2.5-VL-7B has ~28 transformer layers
            # Q4_K_M quantization: ~4.8GB model + ~1GB projector
            try:
                import psutil
                available_gb = psutil.virtual_memory().available / (1024 ** 3)

                if available_gb >= 10:
                    # Plenty of memory: offload all layers
                    print(f"  MPS: {available_gb:.1f}GB available, offloading all layers to GPU")
                    return -1
                elif available_gb >= 6:
                    # Moderate memory: offload most layers
                    print(f"  MPS: {available_gb:.1f}GB available, offloading 24/28 layers to GPU")
                    return 24
                else:
                    # Limited memory: offload fewer layers
                    print(f"  MPS: {available_gb:.1f}GB available, offloading 16/28 layers to GPU")
                    return 16
            except ImportError:
                # psutil not available, offload all layers (conservative default)
                print("  MPS: psutil not available, offloading all layers")
                return -1
        else:
            # CPU: No GPU layers
            return 0

    def _get_mmproj_gpu_layers(self) -> int:
        """Determine GPU offload for multimodal projector/CLIP encoder (always offload on GPU)."""
        if self.device in {"cuda", "mps"}:
            # Always offload projector to GPU for best visual understanding
            return -1
        return 0

    def _load_model(self) -> Tuple[Llama, Qwen25VLChatHandler]:
        """Load Holo 1.5-7B GGUF model and multimodal projector."""
        try:
            chat_handler = self._load_chat_handler()

            if settings.model_path and not settings.model_path.exists():
                print(
                    f"⚠ Specified HOLO_MODEL_PATH not found: {settings.model_path}. "
                    "Falling back to Hugging Face download."
                )

            if settings.mmproj_path and not settings.mmproj_path.exists():
                print(
                    f"⚠ Specified HOLO_MMPROJ_PATH not found: {settings.mmproj_path}. "
                    "Falling back to Hugging Face download."
                )

            llama_kwargs = {
                "n_ctx": self.n_ctx,
                "n_gpu_layers": self.n_gpu_layers,
                "mmproj_n_gpu_layers": self.mmproj_n_gpu_layers,
                "vision_device": self.device if self.device in {"cuda", "mps"} else "cpu",
                "verbose": False,
                "chat_handler": chat_handler,
            }

            model_path = settings.model_path

            if model_path and model_path.exists():
                llama_kwargs["model_path"] = str(model_path)
            else:
                kwargs = {
                    "repo_id": self.model_repo,
                    "filename": f"*{self.model_filename}*",
                }
                if settings.cache_models:
                    kwargs["download_dir"] = str(settings.cache_dir)
                llama_kwargs.update(kwargs)

            if self.n_threads is not None:
                llama_kwargs["n_threads"] = self.n_threads
            if self.n_batch is not None:
                llama_kwargs["n_batch"] = self.n_batch

            if "model_path" in llama_kwargs:
                model = Llama(**llama_kwargs)
            else:
                model = Llama.from_pretrained(**llama_kwargs)

            gpu_working = False

            # Validate CUDA with nvidia-smi (llama.cpp uses separate CUDA context from PyTorch)
            if self.device == "cuda":
                try:
                    import subprocess
                    result = subprocess.run(
                        ["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
                        capture_output=True,
                        text=True,
                        timeout=2
                    )
                    if result.returncode == 0:
                        gpu_mem_mb = int(result.stdout.strip().split('\n')[0])
                        if gpu_mem_mb > 100:  # At least 100MB allocated = GPU is working
                            gpu_working = True
                            gpu_mem_gb = gpu_mem_mb / 1024
                            print(f"✓ CUDA GPU acceleration active ({gpu_mem_gb:.1f}GB VRAM in use)")
                except Exception:
                    pass

                if not gpu_working:
                    print(
                        "⚠ CUDA device requested but GPU memory usage not detected. "
                        "If inference is slow, reinstall with CMAKE_ARGS=\"-DLLAMA_CUBLAS=on\" pip install --force-reinstall llama-cpp-python"
                    )

            # Validate MPS (Apple Silicon)
            # Note: MPS doesn't have nvidia-smi equivalent, so we rely on successful model loading
            if self.device == "mps":
                # If model loaded without errors, MPS is working
                print("  MPS (Metal) device configured - validation via model loading")

            print("  llama.cpp runtime parameters:")
            print(f"    context_length: {self.n_ctx}")
            print(f"    n_threads: {getattr(model, 'n_threads', self.n_threads)}")
            print(f"    n_batch: {getattr(model, 'n_batch', self.n_batch)}")
            print(f"    n_gpu_layers: {self.n_gpu_layers}")
            print(f"    mmproj_n_gpu_layers: {self.mmproj_n_gpu_layers}")

            return model, chat_handler

        except Exception as e:
            print(f"✗ Failed to load Holo 1.5-7B GGUF: {e}")
            raise

    def _load_chat_handler(self) -> Qwen25VLChatHandler:
        """Load chat handler, honoring optional local mmproj path."""
        mmproj_path = settings.mmproj_path

        filename_pattern = f"*{self.mmproj_filename}*"
        local_dir: Optional[str] = None
        cache_dir: Optional[str] = None

        if mmproj_path and mmproj_path.exists():
            local_dir = str(mmproj_path.parent)
            filename_pattern = mmproj_path.name
        elif settings.cache_models:
            cache_dir = str(settings.cache_dir)

        return Qwen25VLChatHandler.from_pretrained(
            repo_id=self.model_repo,
            filename=filename_pattern,
            local_dir=local_dir,
            cache_dir=cache_dir,
            local_dir_use_symlinks=False,
        )

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

    def _prepare_image_payload(self, image: np.ndarray) -> Dict[str, Any]:
        """Convert an image into llama-cpp friendly payload + scale metadata."""
        pil_image = Image.fromarray(image)
        resized_image, scale_factors = self._smart_resize_image(pil_image)

        buffered = io.BytesIO()
        resized_image.save(buffered, format="PNG")
        image_b64 = base64.b64encode(buffered.getvalue()).decode('ascii')

        return {
            "image_url": f"data:image/png;base64,{image_b64}",
            "scale_factors": scale_factors,
        }

    def _call_model(self, image_url: str, prompt_text: str, max_tokens: Optional[int] = None) -> str:
        """Invoke the llama.cpp chat completion with standard settings and timing."""
        import time
        start_time = time.time()

        messages = []

        if settings.system_prompt:
            messages.append({"role": "system", "content": settings.system_prompt})

        messages.append(
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": image_url}},
                    {"type": "text", "text": prompt_text},
                ],
            }
        )

        # Use profile-specific max_tokens if provided, otherwise fall back to global setting
        effective_max_tokens = max_tokens if max_tokens is not None else settings.max_new_tokens

        # Debug logging to track token budget (helps diagnose multi-element detection issues)
        if max_tokens is None:
            print(f"⚠ WARNING: max_tokens not provided, using global default: {effective_max_tokens} tokens")
            print(f"   For multi-element detection, recommended: 256+ tokens (SPEED), 512+ (BALANCED), 1024+ (QUALITY)")
        elif effective_max_tokens < 256:
            print(f"⚠ WARNING: max_tokens={effective_max_tokens} is very low for multi-element detection")
            print(f"   Recommended minimum: 256 tokens (current may only support 1-2 elements)")

        completion_kwargs = {
            "messages": messages,
            "max_tokens": effective_max_tokens,
            "temperature": self.temperature,
        }

        if self.top_p is not None:
            completion_kwargs["top_p"] = self.top_p

        response = self.model.create_chat_completion(**completion_kwargs)

        inference_time = (time.time() - start_time) * 1000
        output = response["choices"][0]["message"]["content"]

        print(f"  Model inference: {inference_time:.1f}ms (max_tokens={effective_max_tokens}), Output length: {len(output)} chars")

        return output

    @staticmethod
    def _augment_prompt(prompt_text: str) -> str:
        """Append retry guidance to the prompt."""
        guidance = settings.retry_guidance.strip()
        if not guidance:
            return prompt_text
        return f"{prompt_text}\n\n{guidance}"

    def _build_single_prompt(
        self,
        task_instruction: str,
        scale_factors: Dict[str, float],
        guidelines: str,
    ) -> str:
        """Construct the single-element localization prompt."""
        width = int(scale_factors['resized_width'])
        height = int(scale_factors['resized_height'])

        prompt_parts = [
            guidelines.strip(),
            f"Image resolution: {width}x{height} pixels.",
            f"Task: {task_instruction}",
            settings.single_detection_format.strip(),
        ]

        return "\n\n".join(part for part in prompt_parts if part)

    def _build_multi_prompt(
        self,
        discovery_prompt: str,
        scale_factors: Dict[str, float],
        detection_prompts: List[str],
    ) -> str:
        """Construct the multi-element discovery prompt."""
        width = int(scale_factors['resized_width'])
        height = int(scale_factors['resized_height'])

        # Remove duplicates while keeping order
        seen = set()
        extra_hints = []
        for prompt in detection_prompts:
            normalized = prompt.strip()
            if not normalized or normalized == discovery_prompt or normalized in seen:
                continue
            seen.add(normalized)
            extra_hints.append(f"- {normalized}")

        prompt_parts = [
            settings.holo_guidelines.strip(),
            f"Image resolution: {width}x{height} pixels.",
            discovery_prompt.strip(),
            settings.multi_detection_format.strip(),
        ]

        if extra_hints:
            prompt_parts.append("Additional context hints:\n" + "\n".join(extra_hints))

        return "\n\n".join(part for part in prompt_parts if part)

    def _parse_single_output(
        self,
        output_text: str,
        scale_factors: Dict[str, float],
        task_instruction: str,
    ) -> Optional[Dict[str, Any]]:
        """Parse single-element response using structured JSON fallback to regex."""
        data = self._extract_json_object(output_text)

        candidates: List[Dict[str, Any]] = []
        if isinstance(data, dict):
            if "elements" in data and isinstance(data["elements"], list):
                candidates = [elem for elem in data["elements"] if isinstance(elem, dict)]
            else:
                candidates = [data]
        elif isinstance(data, list):
            candidates = [elem for elem in data if isinstance(elem, dict)]

        for candidate in candidates:
            detection = self._element_dict_to_detection(
                candidate,
                scale_factors,
                task_instruction,
                output_text,
            )
            if detection is not None:
                return detection

        # Regex fallback for legacy formats
        coords = self._parse_coordinates(output_text)
        if coords is None:
            return None

        description = self._parse_description(output_text) or task_instruction

        return self._make_detection(
            coords[0],
            coords[1],
            scale_factors,
            description,
            "clickable",
            output_text,
            task_instruction,
            None,
            None,
        )

    def _parse_multi_output(
        self,
        output_text: str,
        scale_factors: Dict[str, float],
        fallback_prompt: str,
    ) -> Optional[List[Dict[str, Any]]]:
        """Parse multi-element structured output, returning detections or None on failure."""
        data = self._extract_json_object(output_text)

        if data is None:
            return None

        if isinstance(data, dict):
            if "elements" in data and isinstance(data["elements"], list):
                candidates = [elem for elem in data["elements"] if isinstance(elem, dict)]
            else:
                candidates = [data]
        elif isinstance(data, list):
            candidates = [elem for elem in data if isinstance(elem, dict)]
        else:
            return None

        detections: List[Dict[str, Any]] = []
        seen_centers: List[Tuple[int, int]] = []

        for candidate in candidates:
            detection = self._element_dict_to_detection(
                candidate,
                scale_factors,
                fallback_prompt,
                output_text,
            )

            if detection is None:
                continue

            center_tuple = tuple(detection["center"])
            if self._is_duplicate(center_tuple, seen_centers):
                continue

            detection["element_id"] = len(detections)
            detections.append(detection)
            seen_centers.append(center_tuple)

            if len(detections) >= settings.max_detections:
                break

        return detections

    @staticmethod
    def _is_prompt_instruction(text: str) -> bool:
        """
        Check if text looks like a prompt instruction rather than a UI element label.

        Prompt instructions typically:
        - Start with imperative verbs (Identify, Highlight, List, Surface, Find...)
        - Contain instructions like "such as", "that appear", "elements like"
        - Are longer/more verbose than typical UI labels
        """
        if not text or len(text) < 5:
            return False

        normalized = text.lower().strip()

        # Check for prompt instruction keywords
        prompt_starters = [
            "identify ",
            "highlight ",
            "list ",
            "surface ",
            "find ",
            "locate ",
            "detect ",
            "show ",
            "point out ",
            "mark ",
        ]

        prompt_phrases = [
            "such as",
            "that appear",
            "elements like",
            "controls such",
            "the user might",
            "interactive elements",
            "ui elements",
        ]

        # Check if it starts with a prompt verb
        for starter in prompt_starters:
            if normalized.startswith(starter):
                return True

        # Check if it contains prompt instruction phrases
        for phrase in prompt_phrases:
            if phrase in normalized:
                return True

        # Check if it's suspiciously long (typical UI labels are short)
        # Most real UI labels are < 50 chars
        if len(text) > 60:
            # But allow if it looks like actual content (has specific nouns)
            specific_ui_terms = ["button", "icon", "menu", "tab", "input", "field", "link", "window"]
            has_specific_term = any(term in normalized for term in specific_ui_terms)
            if not has_specific_term:
                return True

        return False

    @staticmethod
    def _clean_element_label(label: str, fallback: str = "UI element") -> str:
        """
        Clean and validate element label, replacing prompt instructions with fallback.

        Args:
            label: Raw label from model output
            fallback: Fallback label to use if input is invalid

        Returns:
            Cleaned label or fallback if label is a prompt instruction
        """
        if not label or not label.strip():
            return fallback

        cleaned = label.strip()

        # Filter out prompt instructions
        if Holo15._is_prompt_instruction(cleaned):
            print(f"⚠ Filtered prompt instruction from label: \"{cleaned[:60]}...\"")
            return fallback

        # Additional cleanup: remove common prefixes from actual labels
        prefixes_to_remove = ["a ", "an ", "the "]
        for prefix in prefixes_to_remove:
            if cleaned.lower().startswith(prefix) and len(cleaned) > len(prefix) + 5:
                cleaned = cleaned[len(prefix):]

        return cleaned

    def _element_dict_to_detection(
        self,
        element: Dict[str, Any],
        scale_factors: Dict[str, float],
        fallback_label: str,
        raw_output: str,
    ) -> Optional[Dict[str, Any]]:
        """Convert structured element description into detection payload."""
        if not isinstance(element, dict):
            return None

        x = self._coerce_float(element.get("x"))
        y = self._coerce_float(element.get("y"))

        if x is None and y is None and "bbox" in element:
            bbox = element["bbox"]
            if isinstance(bbox, (list, tuple)) and len(bbox) == 4:
                x1 = self._coerce_float(bbox[0])
                y1 = self._coerce_float(bbox[1])
                x2 = self._coerce_float(bbox[2])
                y2 = self._coerce_float(bbox[3])
                if None not in (x1, y1, x2, y2):
                    width_val = x2 - x1
                    height_val = y2 - y1
                    x = x1 + width_val / 2
                    y = y1 + height_val / 2
                    element.setdefault("width", width_val)
                    element.setdefault("height", height_val)

        if x is None and "x_norm" in element:
            normalized_x = self._coerce_float(element.get("x_norm"))
            if normalized_x is not None:
                x = normalized_x * scale_factors['resized_width']

        if y is None and "y_norm" in element:
            normalized_y = self._coerce_float(element.get("y_norm"))
            if normalized_y is not None:
                y = normalized_y * scale_factors['resized_height']

        raw_label = (
            element.get("label")
            or element.get("description")
            or element.get("name")
            or fallback_label
        )

        # Clean and validate label, filtering out prompt instructions
        label = self._clean_element_label(raw_label, fallback_label)

        element_type = element.get("type") or element.get("category") or "clickable"
        confidence = self._coerce_float(element.get("confidence"))

        width_hint = (
            self._coerce_float(element.get("width"))
            or self._coerce_float(element.get("w"))
            or self._coerce_float(element.get("width_pixels"))
        )
        height_hint = (
            self._coerce_float(element.get("height"))
            or self._coerce_float(element.get("h"))
            or self._coerce_float(element.get("height_pixels"))
        )

        if width_hint is None and element.get("width_norm") is not None:
            width_norm = self._coerce_float(element.get("width_norm"))
            if width_norm is not None:
                width_hint = width_norm * scale_factors['resized_width']

        if height_hint is None and element.get("height_norm") is not None:
            height_norm = self._coerce_float(element.get("height_norm"))
            if height_norm is not None:
                height_hint = height_norm * scale_factors['resized_height']

        detection = self._make_detection(
            x,
            y,
            scale_factors,
            str(label),
            str(element_type),
            raw_output,
            fallback_label,
            confidence,
            (width_hint, height_hint),
        )

        if detection is not None:
            if confidence is not None:
                detection["confidence"] = float(max(0.0, min(confidence, 1.0)))
        return detection

    @staticmethod
    def _coerce_float(value: Any) -> Optional[float]:
        """Convert numeric-like values into float, returning None on failure."""
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            try:
                return float(value.strip())
            except ValueError:
                return None
        return None

    def _make_detection(
        self,
        x: Optional[float],
        y: Optional[float],
        scale_factors: Dict[str, float],
        label: str,
        element_type: str,
        raw_output: str,
        task_instruction: str,
        confidence: Optional[float],
        size_hints: Optional[Tuple[Optional[float], Optional[float]]],
    ) -> Optional[Dict[str, Any]]:
        """Create detection dict from coordinates and optional size hints."""
        if x is None or y is None:
            return None

        try:
            x_val = float(x)
            y_val = float(y)
        except (TypeError, ValueError):
            return None

        resized_width = float(scale_factors['resized_width'])
        resized_height = float(scale_factors['resized_height'])

        if 0.0 <= x_val <= 1.0 and resized_width > 1:
            x_val *= resized_width
        if 0.0 <= y_val <= 1.0 and resized_height > 1:
            y_val *= resized_height

        original_x = int(round(x_val * scale_factors['width_scale']))
        original_y = int(round(y_val * scale_factors['height_scale']))

        original_width = int(scale_factors['original_width'])
        original_height = int(scale_factors['original_height'])

        width_hint, height_hint = (size_hints or (None, None))

        if width_hint is not None:
            width_val = float(width_hint)
            if 0.0 <= width_val <= 1.0 and resized_width > 1:
                width_val *= resized_width
            bbox_width = max(1, int(round(width_val * scale_factors['width_scale'])))
        else:
            bbox_width = settings.click_box_size

        if height_hint is not None:
            height_val = float(height_hint)
            if 0.0 <= height_val <= 1.0 and resized_height > 1:
                height_val *= resized_height
            bbox_height = max(1, int(round(height_val * scale_factors['height_scale'])))
        else:
            bbox_height = settings.click_box_size

        half_width = bbox_width // 2
        half_height = bbox_height // 2

        bbox_x = max(0, original_x - half_width)
        bbox_y = max(0, original_y - half_height)

        if bbox_x + bbox_width > original_width:
            bbox_width = max(1, original_width - bbox_x)
        if bbox_y + bbox_height > original_height:
            bbox_height = max(1, original_height - bbox_y)

        confidence_value = (
            float(confidence)
            if confidence is not None
            else settings.default_confidence
        )

        confidence_value = max(0.0, min(confidence_value, 1.0))

        caption = label if label else task_instruction

        max_x_index = max(0, original_width - 1)
        max_y_index = max(0, original_height - 1)

        detection = {
            "bbox": [bbox_x, bbox_y, bbox_width, bbox_height],
            "center": [max(0, min(original_x, max_x_index)), max(0, min(original_y, max_y_index))],
            "confidence": confidence_value,
            "type": element_type or "clickable",
            "caption": caption,
            "interactable": True,
            "content": caption,
            "source": "holo-localization",
            "raw_output": raw_output,
            "task": task_instruction,
        }

        return detection

    @staticmethod
    def _is_duplicate(center: Tuple[int, int], seen: List[Tuple[int, int]]) -> bool:
        """Detect if a coordinate is already accounted for."""
        for seen_center in seen:
            distance = ((center[0] - seen_center[0]) ** 2 + (center[1] - seen_center[1]) ** 2) ** 0.5
            if distance < settings.deduplication_radius:
                return True
        return False

    def _deduplicate_detections(self, detections: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Remove duplicate detections based on coordinate proximity."""
        if not detections:
            return []

        unique: List[Dict[str, Any]] = []
        seen_centers: List[Tuple[int, int]] = []

        for detection in detections:
            center = tuple(detection["center"])
            if not self._is_duplicate(center, seen_centers):
                unique.append(detection)
                seen_centers.append(center)

        return unique

    def _legacy_multi_detection(
        self,
        image: np.ndarray,
        detection_prompts: List[str],
        prepared_payload: Dict[str, Any],
        max_detections: int,
        max_tokens: Optional[int] = None,
    ) -> Tuple[List[Dict[str, Any]], List[str]]:
        """Fallback multi-detection loop using legacy prompt list."""
        detections: List[Dict[str, Any]] = []
        raw_outputs: List[str] = []
        seen_centers: List[Tuple[int, int]] = []

        for prompt in detection_prompts:
            detection, outputs = self.localize_element(
                image,
                prompt,
                prepared_payload=prepared_payload,
                max_tokens=max_tokens,  # CRITICAL FIX: Pass profile's max_tokens
            )

            raw_outputs.extend(outputs)

            if detection is None:
                continue

            center_tuple = tuple(detection["center"])
            if self._is_duplicate(center_tuple, seen_centers):
                continue

            detection["element_id"] = len(detections)
            detections.append(detection)
            seen_centers.append(center_tuple)

            if len(detections) >= max_detections:
                break

        return detections, raw_outputs

    @staticmethod
    def _extract_json_object(text: str) -> Optional[Any]:
        """Try to recover a JSON object or array from the model text."""
        if not text:
            return None

        candidates: List[str] = []

        code_fence = re.search(r"```json\s*(.*?)```", text, re.IGNORECASE | re.DOTALL)
        if code_fence:
            candidates.append(code_fence.group(1))

        generic_fence = re.search(r"```\s*(.*?)```", text, re.DOTALL)
        if generic_fence:
            candidates.append(generic_fence.group(1))

        stripped = text.strip()
        if stripped:
            candidates.append(stripped)

        for token in ("{", "["):
            idx = text.find(token)
            if idx != -1:
                candidates.append(text[idx:])

        decoder = json.JSONDecoder()
        for candidate in candidates:
            snippet = candidate.strip()
            if not snippet:
                continue
            try:
                return json.loads(snippet)
            except json.JSONDecodeError:
                try:
                    obj, _ = decoder.raw_decode(snippet)
                    return obj
                except Exception:
                    continue

        return None

    def localize_element(
        self,
        image: np.ndarray,
        task_instruction: str,
        guidelines: Optional[str] = None,
        prepared_payload: Optional[Dict[str, Any]] = None,
        max_tokens: Optional[int] = None,
    ) -> Tuple[Optional[Dict[str, Any]], List[str]]:
        """
        Localize a UI element using Holo 1.5-7B GGUF.

        Args:
            image: Input image as numpy array (RGB)
            task_instruction: Task description (e.g., "Click the submit button")
            guidelines: Optional guidelines for the model
            prepared_payload: Optional cached payload with image_url & scale factors
            max_tokens: Optional max tokens override (from profile)

        Returns:
            Tuple of (detection dict or None, list of raw model outputs)
        """
        try:
            payload = prepared_payload or self._prepare_image_payload(image)
            image_url = payload["image_url"]
            scale_factors = payload["scale_factors"]
        except Exception as e:
            print(f"✗ Holo error in image preprocessing: {e}")
            return None, []

        if guidelines is None:
            guidelines = settings.holo_guidelines

        prompt_text = self._build_single_prompt(task_instruction, scale_factors, guidelines)

        attempts_outputs: List[str] = []
        detection: Optional[Dict[str, Any]] = None

        for attempt in range(self.max_retries + 1):
            try:
                output_text = self._call_model(image_url, prompt_text, max_tokens=max_tokens)
            except Exception as exc:
                print(f"✗ Holo error during localization (task: '{task_instruction}'): {exc}")
                break

            attempts_outputs.append(output_text)

            detection = self._parse_single_output(
                output_text,
                scale_factors,
                task_instruction,
            )

            if detection is not None:
                detection["raw_output"] = output_text
                break

            if attempt < self.max_retries:
                prompt_text = self._augment_prompt(prompt_text)
                if self.retry_backoff:
                    time.sleep(self.retry_backoff * (attempt + 1))

        return detection, attempts_outputs

    def detect_multiple_elements(
        self,
        image: np.ndarray,
        detection_prompts: Optional[List[str]] = None,
        prepared_payload: Optional[Dict[str, Any]] = None,
        max_detections: Optional[int] = None,
        max_tokens: Optional[int] = None,
    ) -> Tuple[List[Dict[str, Any]], List[str]]:
        """
        Detect multiple UI elements using multiple localization prompts.

        Args:
            image: Input image as numpy array (RGB)
            detection_prompts: List of prompts to try (default from settings)
            prepared_payload: Optional cached image payload
            max_detections: Maximum detections to return
            max_tokens: Optional max tokens override (from profile)

        Returns:
            Tuple of (list of detected elements, raw outputs)
        """
        if detection_prompts is None:
            detection_prompts = settings.detection_prompts

        # Honor explicit API request over profile defaults to avoid overriding user intent
        if max_detections is not None:
            effective_max = max(1, min(max_detections, 200))
        else:
            effective_max = max(1, min(settings.max_detections, 200))

        payload = prepared_payload or self._prepare_image_payload(image)

        detections: List[Dict[str, Any]] = []
        raw_outputs: List[str] = []

        discovery_prompt = settings.discovery_prompt.format(
            max_detections=effective_max
        )
        prompt_text = self._build_multi_prompt(
            discovery_prompt,
            payload["scale_factors"],
            detection_prompts,
        )

        structured_success = False

        for attempt in range(self.max_retries + 1):
            try:
                output_text = self._call_model(payload["image_url"], prompt_text, max_tokens=max_tokens)
            except Exception as exc:
                print(f"✗ Holo error during multi-detection: {exc}")
                break

            raw_outputs.append(output_text)

            structured_detections = self._parse_multi_output(
                output_text,
                payload["scale_factors"],
                discovery_prompt,
            )

            if structured_detections is not None:
                detections.extend(structured_detections)
                structured_success = True
                print(f"✓ Structured parsing succeeded: {len(structured_detections)} elements extracted")
                break
            else:
                # Diagnostic logging for failed structured parsing
                print(f"⚠ Structured parsing failed (attempt {attempt + 1}/{self.max_retries + 1})")
                print(f"  Output length: {len(output_text)} chars")
                print(f"  Output preview: {output_text[:300]}...")
                if attempt == 0:  # Log more detail on first attempt
                    # Check if output looks like JSON
                    first_char = output_text.strip()[0] if output_text.strip() else None
                    if first_char in ['{', '[']:
                        print(f"  ✓ Output starts with JSON character: '{first_char}'")
                    else:
                        print(f"  ✗ Output does NOT start with JSON (first char: '{first_char}')")

            if attempt < self.max_retries:
                prompt_text = self._augment_prompt(prompt_text)
                if self.retry_backoff:
                    time.sleep(self.retry_backoff * (attempt + 1))

        # Phase 2: Run legacy mode as TRUE FALLBACK (only if structured parsing failed)
        # After Phase 1 prompt consolidation (4→1 comprehensive prompt), structured mode succeeds in most cases.
        # Legacy mode now acts as a safety net for edge cases where JSON parsing fails completely.
        if settings.allow_legacy_fallback and not structured_success:
            print(f"→ Structured parsing failed - falling back to legacy mode ({len(detection_prompts)} prompts)")
            legacy_detections, legacy_outputs = self._legacy_multi_detection(
                image,
                detection_prompts,
                payload,
                effective_max,
                max_tokens=max_tokens,
            )
            raw_outputs.extend(legacy_outputs)

            if legacy_detections:
                print(f"✓ Legacy fallback found {len(legacy_detections)} element(s)")
                # Deduplicate before adding
                before_dedup = len(detections) + len(legacy_detections)
                detections.extend(legacy_detections)
                detections = self._deduplicate_detections(detections)
                print(f"✓ After deduplication: {len(detections)} unique elements (was {before_dedup})")
            else:
                print(f"⚠ Legacy fallback found 0 elements - detection completely failed")
        elif settings.allow_legacy_fallback and structured_success:
            print(f"→ Structured parsing succeeded ({len(detections)} elements) - skipping legacy fallback")

        if detections:
            detections.sort(key=lambda item: float(item.get("confidence", settings.default_confidence)), reverse=True)
            if len(detections) > effective_max:
                detections = detections[:effective_max]
            for index, detection in enumerate(detections):
                detection["element_id"] = index

        return detections, raw_outputs

    def _apply_adaptive_confidence_filtering(
        self,
        detections: List[Dict[str, Any]],
        use_adaptive: bool = True,
        fallback_threshold: float = 0.3,
    ) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
        """
        Apply element-type aware confidence filtering (Phase 2 optimization).

        Holo 1.5-7B's GRPO training produces calibrated confidence scores.
        Different element types have different detection reliability:
        - Buttons/icons: High reliability (well-defined visual patterns)
        - Text/links: Lower reliability (context-dependent, abundant)

        Args:
            detections: List of detected elements
            use_adaptive: Whether to use element-type aware thresholds
            fallback_threshold: Single threshold if adaptive mode disabled

        Returns:
            Tuple of (filtered detections, stats dict with zone counts)
        """
        if not detections:
            return [], {"high": 0, "medium": 0, "low": 0, "very_low": 0, "filtered": 0}

        filtered: List[Dict[str, Any]] = []
        stats = {"high": 0, "medium": 0, "low": 0, "very_low": 0, "filtered": 0}

        for detection in detections:
            confidence = float(detection.get("confidence", settings.default_confidence))
            element_type = detection.get("type", "clickable").lower()

            # Determine confidence zone (high/medium/low/very_low)
            zone = "very_low"
            for zone_name in ["high", "medium", "low"]:
                if confidence >= CONFIDENCE_ZONES[zone_name]["min"]:
                    zone = zone_name
                    break

            stats[zone] += 1

            # Apply filtering threshold
            if use_adaptive:
                # Element-type specific threshold
                threshold = ADAPTIVE_CONFIDENCE_THRESHOLDS.get(
                    element_type,
                    ADAPTIVE_CONFIDENCE_THRESHOLDS["default"]
                )
            else:
                # Uniform threshold
                threshold = fallback_threshold

            if confidence >= threshold:
                # Add metadata about confidence zone for downstream validation
                detection["confidence_zone"] = zone
                detection["confidence"] = round(confidence, 4)
                filtered.append(detection)
            else:
                stats["filtered"] += 1

        return filtered, stats

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
        max_detections: Optional[int] = None,
        min_confidence: Optional[float] = None,
        return_raw_outputs: Optional[bool] = None,
        performance_profile: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Parse UI screenshot using Holo 1.5-7B GGUF.

        Args:
            image: Input screenshot as numpy array (RGB)
            task: Optional specific task instruction (single element mode)
            detect_multiple: Whether to detect multiple elements (default: True)
            include_som: Whether to generate Set-of-Mark annotated image
            max_detections: Optional cap for detections (overrides profile)
            min_confidence: Optional confidence floor for returned detections
            return_raw_outputs: Whether to include raw model outputs in response
            performance_profile: Optional per-request profile override

        Returns:
            Dictionary with detected elements and metadata
        """
        start_time = time.time()

        profile_key = (performance_profile or settings.active_profile).lower()
        profile = PERFORMANCE_PROFILES.get(profile_key, PERFORMANCE_PROFILES[settings.active_profile])
        # Honor explicit API request over profile defaults
        if max_detections is not None:
            effective_max = max(1, min(max_detections, 200))
        else:
            effective_max = max(1, min(settings.max_detections, 200))
        confidence_floor = (
            min_confidence
            if min_confidence is not None
            else settings.min_confidence_threshold
        )
        include_raw = (
            return_raw_outputs
            if return_raw_outputs is not None
            else settings.return_raw_outputs or profile.get("return_raw_outputs", False)
        )
        # CRITICAL FIX: Extract profile's max_new_tokens
        profile_max_tokens = profile.get("max_new_tokens", settings.max_new_tokens)

        prepared_payload: Optional[Dict[str, Any]] = None
        raw_model_outputs: List[str] = []

        if task:
            # Single element mode: localize specific task
            prepared_payload = self._prepare_image_payload(image)
            detection, outputs = self.localize_element(
                image,
                task,
                prepared_payload=prepared_payload,
                max_tokens=profile_max_tokens,
            )
            raw_model_outputs.extend(outputs)
            detections = [detection] if detection else []
            if detections:
                detections[0]["element_id"] = 0
        elif detect_multiple:
            # Multi-element mode: run multiple detection prompts
            prepared_payload = self._prepare_image_payload(image)
            detections, outputs = self.detect_multiple_elements(
                image,
                prepared_payload=prepared_payload,
                max_detections=effective_max,
                max_tokens=profile_max_tokens,
            )
            raw_model_outputs.extend(outputs)
        else:
            # Default to multi-element mode
            prepared_payload = self._prepare_image_payload(image)
            detections, outputs = self.detect_multiple_elements(
                image,
                prepared_payload=prepared_payload,
                max_detections=effective_max,
                max_tokens=profile_max_tokens,
            )
            raw_model_outputs.extend(outputs)

        # Phase 2: Apply adaptive confidence filtering (element-type aware)
        if detections and confidence_floor is not None:
            # Check if profile enables adaptive thresholding
            use_adaptive = profile.get("use_adaptive_thresholds", False)

            detections, confidence_stats = self._apply_adaptive_confidence_filtering(
                detections,
                use_adaptive=use_adaptive,
                fallback_threshold=confidence_floor,
            )

            # Log confidence distribution for visibility
            if confidence_stats["high"] + confidence_stats["medium"] + confidence_stats["low"] > 0:
                total_before = sum(confidence_stats.values())
                mode_label = "adaptive (type-aware)" if use_adaptive else "fixed"
                print(f"  Confidence filtering ({mode_label}):")
                print(f"    High (≥0.70): {confidence_stats['high']}, Medium (≥0.40): {confidence_stats['medium']}, "
                      f"Low (≥0.20): {confidence_stats['low']}, Very low (<0.20): {confidence_stats['very_low']}")
                print(f"    Filtered out: {confidence_stats['filtered']}/{total_before} ({confidence_stats['filtered']/total_before*100:.1f}%)")
                print(f"    Retained: {len(detections)}/{total_before} ({len(detections)/total_before*100:.1f}%)")

        if detections:
            for index, detection in enumerate(detections):
                detection["element_id"] = index

        # Generate SOM annotated image if requested
        som_image = None
        if include_som and detections:
            som_image = self.generate_som_image(image, detections)

        processing_time = (time.time() - start_time) * 1000  # Convert to ms

        # Log detection result for visibility with performance metrics
        if detections:
            print(f"✓ Holo detected {len(detections)} element(s) in {processing_time:.1f}ms")
            if len(detections) > 0:
                avg_confidence = sum(d.get("confidence", 0) for d in detections) / len(detections)
                print(f"  Average confidence: {avg_confidence:.2f}, Device: {self.device}, Profile: {profile_key}")
        else:
            print(f"⚠ Holo found 0 elements")
            print(f"  Task: {task}, Detect multiple: {detect_multiple}")
            print(f"  Processing time: {processing_time:.1f}ms, Device: {self.device}")
            if include_raw and raw_model_outputs:
                print(f"  Raw model outputs ({len(raw_model_outputs)} attempts):")
                for i, output in enumerate(raw_model_outputs[:2]):  # Show first 2 outputs
                    print(f"    Attempt {i+1}: {output[:200]}...")  # First 200 chars

        result = {
            "elements": detections,
            "count": len(detections),
            "processing_time_ms": round(processing_time, 2),
            "image_size": {"width": image.shape[1], "height": image.shape[0]},
            "device": self.device,
            "profile": profile_key,
            "max_detections": effective_max,
            "min_confidence": round(confidence_floor, 3) if confidence_floor is not None else None,
        }

        if som_image:
            result["som_image"] = som_image

        if include_raw and raw_model_outputs:
            result["raw_model_outputs"] = raw_model_outputs

        return result


# Global model instance (lazy loaded)
_model_instance: Optional[Holo15] = None


def get_model() -> Holo15:
    """Get or create global Holo 1.5-7B model instance."""
    global _model_instance
    if _model_instance is None:
        _model_instance = Holo15()
    return _model_instance
