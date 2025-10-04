#!/usr/bin/env python3
"""
GPU Diagnostics Script for OmniParser Container
Verifies PyTorch CUDA setup and GPU availability.
"""

import sys
import platform

print("=" * 60)
print("OmniParser GPU Diagnostics")
print("=" * 60)
print()

# System info
print("System Information:")
print(f"  Platform: {platform.system()} {platform.machine()}")
print(f"  Python: {sys.version.split()[0]}")
print()

# PyTorch info
try:
    import torch
    print("PyTorch Information:")
    print(f"  Version: {torch.__version__}")
    print(f"  CUDA Available: {torch.cuda.is_available()}")

    if torch.cuda.is_available():
        print(f"  CUDA Version: {torch.version.cuda}")
        print(f"  cuDNN Version: {torch.backends.cudnn.version()}")
        print(f"  GPU Count: {torch.cuda.device_count()}")
        print()

        print("GPU Details:")
        for i in range(torch.cuda.device_count()):
            props = torch.cuda.get_device_properties(i)
            print(f"  GPU {i}: {torch.cuda.get_device_name(i)}")
            print(f"    Compute Capability: {props.major}.{props.minor}")
            print(f"    Total Memory: {props.total_memory / 1024**3:.2f} GB")
            print(f"    Multi-Processors: {props.multi_processor_count}")
        print()

        # Test GPU allocation
        try:
            test_tensor = torch.randn(1000, 1000, device='cuda')
            print("✓ GPU Memory Allocation: SUCCESS")
            del test_tensor
        except Exception as e:
            print(f"✗ GPU Memory Allocation: FAILED - {e}")
    else:
        print()
        print("⚠ CUDA Not Available - Possible Issues:")
        print("  1. nvidia-container-toolkit not installed on host")
        print("  2. Docker not configured with GPU support")
        print("  3. PyTorch not built with CUDA support")
        print("  4. CUDA version mismatch between PyTorch and driver")
        print()

        # Check for MPS (Apple Silicon)
        if hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
            print("✓ MPS (Apple Silicon) Available")
        else:
            print("  No GPU acceleration available - falling back to CPU")

except ImportError as e:
    print(f"✗ PyTorch not installed: {e}")
    sys.exit(1)

print()
print("=" * 60)

# Exit with appropriate code
if torch.cuda.is_available() or (hasattr(torch.backends, 'mps') and torch.backends.mps.is_available()):
    print("Status: GPU Acceleration Available ✓")
    sys.exit(0)
else:
    print("Status: CPU Fallback Mode ⚠")
    sys.exit(1)
