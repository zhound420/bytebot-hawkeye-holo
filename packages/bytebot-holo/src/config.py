"""Configuration management for Holo 1.5-7B service."""

from pathlib import Path
from typing import Literal, Optional, List, Dict, Any
from pydantic import Field
from pydantic_settings import BaseSettings


DEFAULT_DETECTION_PROMPTS: List[str] = [
    "List the most prominent buttons or calls to action the user can click.",
    "Identify navigation controls such as tabs, menus, or sidebar entries that appear interactive.",
    "Highlight form elements like text inputs, search fields, or dropdown selectors.",
    "Surface key icons in toolbars or system trays that a desktop user might interact with soon.",
]

PERFORMANCE_PROFILES: Dict[str, Dict[str, Any]] = {
    "speed": {
        "max_detections": 20,  # Increased from 15 for better coverage
        "max_new_tokens": 256,  # Increased from 64 - CRITICAL FIX for multi-element detection
        "max_retries": 0,  # No retries for speed
        "retry_backoff_seconds": 0.0,
        "click_box_size": 32,
        "deduplication_radius": 22,
        "temperature": 0.0,  # Greedy decoding for consistency
        "top_p": None,  # Disable top_p with temperature=0.0
        "min_confidence_threshold": 0.5,  # Higher threshold for quality
        "return_raw_outputs": False,
    },
    "balanced": {
        "max_detections": 40,  # Increased from 30 for better coverage
        "max_new_tokens": 512,  # Increased from 96 - allows 20-40 elements
        "max_retries": 1,  # Single retry
        "retry_backoff_seconds": 0.3,
        "click_box_size": 40,
        "deduplication_radius": 30,
        "temperature": 0.0,
        "top_p": None,
        "min_confidence_threshold": 0.3,
        "return_raw_outputs": False,
    },
    "quality": {
        "max_detections": 100,  # Increased from 50 for maximum coverage
        "max_new_tokens": 1024,  # Increased from 128 - allows 50-100 elements
        "max_retries": 2,
        "retry_backoff_seconds": 0.5,
        "click_box_size": 48,
        "deduplication_radius": 36,
        "temperature": 0.0,
        "top_p": None,
        "min_confidence_threshold": 0.2,
        "return_raw_outputs": True,
    },
}


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
    n_ctx: int = 4096  # Reduced context for faster inference (was 8192)
    n_threads: Optional[int] = None
    n_batch: Optional[int] = 512  # Optimal batch size for MPS/CUDA
    n_gpu_layers: Optional[int] = None  # Auto-tuned based on device
    mmproj_n_gpu_layers: Optional[int] = None  # Auto-tuned based on device

    # Holo 1.5 inference settings
    max_new_tokens: int = 64  # Reduced for faster inference (was 128)
    temperature: float = 0.0  # Greedy decoding for consistency
    top_p: Optional[float] = None  # Disabled with temperature=0.0
    max_retries: int = 0  # Disabled by default for speed (was 2)
    retry_backoff_seconds: float = 0.3  # Reduced backoff (was 0.75)
    default_confidence: float = 0.85  # Default confidence (Holo doesn't provide confidence scores)
    min_confidence_threshold: float = 0.5  # Higher threshold for quality (was 0.3)
    performance_profile: Literal["speed", "balanced", "quality"] = "speed"  # Default to speed
    return_raw_outputs: bool = False
    active_profile: str = Field("speed", exclude=True)  # Changed default
    active_profile_config: Dict[str, Any] = Field(default_factory=dict, exclude=True)

    # Coordinate-to-bbox conversion settings
    click_box_size: int = 40  # Size of bounding box around click point (pixels)
    deduplication_radius: int = 30  # Radius for deduplicating similar coordinates (pixels)

    # Prompt engineering for single + multi element detection
    system_prompt: str = (
        "You are a UI localization expert. Analyze screenshots and provide precise pixel coordinates. "
        "CRITICAL RULES: (1) Return ONLY raw JSON, (2) NO markdown code fences (```json), "
        "(3) NO explanations or reasoning, (4) Start response immediately with { or [ character."
    )
    holo_guidelines: str = (
        "You are looking at a UI screenshot. Identify interactive elements like buttons, icons, inputs, and links. "
        "For each element, provide the center point coordinates in pixels relative to the image dimensions. "
        "Be precise and only report elements you can clearly see."
    )
    single_detection_format: str = (
        "Return a JSON object with: {\"x\": <integer>, \"y\": <integer>, \"label\": \"brief description\"}. "
        "Example: {\"x\": 352, \"y\": 128, \"label\": \"Submit button\"}. "
        "If not found, return: {\"x\": null, \"y\": null, \"label\": \"not found\"}."
    )
    retry_guidance: str = (
        "Previous response was not valid JSON. Please return ONLY a JSON object with no markdown or extra text. "
        "Use the exact format requested above."
    )
    discovery_prompt: str = (
        "Identify the top {max_detections} interactive UI elements in this screenshot. "
        "Look for: buttons, icons, menu items, input fields, links, and clickable controls. "
        "For each element, provide center coordinates and a brief label."
    )
    multi_detection_format: str = (
        "START YOUR RESPONSE WITH THIS EXACT FORMAT (no preamble):\n"
        "{{\"elements\":[{{\"x\":<int>,\"y\":<int>,\"label\":\"desc\",\"type\":\"button|icon|input|link\"}}]}}\n\n"
        "Example response (your response must start exactly like this):\n"
        "{{\"elements\":[{{\"x\":100,\"y\":200,\"label\":\"Search\",\"type\":\"button\"}},{{\"x\":150,\"y\":250,\"label\":\"Settings\",\"type\":\"icon\"}}]}}\n\n"
        "STRICT RULES:\n"
        "- First character of response MUST be '{'\n"
        "- Do NOT use markdown code fences (```json or ```)\n"
        "- Do NOT add explanations before or after JSON\n"
        "- Do NOT add reasoning or thoughts"
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
    return DEFAULT_DETECTION_PROMPTS


def _apply_profile_defaults(base: Settings) -> None:
    """Apply performance profile defaults unless explicitly overridden."""
    profile_key = (base.performance_profile or "balanced").lower()
    profile = PERFORMANCE_PROFILES.get(profile_key, PERFORMANCE_PROFILES["balanced"])

    def _maybe_set(field: str, value: Any) -> None:
        if field not in base.model_fields_set:
            setattr(base, field, value)

    _maybe_set("max_detections", profile["max_detections"])
    _maybe_set("max_new_tokens", profile["max_new_tokens"])
    _maybe_set("max_retries", profile["max_retries"])
    _maybe_set("retry_backoff_seconds", profile["retry_backoff_seconds"])
    _maybe_set("click_box_size", profile["click_box_size"])
    _maybe_set("deduplication_radius", profile["deduplication_radius"])
    _maybe_set("temperature", profile["temperature"])
    _maybe_set("top_p", profile["top_p"])
    _maybe_set("min_confidence_threshold", profile["min_confidence_threshold"])
    _maybe_set("return_raw_outputs", profile["return_raw_outputs"])

    base.active_profile = profile_key
    base.active_profile_config = profile


settings = Settings()
settings.detection_prompts = _ensure_detection_prompts(settings)
_apply_profile_defaults(settings)

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
print(f"  Performance profile: {settings.active_profile}")
