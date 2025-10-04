"""Configuration management for OmniParser service."""

import os
from pathlib import Path
from typing import Literal, Optional
from pydantic_settings import BaseSettings


class PerformanceProfile:
    """Performance profile configurations for OmniParser."""

    SPEED = {
        "enable_ocr": False,
        "max_captions": 15,
        "caption_prompt": "CAPTION",
        "batch_size_mps": 16,
        "batch_size_gpu": 64,
        "description": "Fast mode (2-3s) - No OCR, limited captions"
    }

    BALANCED = {
        "enable_ocr": True,
        "max_captions": 25,
        "caption_prompt": "DETAILED_CAPTION",
        "batch_size_mps": 32,
        "batch_size_gpu": 128,
        "description": "Balanced mode (4-6s) - Selective OCR, detailed captions (RECOMMENDED)"
    }

    QUALITY = {
        "enable_ocr": True,
        "max_captions": 100,
        "caption_prompt": "DETAILED_CAPTION",
        "batch_size_mps": 32,
        "batch_size_gpu": 128,
        "description": "Quality mode (10-16s) - Full OCR, maximum accuracy"
    }


class Settings(BaseSettings):
    """OmniParser service configuration."""

    # Service settings
    host: str = "0.0.0.0"
    port: int = 9989
    workers: int = 1

    # Model paths
    weights_dir: Path = Path(__file__).parent.parent / "weights"
    icon_detect_dir: Path = weights_dir / "icon_detect"
    icon_caption_dir: Path = weights_dir / "icon_caption_florence"

    # Device settings (auto = auto-detect, cuda = NVIDIA, mps = Apple Silicon, cpu = CPU)
    device: Literal["auto", "cuda", "mps", "cpu"] = "auto"

    # Performance profile
    performance_profile: Literal["SPEED", "BALANCED", "QUALITY"] = "BALANCED"

    # Detection settings (aligned with official OmniParser demo defaults)
    min_confidence: float = 0.05  # Official demo default: 0.05 (was 0.3 - too high!)
    max_detections: int = 100

    # Performance tuning (can override profile defaults)
    enable_ocr: Optional[bool] = None
    max_captions: Optional[int] = None
    caption_prompt: Optional[str] = None
    batch_size: Optional[int] = None
    iou_threshold: float = 0.1  # Overlap removal threshold

    # Model settings
    cache_models: bool = True
    model_dtype: str = "float16"  # float16, float32, bfloat16

    model_config = {
        "env_prefix": "OMNIPARSER_",
        "env_file": ".env",
        "protected_namespaces": ()  # Disable protected namespace warning for model_dtype
    }

    def get_profile_settings(self) -> dict:
        """Get active performance profile settings."""
        # Get base profile
        profile_map = {
            "SPEED": PerformanceProfile.SPEED,
            "BALANCED": PerformanceProfile.BALANCED,
            "QUALITY": PerformanceProfile.QUALITY,
        }
        profile = profile_map.get(self.performance_profile, PerformanceProfile.BALANCED)

        # Apply overrides if specified
        result = profile.copy()
        if self.enable_ocr is not None:
            result["enable_ocr"] = self.enable_ocr
        if self.max_captions is not None:
            result["max_captions"] = self.max_captions
        if self.caption_prompt is not None:
            result["caption_prompt"] = self.caption_prompt
        if self.batch_size is not None:
            result["batch_size_mps"] = self.batch_size
            result["batch_size_gpu"] = self.batch_size

        return result

    def get_batch_size(self, device: str) -> int:
        """Get optimal batch size for device."""
        profile = self.get_profile_settings()

        # Use explicit batch_size if set
        if self.batch_size is not None:
            return self.batch_size

        # Otherwise use profile defaults
        if device == "mps":
            return profile["batch_size_mps"]
        else:  # cuda or cpu
            return profile["batch_size_gpu"]


def get_device() -> Literal["cuda", "mps", "cpu"]:
    """
    Auto-detect best available device.

    Priority order:
    1. CUDA (NVIDIA GPU) - best performance
    2. MPS (Apple Silicon GPU) - good performance, native macOS only
    3. CPU - fallback, slower but works everywhere

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
        print("  For GPU acceleration on Apple Silicon, run OmniParser natively")
    return "cpu"


settings = Settings()

# Auto-detect device if set to 'auto'
if settings.device == "auto":
    detected = get_device()
    settings.device = detected
    print(f"→ Auto-detected device: {detected}")
else:
    print(f"→ Using configured device: {settings.device}")

# Print active performance profile
profile_settings = settings.get_profile_settings()
print(f"→ Performance profile: {settings.performance_profile}")
print(f"  {profile_settings['description']}")
print(f"  OCR: {profile_settings['enable_ocr']}, Max captions: {profile_settings['max_captions']}, Batch size (MPS/GPU): {profile_settings['batch_size_mps']}/{profile_settings['batch_size_gpu']}")
