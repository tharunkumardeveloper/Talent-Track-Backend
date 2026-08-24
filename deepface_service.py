"""
DeepFace Face Verification Service for TalentTrack
Runs as a FastAPI backend service for face comparison
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import base64
import io
import numpy as np
from PIL import Image
from deepface import DeepFace
import logging

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="TalentTrack Face Verification API")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class VerificationRequest(BaseModel):
    img1_base64: str  # Registered profile image
    img2_base64: str  # Live captured image
    model_name: str = "Facenet"
    detector_backend: str = "opencv"
    distance_metric: str = "cosine"

def base64_to_image(base64_string: str) -> np.ndarray:
    """Convert base64 string to numpy array image"""
    try:
        # Remove data URL prefix if present
        if ',' in base64_string:
            base64_string = base64_string.split(',')[1]
        
        # Decode base64
        img_data = base64.b64decode(base64_string)
        img = Image.open(io.BytesIO(img_data))
        
        # Convert to RGB if needed
        if img.mode != 'RGB':
            img = img.convert('RGB')
        
        # Convert to numpy array
        return np.array(img)
    except Exception as e:
        logger.error(f"Error converting base64 to image: {e}")
        raise HTTPException(status_code=400, detail="Invalid image data")

@app.get("/")
def root():
    return {
        "service": "TalentTrack Face Verification",
        "status": "running",
        "endpoints": {
            "verify": "/verify",
            "health": "/health"
        }
    }

@app.get("/health")
def health_check():
    return {"status": "healthy", "service": "deepface"}

@app.post("/verify")
async def verify_faces(request: VerificationRequest):
    """
    Verify if two face images match
    Returns: {verified: bool, distance: float, threshold: float}
    """
    try:
        logger.info("Received face verification request")
        
        # Convert base64 images to numpy arrays
        img1 = base64_to_image(request.img1_base64)
        img2 = base64_to_image(request.img2_base64)
        
        logger.info(f"Images converted - img1: {img1.shape}, img2: {img2.shape}")
        
        # Perform face verification using DeepFace
        result = DeepFace.verify(
            img1_path=img1,
            img2_path=img2,
            model_name=request.model_name,
            detector_backend=request.detector_backend,
            distance_metric=request.distance_metric,
            enforce_detection=True,
            align=True
        )
        
        logger.info(f"Verification result: {result}")
        
        return {
            "verified": result["verified"],
            "distance": result["distance"],
            "threshold": result["threshold"],
            "model": request.model_name,
            "detector": request.detector_backend,
            "metric": request.distance_metric
        }
        
    except ValueError as e:
        # Face not detected
        logger.warning(f"Face detection failed: {e}")
        return {
            "verified": False,
            "distance": 1.0,
            "threshold": 0.4,
            "error": "No face detected in one or both images"
        }
    except Exception as e:
        logger.error(f"Verification error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/detect")
async def detect_face(img_base64: str):
    """
    Detect if a face exists in the image
    Returns: {face_detected: bool, face_count: int}
    """
    try:
        img = base64_to_image(img_base64)
        
        # Detect faces
        faces = DeepFace.extract_faces(
            img_path=img,
            detector_backend="opencv",
            enforce_detection=False
        )
        
        return {
            "face_detected": len(faces) > 0,
            "face_count": len(faces),
            "faces": faces
        }
    except Exception as e:
        logger.error(f"Face detection error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000, log_level="info")
