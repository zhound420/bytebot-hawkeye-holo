"""FastAPI server for Holo 1.5-7B UI localization service."""

import io
import base64
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
from . import holo_wrapper
from .holo_wrapper import get_model


# GPU Info Helper
def get_gpu_info() -> dict:
    """Get GPU information including name and memory stats."""
    import torch
    import subprocess

    gpu_info = {
        "gpu_name": None,
        "gpu_memory_total_mb": None,
        "gpu_memory_used_mb": None,
        "gpu_memory_free_mb": None,
    }

    try:
        if torch.cuda.is_available() and settings.device == "cuda":
            # Get GPU name
            gpu_info["gpu_name"] = torch.cuda.get_device_name(0)

            # Use nvidia-smi for accurate memory tracking (includes llama.cpp GGUF allocations)
            # PyTorch's memory tracking only sees PyTorch tensors, not llama.cpp CUDA allocations
            try:
                result = subprocess.run(
                    ['nvidia-smi', '--query-gpu=memory.used,memory.total', '--format=csv,noheader,nounits'],
                    capture_output=True,
                    text=True,
                    timeout=2
                )
                if result.returncode == 0 and result.stdout.strip():
                    memory_used_str, total_memory_str = result.stdout.strip().split(',')
                    memory_used = int(memory_used_str.strip())
                    total_memory = int(total_memory_str.strip())

                    gpu_info["gpu_memory_total_mb"] = total_memory
                    gpu_info["gpu_memory_used_mb"] = memory_used
                    gpu_info["gpu_memory_free_mb"] = total_memory - memory_used
                else:
                    raise Exception("nvidia-smi returned no data")
            except Exception as smi_error:
                # Fallback to PyTorch (less accurate for llama.cpp but better than nothing)
                print(f"Warning: nvidia-smi failed ({smi_error}), falling back to PyTorch memory tracking")
                total_memory = torch.cuda.get_device_properties(0).total_memory / (1024 * 1024)
                memory_allocated = torch.cuda.memory_allocated(0) / (1024 * 1024)
                memory_reserved = torch.cuda.memory_reserved(0) / (1024 * 1024)
                memory_used = max(memory_allocated, memory_reserved)

                gpu_info["gpu_memory_total_mb"] = int(total_memory)
                gpu_info["gpu_memory_used_mb"] = int(memory_used)
                gpu_info["gpu_memory_free_mb"] = int(total_memory - memory_used)

        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available() and settings.device == "mps":
            # Apple Silicon - MPS doesn't provide detailed memory info
            import platform
            gpu_info["gpu_name"] = f"Apple {platform.machine()}"
            # MPS memory management is automatic, no direct API for stats

        elif settings.device == "cpu":
            import platform
            gpu_info["gpu_name"] = f"CPU ({platform.processor() or platform.machine()})"

    except Exception as e:
        print(f"Warning: Could not get GPU info: {e}")

    return gpu_info


# Pydantic models for request/response
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
        description="Override the active performance profile for this request",
    )


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
    raw_output: Optional[str] = Field(None, description="Raw model output segment that produced this detection")
    task: Optional[str] = Field(None, description="Original task instruction associated with the detection")


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
    ocr_detected: Optional[int] = Field(None, description="Number of OCR text elements detected")
    icon_detected: Optional[int] = Field(None, description="Number of icon elements detected")
    text_detected: Optional[int] = Field(None, description="Number of text elements in final result")
    interactable_count: Optional[int] = Field(None, description="Number of interactable elements")
    raw_model_outputs: Optional[list[str]] = Field(None, description="Raw Holo model outputs for debugging/traceability")
    model: str = Field("holo-1.5-7b", description="Source model identifier")


class HealthResponse(BaseModel):
    """Health check response."""
    status: str
    version: str
    device: str
    models_loaded: bool
    gpu_name: Optional[str] = Field(None, description="GPU device name (e.g., 'NVIDIA GeForce RTX 4090')")
    gpu_memory_total_mb: Optional[int] = Field(None, description="Total GPU memory in MB")
    gpu_memory_used_mb: Optional[int] = Field(None, description="Used GPU memory in MB")
    gpu_memory_free_mb: Optional[int] = Field(None, description="Free GPU memory in MB")


class ModelStatusResponse(BaseModel):
    """Model status response."""
    icon_detector: dict
    caption_model: dict
    weights_path: str


