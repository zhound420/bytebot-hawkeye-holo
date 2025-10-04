"""FastAPI server for Holo 1.5-7B UI localization service."""

import io
import base64
import time
from typing import Optional
from contextlib import asynccontextmanager
import numpy as np
from PIL import Image
from fastapi import FastAPI, File, UploadFile, HTTPException, Body
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn

from .config import settings
from .holo_wrapper import get_model


# Pydantic models for request/response
class ParseRequest(BaseModel):
    """Request model for screenshot parsing with Holo 1.5-7B."""
    image: str = Field(..., description="Base64 encoded image")
    task: Optional[str] = Field(None, description="Specific task instruction for single-element mode")
    detect_multiple: bool = Field(True, description="Detect multiple elements using various prompts")
    include_som: bool = Field(True, description="Generate Set-of-Mark annotated image with numbered boxes")
    # Compatibility fields (maintained for backward compatibility)
    include_captions: bool = Field(True, description="Deprecated - maintained for compatibility")
    include_ocr: bool = Field(True, description="Deprecated - maintained for compatibility")
    use_full_pipeline: bool = Field(True, description="Deprecated - maintained for compatibility")
    min_confidence: Optional[float] = Field(None, description="Deprecated - maintained for compatibility")
    iou_threshold: Optional[float] = Field(0.1, description="Deprecated - maintained for compatibility")
    use_paddleocr: bool = Field(True, description="Deprecated - maintained for compatibility")


class ElementDetection(BaseModel):
    """Detected UI element."""
    bbox: list[int] = Field(..., description="Bounding box [x, y, width, height]")
    center: list[int] = Field(..., description="Center point [x, y]")
    confidence: float = Field(..., description="Detection confidence score")
    type: str = Field(..., description="Element type ('text' or 'icon')")
    caption: Optional[str] = Field(None, description="Element caption/description")
    interactable: Optional[bool] = Field(None, description="Whether element is interactable/clickable")
    content: Optional[str] = Field(None, description="OCR text or caption content")
    source: Optional[str] = Field(None, description="Detection source (box_ocr_content_ocr or box_yolo_content_yolo)")
    element_id: Optional[int] = Field(None, description="Element index for SOM mapping")


class ParseResponse(BaseModel):
    """Response model for screenshot parsing."""
    elements: list[ElementDetection]
    count: int
    processing_time_ms: float
    image_size: dict[str, int]
    device: str
    som_image: Optional[str] = Field(None, description="Base64 encoded Set-of-Mark annotated image")
    ocr_detected: Optional[int] = Field(None, description="Number of OCR text elements detected")
    icon_detected: Optional[int] = Field(None, description="Number of icon elements detected")
    text_detected: Optional[int] = Field(None, description="Number of text elements in final result")
    interactable_count: Optional[int] = Field(None, description="Number of interactable elements")


class HealthResponse(BaseModel):
    """Health check response."""
    status: str
    version: str
    device: str
    models_loaded: bool


class ModelStatusResponse(BaseModel):
    """Model status response."""
    icon_detector: dict
    caption_model: dict
    weights_path: str


