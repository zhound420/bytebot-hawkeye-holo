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

    # Device settings
    device: Literal["cuda", "mps", "cpu"] = "cuda"

    # Detection settings
    min_confidence: float = 0.3
    max_detections: int = 100

    # Performance settings
    cache_models: bool = True
    model_dtype: str = "float16"  # float16, float32, bfloat16

    class Config:
        env_prefix = "OMNIPARSER_"
        env_file = ".env"


def get_device() -> str:
    """Auto-detect best available device."""
    import torch

    if torch.cuda.is_available():
        return "cuda"
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"  # Apple Silicon
    else:
        return "cpu"


settings = Settings()

# Auto-detect device if not explicitly set
if settings.device == "cuda" and not os.environ.get("OMNIPARSER_DEVICE"):
    settings.device = get_device()

print(f"OmniParser using device: {settings.device}")
