"""Configuration management for OmniParser service."""

import os
from pathlib import Path
from typing import Literal
from pydantic_settings import BaseSettings


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

    # Detection settings (aligned with official OmniParser demo defaults)
    min_confidence: float = 0.05  # Official demo default: 0.05 (was 0.3 - too high!)
    max_detections: int = 100

    # Performance settings
    cache_models: bool = True
    model_dtype: str = "float16"  # float16, float32, bfloat16

    model_config = {
        "env_prefix": "OMNIPARSER_",
        "env_file": ".env",
        "protected_namespaces": ()  # Disable protected namespace warning for model_dtype
    }


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
