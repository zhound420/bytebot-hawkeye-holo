#!/usr/bin/env python3
"""Benchmark OmniParser performance to identify bottlenecks."""

import time
import base64
import requests
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import io

# Test screenshot (create a synthetic one with UI elements)
print("=" * 60)
print("OmniParser Performance Benchmark")
print("=" * 60)

# Create a test screenshot programmatically
print("\n1. Creating synthetic test screenshot (1280x960)...")
img = Image.new('RGB', (1280, 960), color='white')
draw = ImageDraw.Draw(img)

# Draw some UI elements
draw.rectangle([50, 50, 200, 100], fill='blue', outline='black', width=2)
draw.rectangle([220, 50, 370, 100], fill='green', outline='black', width=2)
draw.rectangle([50, 120, 200, 170], fill='red', outline='black', width=2)
draw.text((60, 65), "Button 1", fill='white')
draw.text((230, 65), "Button 2", fill='white')
draw.text((60, 135), "Button 3", fill='white')

# Save to bytes and encode
buffer = io.BytesIO()
img.save(buffer, format='PNG')
image_data = base64.b64encode(buffer.getvalue()).decode('utf-8')

print(f"   ✓ Screenshot captured ({len(image_data)} bytes)")

# Test 1: Basic health check
print("\n2. Testing health endpoint...")
start = time.time()
response = requests.get("http://localhost:9989/health")
health_time = (time.time() - start) * 1000
print(f"   ✓ Health check: {health_time:.1f}ms")
print(f"   Status: {response.json()}")

# Test 2: Icon detection only (no OCR, no captions)
print("\n3. Testing icon detection only (no OCR, no captions)...")
start = time.time()
response = requests.post(
    "http://localhost:9989/parse",
    json={
        "image": image_data,
        "include_captions": False,
        "include_som": False,
        "include_ocr": False,
        "use_full_pipeline": False
    }
)
icon_only_time = (time.time() - start) * 1000
result = response.json()
print(f"   ✓ Icon detection: {icon_only_time:.1f}ms")
print(f"   Elements detected: {result['count']}")
print(f"   Server processing: {result['processing_time_ms']:.1f}ms")
print(f"   Network overhead: {icon_only_time - result['processing_time_ms']:.1f}ms")

# Test 3: Icon detection + captions (no OCR)
print("\n4. Testing icon detection + captions (no OCR)...")
start = time.time()
response = requests.post(
    "http://localhost:9989/parse",
    json={
        "image": image_data,
        "include_captions": True,
        "include_som": False,
        "include_ocr": False,
        "use_full_pipeline": False
    }
)
with_captions_time = (time.time() - start) * 1000
result = response.json()
print(f"   ✓ Icon + captions: {with_captions_time:.1f}ms")
print(f"   Elements detected: {result['count']}")
print(f"   Server processing: {result['processing_time_ms']:.1f}ms")
print(f"   Caption overhead: {with_captions_time - icon_only_time:.1f}ms")

# Test 4: Full pipeline (OCR + icons + captions)
print("\n5. Testing full pipeline (OCR + icons + captions)...")
start = time.time()
response = requests.post(
    "http://localhost:9989/parse",
    json={
        "image": image_data,
        "include_captions": True,
        "include_som": True,
        "include_ocr": True,
        "use_full_pipeline": True,
        "use_paddleocr": True
    }
)
full_pipeline_time = (time.time() - start) * 1000
result = response.json()
print(f"   ✓ Full pipeline: {full_pipeline_time:.1f}ms")
print(f"   Elements detected: {result['count']}")
print(f"   Server processing: {result['processing_time_ms']:.1f}ms")
print(f"   OCR detected: {result.get('ocr_detected', 0)}")
print(f"   Icons detected: {result.get('icon_detected', 0)}")
print(f"   Text detected: {result.get('text_detected', 0)}")
print(f"   OCR + caption overhead: {full_pipeline_time - icon_only_time:.1f}ms")

# Summary
print("\n" + "=" * 60)
print("PERFORMANCE SUMMARY")
print("=" * 60)
print(f"Health check:           {health_time:>8.1f}ms")
print(f"Icon detection only:    {icon_only_time:>8.1f}ms")
print(f"Icon + captions:        {with_captions_time:>8.1f}ms")
print(f"Full pipeline:          {full_pipeline_time:>8.1f}ms")
print()
print("Breakdown:")
print(f"  Captioning adds:      {with_captions_time - icon_only_time:>8.1f}ms")
print(f"  OCR adds:             {full_pipeline_time - with_captions_time:>8.1f}ms")
print(f"  Network overhead:     {icon_only_time - result['processing_time_ms']:>8.1f}ms")
print()
print("Expected on MPS (Apple Silicon): ~1000-2000ms for full pipeline")
print(f"Actual: {full_pipeline_time:.1f}ms")
if full_pipeline_time > 5000:
    print("⚠️  WARNING: Performance is slower than expected!")
    print("   Possible causes:")
    print("   - MPS not being used properly")
    print("   - OCR taking too long (PaddleOCR/EasyOCR)")
    print("   - Caption generation not batched efficiently")
else:
    print("✓ Performance is within expected range")

print("=" * 60)