class GPUInfoResponse(BaseModel):
    """GPU information response."""
    device_type: str = Field(..., description="Device type: cuda, mps, or cpu")
    gpu_name: Optional[str] = Field(None, description="GPU device name")
    memory_total_mb: Optional[int] = Field(None, description="Total GPU memory in MB")
    memory_used_mb: Optional[int] = Field(None, description="Used GPU memory in MB")
    memory_free_mb: Optional[int] = Field(None, description="Free GPU memory in MB")
    memory_utilization_percent: Optional[float] = Field(None, description="Memory utilization percentage")


# Lifespan event handler (replaces deprecated on_event)
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle startup and shutdown events."""
    # Startup
    import torch

    print("=" * 50)
    print("Bytebot Holo 1.5-7B Service Starting (GGUF)")
    print("=" * 50)
    print(f"Device: {settings.device}")
    print(f"Port: {settings.port}")
    print(f"Model repo: {settings.model_repo}")
    print(f"Configured model file: {settings.model_filename}")
    print(f"Configured projector: {settings.mmproj_filename}")
    print("")
    print("Backend: llama-cpp-python with GPU acceleration")
    print(f"  PyTorch Version: {torch.__version__}")
    print(f"  CUDA Available: {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        print(f"  CUDA Version: {torch.version.cuda}")
        print(f"  GPU Count: {torch.cuda.device_count()}")
        for i in range(torch.cuda.device_count()):
            print(f"  GPU {i}: {torch.cuda.get_device_name(i)}")
    print("=" * 50)
    print("")
    print("⚡ Lazy loading enabled: Model will load on first API request")
    print("   First request will take 1-3 minutes (model download + loading)")
    print("   Subsequent requests will be fast (~1-3s per detection)")
    print("")
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
    model = get_model()
    return {
        "service": "Bytebot Holo 1.5-7B (GGUF)",
        "model_repo": model.model_repo,
        "model": model.model_filename,
        "quantization": model.dtype,
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
    # Check if model is already loaded (don't trigger loading)
    models_loaded = holo_wrapper._model_instance is not None

    # Get GPU information (doesn't require model)
    gpu_info = get_gpu_info()

    return HealthResponse(
        status="healthy",  # Service is always healthy if FastAPI is running
        version="1.0.0",
        device=settings.device,
        models_loaded=models_loaded,
        **gpu_info  # Include GPU info fields
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
                "path": model.model_name,
                "quantization": model.dtype
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


@app.get("/gpu-info", response_model=GPUInfoResponse)
async def gpu_info():
    """Get GPU information including device name and memory stats."""
    gpu_info = get_gpu_info()

    # Calculate memory utilization percentage
    memory_util = None
    if gpu_info["gpu_memory_total_mb"] and gpu_info["gpu_memory_used_mb"]:
        memory_util = (gpu_info["gpu_memory_used_mb"] / gpu_info["gpu_memory_total_mb"]) * 100

    return GPUInfoResponse(
        device_type=settings.device,
        gpu_name=gpu_info["gpu_name"],
        memory_total_mb=gpu_info["gpu_memory_total_mb"],
        memory_used_mb=gpu_info["gpu_memory_used_mb"],
        memory_free_mb=gpu_info["gpu_memory_free_mb"],
        memory_utilization_percent=memory_util
    )


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
        # Log incoming request
        print(f"→ Parse request: task={'Yes' if request.task else 'No'}, "
              f"detect_multiple={request.detect_multiple}, "
              f"profile={request.performance_profile or 'default'}, "
              f"max_detections={request.max_detections or 'auto'}")

        # Decode image
        image = decode_image(request.image)
        print(f"  Image decoded: {image.shape[1]}x{image.shape[0]} pixels")

        # Get model
        model = get_model()

        # Use Holo 1.5-7B localization
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

        result["model"] = "holo-1.5-7b"

        return ParseResponse(**result)

    except HTTPException:
        raise
    except Exception as e:
        print(f"✗ Parse error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error parsing screenshot: {str(e)}")


@app.post("/parse/upload", response_model=ParseResponse)
async def parse_screenshot_upload(
    file: UploadFile = File(...),
    task: Optional[str] = None,
    detect_multiple: bool = True,
    include_som: bool = True,
    max_detections: Optional[int] = None,
    min_confidence: Optional[float] = None,
    return_raw_outputs: bool = False,
    performance_profile: Optional[str] = None,
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
            max_detections=max_detections,
            min_confidence=min_confidence,
            return_raw_outputs=return_raw_outputs,
            performance_profile=performance_profile,
        )

        result["model"] = "holo-1.5-7b"

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
