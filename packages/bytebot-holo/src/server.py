"""FastAPI server for Holo 1.5-7B UI navigation service (transformers)."""

import io
import base64
import time
from typing import Optional, Dict, Any
from contextlib import asynccontextmanager
import numpy as np
from PIL import Image
from fastapi import FastAPI, File, UploadFile, HTTPException, Body
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn
import torch

from .config import settings, NavigationStep, ActionSpace
from .holo_wrapper import get_model


# Request/Response Models
class NavigateRequest(BaseModel):
    """Request model for navigation endpoint."""
    image: str = Field(..., description="Base64 encoded screenshot")
    task: str = Field(..., description="Task to complete (e.g., 'Find the search bar')")
    step: int = Field(1, ge=1, description="Current step number")


class NavigateResponse(BaseModel):
    """Response model for navigation endpoint."""
    note: str = Field(..., description="Observation from screenshot")
    thought: str = Field(..., description="Reasoning about next action")
    action: Dict[str, Any] = Field(..., description="Next action to take")
    processing_time_ms: float = Field(..., description="Inference time in milliseconds")
    image_size: Dict[str, int] = Field(..., description="Original image dimensions")
    device: str = Field(..., description="Device used for inference")


class ParseRequest(BaseModel):
    """Request model for screenshot parsing with Holo 1.5-7B."""
    image: str = Field(..., description="Base64 encoded image")
    task: Optional[str] = Field(None, description="Specific task instruction for single-element mode")
    detect_multiple: bool = Field(True, description="Detect multiple elements using various prompts")
    include_som: bool = Field(True, description="Generate Set-of-Mark annotated image with numbered boxes")
    max_detections: Optional[int] = Field(
        None,
        ge=1,
        le=200,
        description="Optional cap on returned detections to limit token usage",
    )
    min_confidence: Optional[float] = Field(
        None,
        ge=0.0,
        le=1.0,
        description="Minimum confidence threshold for returned detections",
    )
    return_raw_outputs: bool = Field(
        False,
        description="Include raw model outputs for debugging (increases payload size)",
    )
    performance_profile: Optional[str] = Field(
        None,
        description="Performance profile: speed, balanced, or quality",
    )


class ElementDetection(BaseModel):
    """Detected UI element."""
    bbox: list[int] = Field(..., description="Bounding box [x, y, width, height]")
    center: list[int] = Field(..., description="Center point [x, y]")
    confidence: float = Field(..., description="Detection confidence")
    type: str = Field(..., description="Element type")
    caption: Optional[str] = Field(None, description="Element description")
    element_id: int = Field(..., description="Element index")


class ParseResponse(BaseModel):
    """Response model for screenshot parsing."""
    elements: list[ElementDetection]
    count: int
    processing_time_ms: float
    image_size: dict[str, int]
    device: str
    profile: Optional[str] = Field(None, description="Performance profile applied for this response")
    max_detections: Optional[int] = Field(None, description="Effective detection cap used")
    min_confidence: Optional[float] = Field(None, description="Confidence threshold applied")
    som_image: Optional[str] = Field(None, description="Base64 encoded Set-of-Mark annotated image")
    model: str = Field("holo-1.5-7b-transformers", description="Source model identifier")


class HealthResponse(BaseModel):
    """Health check response."""
    status: str
    version: str
    device: str
    backend: str
    gpu_name: Optional[str] = None
    gpu_memory_total_gb: Optional[float] = None
    gpu_memory_used_gb: Optional[float] = None


