"""FastAPI server for OmniParser v2.0 UI element detection service."""

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
from .omniparser_wrapper import get_model


# Pydantic models for request/response
class ParseRequest(BaseModel):
    """Request model for screenshot parsing."""
    image: str = Field(..., description="Base64 encoded image")
    include_captions: bool = Field(True, description="Generate captions for elements")
    include_som: bool = Field(True, description="Generate Set-of-Mark annotated image with numbered boxes")
    include_ocr: bool = Field(True, description="Run OCR text detection (PaddleOCR/EasyOCR)")
    use_full_pipeline: bool = Field(True, description="Use full OmniParser pipeline with OCR + overlap filtering")
    min_confidence: Optional[float] = Field(None, description="Minimum confidence threshold")
    iou_threshold: Optional[float] = Field(0.1, description="IoU threshold for overlap removal (official demo: 0.1)")
    use_paddleocr: bool = Field(True, description="Use PaddleOCR (True) or EasyOCR (False)")


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
    print("Bytebot OmniParser Service Starting")
    print("=" * 50)
    print(f"Device: {settings.device}")
    print(f"Port: {settings.port}")
    print(f"Weights: {settings.weights_dir}")
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
        print("Preloading models...")
        get_model()
        print("✓ Models preloaded successfully")
    except Exception as e:
        print(f"✗ Error preloading models: {e}")
        print("Models will be loaded on first request")

    print("=" * 50)
    print("Service ready!")
    print("=" * 50)

    yield

    # Shutdown
    print("Shutting down OmniParser service...")


# Create FastAPI app with lifespan
app = FastAPI(
    title="Bytebot OmniParser Service",
    description="OmniParser v2.0 UI element detection and captioning",
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
        "service": "Bytebot OmniParser",
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
                "loaded": model.icon_detector is not None,
                "type": "YOLOv8",
                "path": str(settings.icon_detect_dir)
            },
            caption_model={
                "loaded": model.caption_model is not None,
                "type": "Florence-2",
                "path": str(settings.icon_caption_dir),
                "device": model.device,
                "dtype": str(model.dtype)
            },
            weights_path=str(settings.weights_dir)
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error getting model status: {str(e)}")


@app.post("/parse", response_model=ParseResponse)
async def parse_screenshot(request: ParseRequest = Body(...)):
    """
    Parse UI screenshot to detect and caption elements.

    Supports two modes:
    1. Full Pipeline (use_full_pipeline=True): OCR + icon detection + interactivity + overlap filtering
    2. Basic Mode (use_full_pipeline=False): Icon detection only (legacy)

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

        # Choose pipeline based on request
        if request.use_full_pipeline:
            # Use full OmniParser pipeline with OCR, interactivity, and overlap filtering
            result = model.parse_screenshot_full(
                image,
                include_captions=request.include_captions,
                include_som=request.include_som,
                include_ocr=request.include_ocr,
                conf_threshold=request.min_confidence,
                iou_threshold=request.iou_threshold,
                use_paddleocr=request.use_paddleocr
            )
        else:
            # Use basic pipeline (icon detection only, legacy mode)
            result = model.parse_screenshot(
                image,
                include_captions=request.include_captions,
                include_som=request.include_som,
                conf_threshold=request.min_confidence
            )

        return ParseResponse(**result)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error parsing screenshot: {str(e)}")


@app.post("/parse/upload", response_model=ParseResponse)
async def parse_screenshot_upload(
    file: UploadFile = File(...),
    include_captions: bool = True,
    include_som: bool = True,
    include_ocr: bool = True,
    use_full_pipeline: bool = True,
    min_confidence: Optional[float] = None,
    iou_threshold: float = 0.1,
    use_paddleocr: bool = True
):
    """
    Parse UI screenshot from file upload.

    Args:
        file: Uploaded image file
        include_captions: Generate captions for elements
        include_som: Generate Set-of-Mark annotated image
        include_ocr: Run OCR text detection
        use_full_pipeline: Use full OmniParser pipeline
        min_confidence: Minimum confidence threshold
        iou_threshold: IoU threshold for overlap removal
        use_paddleocr: Use PaddleOCR (True) or EasyOCR (False)

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

        # Choose pipeline based on request
        if use_full_pipeline:
            result = model.parse_screenshot_full(
                image_array,
                include_captions=include_captions,
                include_som=include_som,
                include_ocr=include_ocr,
                conf_threshold=min_confidence,
                iou_threshold=iou_threshold,
                use_paddleocr=use_paddleocr
            )
        else:
            result = model.parse_screenshot(
                image_array,
                include_captions=include_captions,
                include_som=include_som,
                conf_threshold=min_confidence
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
