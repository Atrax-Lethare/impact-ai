import os
import json
import google.generativeai as genai
from dotenv import load_dotenv

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import joblib
import numpy as np

# Import your custom ranker class
from resource_ranker import ResourceRanker 

# Load environment variables
load_dotenv()

# --- NEW: Configure Gemini API ---
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

app = FastAPI(title="NeuroLearn AI Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 1. Load ML Models ---
try:
    model = joblib.load("model.joblib")
    scaler = joblib.load("scaler.joblib")
    print("Successfully loaded model and scaler.")
except Exception as e:
    print(f"Error loading model/scaler: {e}")

# --- 2. Initialize NLP Ranker ---
try:
    ranker = ResourceRanker()
    print("Successfully initialized ResourceRanker.")
except Exception as e:
    print(f"Error initializing ResourceRanker: {e}")

# --- 3. Pydantic Models ---
class TelemetryData(BaseModel):
    time_to_first_click: float
    task_completion_time: float
    mouse_velocity_avg: float
    cursor_straightness: float
    scroll_reversals: int
    repetitive_clicks: int
    back_button_usage: int
    text_dwell_time: float

class TelemetryPayload(BaseModel):
    userId: str
    telemetry: TelemetryData

class ResourcePayload(BaseModel):
    text: str

class GenerateLessonPayload(BaseModel):
    text: str
    profile: str = "default"

CLUSTER_MAPPING = {
    0: "aphasia", 1: "memory", 2: "autism", 3: "dementia", 4: "impairment"
}

# --- 4. Endpoints ---

@app.post("/v1/analyze-telemetry")
async def analyze_telemetry(payload: TelemetryPayload):
    # (Your existing telemetry logic stays exactly the same)
    try:
        t = payload.telemetry
        features = np.array([[t.time_to_first_click, t.task_completion_time, t.mouse_velocity_avg, t.cursor_straightness, t.scroll_reversals, t.repetitive_clicks, t.back_button_usage, t.text_dwell_time]])
        scaled_features = scaler.transform(features)
        cluster_id = int(model.predict(scaled_features)[0])
        ui_profile = CLUSTER_MAPPING.get(cluster_id, "default")
        return {"profile": ui_profile}
    except Exception as e:
        raise HTTPException(status_code=500, detail="Error processing telemetry data")

# NEW ENDPOINT: Resource Ranker
@app.post("/v1/rank-resource")
async def rank_resource(payload: ResourcePayload):
    try:
        if not payload.text or len(payload.text.strip()) == 0:
            raise HTTPException(status_code=400, detail="No text provided")
            
        # Run the text through your NLP class
        analysis_result = ranker.analyze(payload.text)
        return analysis_result
        
    except Exception as e:
        print(f"Ranking error: {e}")
        raise HTTPException(status_code=500, detail="Error analyzing resource")
    
@app.post("/v1/generate-lesson")
async def generate_lesson(payload: GenerateLessonPayload):
    try:
        if not payload.text:
            raise HTTPException(status_code=400, detail="No text provided")

        # Initialize the Gemini 1.5 Flash model (Lightning fast and free tier eligible)
        model = genai.GenerativeModel('gemini-2.5-flash')

        # The System Prompt is identical, just passed differently to Gemini
        prompt = f"""
        You are an expert adaptive learning tutor. The user is currently in the '{payload.profile}' cognitive profile.
        Take the provided source text and break it down into 2 to 3 micro-learning chunks.
        Adapt your vocabulary, sentence length, and tone to suit the '{payload.profile}' profile.
        
        You MUST return the output as a strictly formatted JSON object matching this exact schema:
        {{
            "lesson_title": "A short, engaging title for the whole lesson",
            "chunks": [
                {{
                    "id": 1,
                    "icon": "ph-brain", 
                    "title": "Concept Title",
                    "bullets": ["Point 1", "Point 2"],
                    "example": "A concrete example illustrating the concept."
                }}
            ]
        }}
        Use Phosphor Icon class names for the 'icon' field (e.g., ph-tree, ph-buildings, ph-rocket).

        Source Text to adapt:
        {payload.text[:3000]}
        """

        # Generate content, explicitly telling Gemini to return application/json
        response = model.generate_content(
            prompt,
            generation_config={"response_mime_type": "application/json"}
        )

        # Gemini returns the raw JSON string in response.text
        lesson_data = json.loads(response.text)
        return lesson_data

    except Exception as e:
        print(f"Gemini Generation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    
