"""Configuration management for Holo 1.5-7B service."""

import os
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

    # Model settings
    cache_models: bool = True
    model_dtype: str = "bfloat16"  # float16, float32, bfloat16 (recommended for Holo)

    # Holo 1.5 inference settings
    max_new_tokens: int = 128  # Maximum tokens for coordinate generation
    default_confidence: float = 0.85  # Default confidence (Holo doesn't provide confidence scores)

    # Coordinate-to-bbox conversion settings
    click_box_size: int = 40  # Size of bounding box around click point (pixels)
    deduplication_radius: int = 30  # Radius for deduplicating similar coordinates (pixels)

    # Guidelines and prompts for Holo 1.5
    holo_guidelines: str = (
        "You are a GUI automation assistant. Analyze the screenshot and provide "
        "the exact pixel coordinates to click for the requested action. "
        "Respond with Click(x, y) format."
    )

    # Detection prompts for multi-element mode
    detection_prompts: List[str] = [
        "Click on any interactive button",
        "Click on any text input field",
        "Click on any clickable link",
        "Click on any menu item or dropdown",
        "Click on any icon or control element",
    ]

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


settings = Settings()

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