# Lifespan event handler
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle startup and shutdown events."""
    # Startup
    print("=" * 60)
    print("Bytebot Holo 1.5-7B Navigation Service Starting")
    print("=" * 60)
    print(f"Backend: HuggingFace Transformers (official implementation)")
    print(f"Device: {settings.device}")
    print(f"Model: {settings.model_repo}")
    print(f"Dtype: {settings.torch_dtype}")
    print(f"Port: {settings.port}")
    print("")
    print(f"PyTorch Version: {torch.__version__}")
    print(f"CUDA Available: {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        print(f"CUDA Version: {torch.version.cuda}")
        print(f"GPU Count: {torch.cuda.device_count()}")
        for i in range(torch.cuda.device_count()):
            print(f"GPU {i}: {torch.cuda.get_device_name(i)}")
    print("=" * 60)
    print("")
    print("⚡ Lazy loading enabled: Model loads on first request")
    print("   First request: ~1-3 min (model download + loading)")
    print("   Subsequent requests: ~2-4s per inference")
    print("")
    print("=" * 60)
    print("Service ready!")
    print("=" * 60)

    yield

    # Shutdown
    print("Shutting down Holo 1.5-7B service...")


# Create FastAPI app
app = FastAPI(
    title="Bytebot Holo 1.5-7B Navigation Service",
    description="Official transformers-based Holo 1.5-7B for UI navigation and localization",
    version="2.0.0",
    lifespan=lifespan
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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

        # Open with PIL
        image = Image.open(io.BytesIO(image_bytes))

        # Convert to RGB if needed
        if image.mode != "RGB":
            image = image.convert("RGB")

        # Convert to numpy array
        return np.array(image)

    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid image data: {str(e)}"
        )


@app.get("/", response_model=dict)
async def root():
    """Root endpoint."""
    return {
        "service": "Bytebot Holo 1.5-7B Navigation",
        "version": "2.0.0",
        "backend": "transformers",
        "endpoints": {
            "navigate": "POST /navigate - Main navigation endpoint (official format)",
            "parse": "POST /parse - Legacy localization endpoint (backward compatibility)",
            "health": "GET /health - Service health check",
        }
    }


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    gpu_name = None
    gpu_memory_total = None
    gpu_memory_used = None

    if torch.cuda.is_available() and settings.device == "cuda":
        gpu_name = torch.cuda.get_device_name(0)
        props = torch.cuda.get_device_properties(0)
        gpu_memory_total = props.total_memory / (1024 ** 3)  # Convert to GB
        gpu_memory_used = torch.cuda.memory_allocated(0) / (1024 ** 3)

    return HealthResponse(
        status="healthy",
        version="2.0.0",
        device=settings.device,
        backend="transformers",
        gpu_name=gpu_name,
        gpu_memory_total_gb=gpu_memory_total,
        gpu_memory_used_gb=gpu_memory_used,
    )


@app.post("/navigate", response_model=NavigateResponse)
async def navigate(request: NavigateRequest = Body(...)):
    """
    Main navigation endpoint using official Holo 1.5 format.

    Analyzes screenshot and returns next action with reasoning.

    Args:
        request: NavigateRequest with image, task, and step

    Returns:
        NavigateResponse with note, thought, and action
    """
    try:
        start_time = time.time()

        # Log request
        print(f"→ Navigate request: task='{request.task}', step={request.step}")

        # Decode image
        image = decode_image(request.image)
        print(f"  Image decoded: {image.shape[1]}x{image.shape[0]} pixels")

        # Get model
        model = get_model()

        # Run navigation
        navigation_step = model.navigate(
            image_array=image,
            task=request.task,
            step=request.step,
        )

        processing_time_ms = (time.time() - start_time) * 1000

        # Convert NavigationStep to response format
        return NavigateResponse(
            note=navigation_step.note,
            thought=navigation_step.thought,
            action=navigation_step.action.model_dump(),  # Pydantic v2
            processing_time_ms=processing_time_ms,
            image_size={"width": image.shape[1], "height": image.shape[0]},
            device=settings.device,
        )

    except HTTPException:
        raise
    except Exception as e:
        print(f"✗ Navigation error: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Navigation error: {str(e)}")


@app.post("/parse", response_model=ParseResponse)
async def parse_screenshot(request: ParseRequest = Body(...)):
    """
    Parse UI screenshot using Holo 1.5-7B localization (backward compatible).

    Supports two modes:
    1. Single-element mode (task provided): Localize specific element
    2. Multi-element mode (detect_multiple=True): Detect multiple elements using prompts

    Args:
        request: ParseRequest with base64 image and options

    Returns:
        ParseResponse with detected elements and optional SOM annotated image
    """
    try:
        # Log incoming request
        print(f"→ Parse request: task={'Yes' if request.task else 'No'}, "
              f"detect_multiple={request.detect_multiple}, "
              f"profile={request.performance_profile or 'balanced'}, "
              f"max_detections={request.max_detections or 'default'}")

        # Decode image
        image = decode_image(request.image)
        print(f"  Image decoded: {image.shape[1]}x{image.shape[0]} pixels")

        # Get model
        model = get_model()

        # Use Holo 1.5-7B parse_screenshot (backward compatible)
        result = model.parse_screenshot(
            image,
            task=request.task,
            detect_multiple=request.detect_multiple,
            include_som=request.include_som,
            max_detections=request.max_detections,
            min_confidence=request.min_confidence,
            return_raw_outputs=request.return_raw_outputs,
            performance_profile=request.performance_profile,
        )

        result["model"] = "holo-1.5-7b-transformers"

        return ParseResponse(**result)

    except HTTPException:
        raise
    except Exception as e:
        print(f"✗ Parse error: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error parsing screenshot: {str(e)}")


@app.post("/parse/upload", response_model=ParseResponse)
async def parse_upload(
    file: UploadFile = File(...),
    task: Optional[str] = None,
    detect_multiple: bool = True,
    include_som: bool = True,
    max_detections: Optional[int] = None,
    min_confidence: Optional[float] = None,
    performance_profile: Optional[str] = None,
):
    """
    Parse UI screenshot from file upload using Holo 1.5-7B.

    Args:
        file: Uploaded image file
        task: Specific task instruction for single-element mode
        detect_multiple: Detect multiple elements using various prompts
        include_som: Generate Set-of-Mark annotated image
        max_detections: Optional cap for detections
        min_confidence: Optional confidence threshold
        performance_profile: Optional profile (speed/balanced/quality)

    Returns:
        ParseResponse with detected elements and optional SOM annotated image
    """
    try:
        # Read image file
        image_bytes = await file.read()

        # Encode to base64
        image_b64 = base64.b64encode(image_bytes).decode('utf-8')

        # Call main parse endpoint
        request = ParseRequest(
            image=image_b64,
            task=task,
            detect_multiple=detect_multiple,
            include_som=include_som,
            max_detections=max_detections,
            min_confidence=min_confidence,
            performance_profile=performance_profile,
        )
        return await parse_screenshot(request)

    except Exception as e:
        print(f"✗ Upload parse error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Upload error: {str(e)}")


if __name__ == "__main__":
    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        workers=settings.workers,
    )
