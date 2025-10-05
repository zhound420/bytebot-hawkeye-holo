"""Configuration management for Holo 1.5-7B service."""

from pathlib import Path
from typing import Literal, Optional, List
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Holo 1.5-7B service configuration."""

    # Service settings
    host: str = "0.0.0.0"
    port: int = 9989
    workers: int = 1

    # Device settings (auto = auto-detect, cuda = NVIDIA, mps = Apple Silicon, cpu = CPU)
    device: Literal["auto", "cuda", "mps", "cpu"] = "auto"

    # Model repository + quantization controls
    model_repo: str = "mradermacher/Holo1.5-7B-GGUF"
    model_filename: str = "Holo1.5-7B.Q4_K_M.gguf"
    mmproj_filename: str = "mmproj-Q8_0.gguf"
    model_path: Optional[Path] = None  # Absolute path to pre-downloaded GGUF model
    mmproj_path: Optional[Path] = None  # Absolute path to projector file
    cache_models: bool = True
    cache_dir: Path = Path.home() / ".cache" / "bytebot" / "holo"
    model_dtype: str = "bfloat16"  # float16, float32, bfloat16 (recommended for Holo)
    n_ctx: int = 8192
    n_threads: Optional[int] = None
    n_batch: Optional[int] = None
    n_gpu_layers: Optional[int] = None
    mmproj_n_gpu_layers: Optional[int] = None

    # Holo 1.5 inference settings
    max_new_tokens: int = 128  # Maximum tokens for coordinate generation
    temperature: float = 0.0
    top_p: float = 0.8
    max_retries: int = 2
    retry_backoff_seconds: float = 0.75
    default_confidence: float = 0.85  # Default confidence (Holo doesn't provide confidence scores)

    # Coordinate-to-bbox conversion settings
    click_box_size: int = 40  # Size of bounding box around click point (pixels)
    deduplication_radius: int = 30  # Radius for deduplicating similar coordinates (pixels)

    # Prompt engineering for single + multi element detection
    system_prompt: str = (
        "You are Bytebot's UI localization specialist. "
        "Always produce strict JSON without commentary so that downstream parsers never fail."
    )
    holo_guidelines: str = (
        "Analyze the screenshot carefully. Only describe elements that truly exist. "
        "Report pixel coordinates on the provided image."
    )
    single_detection_format: str = (
        "Respond with a JSON object that matches this schema: "
        "{\"x\": <int>, \"y\": <int>, \"label\": \"short description\"}. "
        "If the element cannot be found, reply with {\"x\": null, \"y\": null, \"label\": \"not found\"}."
    )
    retry_guidance: str = (
        "Your previous output could not be parsed. Return STRICT JSON that matches the requested schema. "
        "Do not add explanations, markdown, or trailing text."
    )
    discovery_prompt: str = (
        "Identify up to {max_detections} actionable UI regions (buttons, tabs, menu rows, icons, form fields, "
        "links, toggles). For each region, return a short visual description and center coordinates in pixels."
    )
    multi_detection_format: str = (
        "Respond with a JSON object in the following form: "
        "{\"elements\": [{\"x\": <int>, \"y\": <int>, \"label\": \"description\", "
        "\"type\": \"button|icon|input|text|link|other\", \"width\": <int?>, \"height\": <int?>}]}. "
        "Return an empty list if nothing is actionable."
    )
    allow_legacy_fallback: bool = True

    # Legacy compatibility (still used for fallback heuristics)
    detection_prompts: List[str] = []

    # Max detections limit
    max_detections: int = 100

    model_config = {
        "env_prefix": "HOLO_",
        "env_file": ".env",
        "protected_namespaces": ()  # Disable protected namespace warning for model_dtype
    }


def get_device() -> Literal["cuda", "mps", "cpu"]:
    """
    Auto-detect best available device.

    Priority order:
    1. CUDA (NVIDIA GPU) - best performance (~0.8-1.5s/inference)
    2. MPS (Apple Silicon GPU) - good performance (~1.5-2.5s/inference), native macOS only
    3. CPU - fallback, slower (~8-15s/inference) but works everywhere

    Note: MPS is NOT available in Docker containers on macOS.
    """
    import torch
    import platform

    # Check CUDA first (NVIDIA GPUs)
    if torch.cuda.is_available():
        gpu_count = torch.cuda.device_count()
        gpu_name = torch.cuda.get_device_name(0) if gpu_count > 0 else "Unknown"
        print(f"✓ CUDA available: {gpu_count} GPU(s) - {gpu_name}")
        return "cuda"

    # Check MPS (Apple Silicon - only works natively, not in Docker)
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        print(f"✓ MPS (Apple Silicon) available on {platform.machine()}")
        return "mps"

    # Fallback to CPU
    arch = platform.machine()
    print(f"⚠ No GPU acceleration available - using CPU on {arch}")
    if arch == "arm64" or arch == "aarch64":
        print("  Note: MPS (Apple Silicon GPU) is not available in Docker containers")
        print("  For GPU acceleration on Apple Silicon, run Holo 1.5 natively")
    return "cpu"


# Resolve defaults that depend on other fields
def _ensure_detection_prompts(base: Settings) -> List[str]:
    """Provide backward-compatible detection prompt list."""
    if base.detection_prompts:
        return base.detection_prompts
    return [base.discovery_prompt]


settings = Settings()
settings.detection_prompts = _ensure_detection_prompts(settings)

if settings.cache_models:
    try:
        settings.cache_dir.mkdir(parents=True, exist_ok=True)
    except Exception as exc:
        print(f"Warning: Unable to create cache directory {settings.cache_dir}: {exc}")

# Auto-detect device if set to 'auto'
if settings.device == "auto":
    detected = get_device()
    settings.device = detected
    print(f"→ Auto-detected device: {detected}")
else:
    print(f"→ Using configured device: {settings.device}")

# Print Holo 1.5 configuration
print(f"→ Model: Holo 1.5-7B (Qwen2.5-VL base)")
print(f"  Dtype: {settings.model_dtype}, Max tokens: {settings.max_new_tokens}")
print(f"  Detection prompts: {len(settings.detection_prompts)} prompts")
print(f"  Click box size: {settings.click_box_size}px, Dedup radius: {settings.deduplication_radius}px")