# Lifespan event handler (replaces deprecated on_event)
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle startup and shutdown events."""
    # Startup
    import torch

    print("=" * 50)
    print("Bytebot Holo 1.5-7B Service Starting")
    print("=" * 50)
    print(f"Device: {settings.device}")
    print(f"Port: {settings.port}")
    print(f"Model: Hcompany/Holo1.5-7B (Qwen2.5-VL base)")
    print("")
    print("GPU Diagnostics:")
    print(f"  PyTorch Version: {torch.__version__}")
    print(f"  CUDA Available: {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        print(f"  CUDA Version: {torch.version.cuda}")
        print(f"  GPU Count: {torch.cuda.device_count()}")
        for i in range(torch.cuda.device_count()):
            print(f"  GPU {i}: {torch.cuda.get_device_name(i)}")
    print("=" * 50)

    try:
        # Preload models
        print("Preloading Holo 1.5-7B model...")
        get_model()
        print("✓ Model preloaded successfully")
    except Exception as e:
        print(f"✗ Error preloading model: {e}")
        print("Model will be loaded on first request")

    print("=" * 50)
    print("Service ready!")
    print("=" * 50)

    yield

    # Shutdown
    print("Shutting down Holo 1.5-7B service...")


# Create FastAPI app with lifespan
app = FastAPI(
    title="Bytebot Holo 1.5-7B Service",
    description="Holo 1.5-7B UI localization for precision element targeting",
    version="1.0.0",
    lifespan=lifespan
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def decode_image(image_data: str) -> np.ndarray:
    """
    Decode base64 image to numpy array.

    Args:
        image_data: Base64 encoded image string

    Returns:
        RGB numpy array
    """
    try:
        # Remove data URL prefix if present
        if "," in image_data:
            image_data = image_data.split(",", 1)[1]

        # Decode base64
        image_bytes = base64.b64decode(image_data)

        # Convert to PIL Image
        image = Image.open(io.BytesIO(image_bytes))

        # Convert to RGB if needed
        if image.mode != "RGB":
            image = image.convert("RGB")

        # Convert to numpy array
        return np.array(image)

    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image data: {str(e)}")


@app.get("/", response_model=dict)
async def root():
    """Root endpoint."""
    return {
        "service": "Bytebot Holo 1.5-7B",
        "model": "Hcompany/Holo1.5-7B",
        "version": "1.0.0",
        "status": "running",
        "endpoints": {
            "parse": "/parse",
            "parse_upload": "/parse/upload",
            "health": "/health",
            "models": "/models/status"
        }
    }


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    try:
        model = get_model()
        models_loaded = True
    except Exception as e:
        models_loaded = False
        print(f"Health check error: {e}")

    return HealthResponse(
        status="healthy" if models_loaded else "unhealthy",
        version="1.0.0",
        device=settings.device,
        models_loaded=models_loaded
    )


@app.get("/models/status", response_model=ModelStatusResponse)
async def model_status():
    """Get model status and information."""
    try:
        model = get_model()

        return ModelStatusResponse(
            icon_detector={
                "loaded": True,
                "type": "Holo 1.5-7B",
                "path": model.model_name
            },
            caption_model={
                "loaded": True,
                "type": "Qwen2.5-VL-7B (base)",
                "path": model.model_name,
                "device": model.device,
                "dtype": str(model.dtype)
            },
            weights_path=model.model_name
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error getting model status: {str(e)}")


@app.post("/parse", response_model=ParseResponse)
async def parse_screenshot(request: ParseRequest = Body(...)):
    """
    Parse UI screenshot using Holo 1.5-7B localization.

    Supports two modes:
    1. Single-element mode (task provided): Localize specific element
    2. Multi-element mode (detect_multiple=True): Detect multiple elements using prompts

    Args:
        request: ParseRequest with base64 image and options

    Returns:
        ParseResponse with detected elements and optional SOM annotated image
    """
    try:
        # Decode image
        image = decode_image(request.image)

        # Get model
        model = get_model()

        # Use Holo 1.5-7B localization
        result = model.parse_screenshot(
            image,
            task=request.task,
            detect_multiple=request.detect_multiple,
            include_som=request.include_som,
        )

        return ParseResponse(**result)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error parsing screenshot: {str(e)}")


@app.post("/parse/upload", response_model=ParseResponse)
async def parse_screenshot_upload(
    file: UploadFile = File(...),
    task: Optional[str] = None,
    detect_multiple: bool = True,
    include_som: bool = True,
    # Deprecated parameters (maintained for compatibility)
    include_captions: bool = True,
    include_ocr: bool = True,
    use_full_pipeline: bool = True,
    min_confidence: Optional[float] = None,
    iou_threshold: float = 0.1,
    use_paddleocr: bool = True
):
    """
    Parse UI screenshot from file upload using Holo 1.5-7B.

    Args:
        file: Uploaded image file
        task: Specific task instruction for single-element mode
        detect_multiple: Detect multiple elements using various prompts
        include_som: Generate Set-of-Mark annotated image
        (other parameters deprecated but maintained for compatibility)

    Returns:
        ParseResponse with detected elements and optional SOM annotated image
    """
    try:
        # Read image file
        image_bytes = await file.read()
        image = Image.open(io.BytesIO(image_bytes))

        # Convert to RGB if needed
        if image.mode != "RGB":
            image = image.convert("RGB")

        # Convert to numpy array
        image_array = np.array(image)

        # Get model
        model = get_model()

        # Use Holo 1.5-7B localization
        result = model.parse_screenshot(
            image_array,
            task=task,
            detect_multiple=detect_multiple,
            include_som=include_som,
        )

        return ParseResponse(**result)

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error parsing screenshot: {str(e)}")


def main():
    """Run the FastAPI server."""
    uvicorn.run(
        "src.server:app",
        host=settings.host,
        port=settings.port,
        workers=settings.workers,
        reload=False,
        log_level="info"
    )


if __name__ == "__main__":
    main()
