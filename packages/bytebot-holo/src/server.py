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


class LegacyParseRequest(BaseModel):
    """Legacy request for backward compatibility with old /parse endpoint."""
    image: str = Field(..., description="Base64 encoded image")
    task: Optional[str] = Field(None, description="Task description")


class LegacyElementDetection(BaseModel):
    """Legacy element format for backward compatibility."""
    bbox: list[int] = Field(..., description="Bounding box [x, y, width, height]")
    center: list[int] = Field(..., description="Center point [x, y]")
    confidence: float = Field(default=0.85, description="Detection confidence")
    type: str = Field(default="clickable", description="Element type")
    caption: Optional[str] = Field(None, description="Element description")
    element_id: int = Field(..., description="Element index")


class LegacyParseResponse(BaseModel):
    """Legacy response for backward compatibility."""
    elements: list[LegacyElementDetection]
    count: int
    processing_time_ms: float
    image_size: Dict[str, int]
    device: str
    model: str = Field(default="holo-1.5-7b-transformers")


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


@app.post("/parse", response_model=LegacyParseResponse)
async def parse_legacy(request: LegacyParseRequest = Body(...)):
    """
    Legacy parse endpoint for backward compatibility.

    Translates navigation output to old element detection format.

    Args:
        request: LegacyParseRequest with image and optional task

    Returns:
        LegacyParseResponse with detected elements
    """
    try:
        start_time = time.time()

        # Use default task if none provided
        task = request.task or "Identify all interactive UI elements"

        print(f"→ Legacy parse request: task='{task}'")

        # Decode image
        image = decode_image(request.image)

        # Get model
        model = get_model()

        # Run navigation
        navigation_step = model.navigate(
            image_array=image,
            task=task,
            step=1,
        )

        processing_time_ms = (time.time() - start_time) * 1000

        # Translate navigation action to legacy element format
        elements = []

        action = navigation_step.action

        # Only create element if action has coordinates
        if hasattr(action, 'x') and hasattr(action, 'y'):
            if action.x is not None and action.y is not None:
                # Create element from action coordinates
                element = LegacyElementDetection(
                    bbox=[action.x - 20, action.y - 20, 40, 40],  # 40x40 box around center
                    center=[action.x, action.y],
                    confidence=0.85,  # Default confidence
                    type="clickable",
                    caption=getattr(action, 'element', navigation_step.thought),
                    element_id=0,
                )
                elements.append(element)

        return LegacyParseResponse(
            elements=elements,
            count=len(elements),
            processing_time_ms=processing_time_ms,
            image_size={"width": image.shape[1], "height": image.shape[0]},
            device=settings.device,
        )

    except HTTPException:
        raise
    except Exception as e:
        print(f"✗ Legacy parse error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Parse error: {str(e)}")


@app.post("/parse/upload", response_model=LegacyParseResponse)
async def parse_upload_legacy(
    file: UploadFile = File(...),
    task: Optional[str] = None,
):
    """
    Legacy parse upload endpoint for backward compatibility.

    Args:
        file: Uploaded image file
        task: Optional task description

    Returns:
        LegacyParseResponse with detected elements
    """
    try:
        # Read image file
        image_bytes = await file.read()

        # Encode to base64
        image_b64 = base64.b64encode(image_bytes).decode('utf-8')

        # Call main parse endpoint
        request = LegacyParseRequest(image=image_b64, task=task)
        return await parse_legacy(request)

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
