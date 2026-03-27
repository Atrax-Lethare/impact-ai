import json
import numpy as np
import torch
import torch.nn as nn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from openai import OpenAI
import urllib.parse

# ==========================================
# 1. Configuration & Setup
# ==========================================
# Pointing the OpenAI SDK to your local Ollama instance
OLLAMA_CLIENT = OpenAI(
    base_url="http://localhost:11434/v1",
    api_key="ollama" # Ollama requires a string here, but ignores the actual value
)

LSTM_MODEL_PATH = "lstm_pipeline_model.pth"     

DISORDER_MAP = {
    0: "Aphasia",
    1: "Dementia",
    2: "Autism",
    3: "General_Cognitive_Impairment",
    4: "Short_Term_Memory_Loss"
}

# ==========================================
# 2. PyTorch Model Architecture
# ==========================================
class DualOutputLSTM(nn.Module):
    def __init__(self, input_size, hidden_size=64, num_classes=5):
        super(DualOutputLSTM, self).__init__()
        self.lstm = nn.LSTM(input_size, hidden_size, batch_first=True)
        self.dropout = nn.Dropout(0.3)
        self.fc = nn.Linear(hidden_size, 32)
        self.relu = nn.ReLU()
        
        self.out_class = nn.Linear(32, num_classes)
        self.out_severity = nn.Linear(32, 1)

    def forward(self, x):
        lstm_out, _ = self.lstm(x)
        last_step_out = lstm_out[:, -1, :]
        x = self.dropout(last_step_out)
        x = self.relu(self.fc(x))
        class_preds = self.out_class(x)
        severity_preds = self.out_severity(x)
        return class_preds, severity_preds

# ==========================================
# 3. Core Logic Functions
# ==========================================
def analyze_user_behavior(sequence_data: np.ndarray):
    try:
        input_size = sequence_data.shape[1] 
        model = DualOutputLSTM(input_size=input_size)
        model.load_state_dict(torch.load(LSTM_MODEL_PATH, weights_only=True))
        model.eval() 
        
        sequence_tensor = torch.tensor(sequence_data, dtype=torch.float32).unsqueeze(0)
        
        with torch.no_grad():
            out_class, out_sev = model(sequence_tensor)
            
        predicted_class_idx = torch.argmax(out_class, dim=1).item()
        severity_score = out_sev.item()
        
    except Exception as e:
        print(f"⚠️ Could not load PyTorch model ({e}). Using fallback.")
        predicted_class_idx = 4 
        severity_score = 6.0
        
    disorder = DISORDER_MAP.get(predicted_class_idx, "Unknown")
    return disorder, severity_score

def calculate_generation_metrics(disorder: str, severity: float) -> dict:
    sev_ratio = min(max(severity, 1.0), 10.0) / 10.0
    metrics = {
        "lexical_complexity": 1.0, 
        "syntax_style": "Standard",
        "chunking_limit": 5, 
        "summary_frequency": "None",
        "icon_pairing_density": 0.0,
        "sensory_intensity": "Standard",
        "animations_allowed": True,
        "visual_clutter_index": 1.0,
        "require_persistent_instructions": False,
        "timers_enabled": True
    }

    if disorder == "Aphasia":
        metrics["lexical_complexity"] = round(max(0.2, 1.0 - (0.8 * sev_ratio)), 2)
        metrics["icon_pairing_density"] = round(min(1.0, 0.3 + (0.7 * sev_ratio)), 2)
        metrics["sensory_intensity"] = "High_Contrast"
    elif disorder == "Dementia":
        metrics["syntax_style"] = "Active_Direct"
        metrics["chunking_limit"] = max(1, int(4 - (3 * sev_ratio)))
        metrics["lexical_complexity"] = round(max(0.4, 1.0 - (0.6 * sev_ratio)), 2)
    elif disorder == "Autism":
        metrics["syntax_style"] = "Literal"
        metrics["animations_allowed"] = False
        metrics["sensory_intensity"] = "Muted"
        metrics["visual_clutter_index"] = round(max(0.1, 1.0 - (0.8 * sev_ratio)), 2)
    elif disorder == "Short_Term_Memory_Loss":
        metrics["require_persistent_instructions"] = True
        metrics["summary_frequency"] = "Per_Paragraph" if severity > 7 else "Per_Section"
        metrics["chunking_limit"] = max(1, int(4 - (2 * sev_ratio)))

    return metrics

def generate_adapted_asset(source_material: str, user_request: str, metrics: dict, user_profile: str) -> dict:
    system_prompt = f"""
    You are an expert educational AI tutor.
    The user has a {user_profile} cognitive profile.
    
    CRITICAL GENERATION METRICS:
    - Lexical Complexity: {metrics['lexical_complexity']}
    - Syntax Style: {metrics['syntax_style']}
    
    SOURCE MATERIAL:
    {source_material}

    USER REQUEST:
    {user_request}
    
    CRITICAL INSTRUCTION: If the USER REQUEST asks for a "mind map", "diagram", or "flowchart", you MUST generate Mermaid.js code and place it in the "mind_map_mermaid" field. Do NOT just write a text outline.
    
    OUTPUT SCHEMA INSTRUCTIONS (JSON ONLY):
    {{
        "study_blocks": [
            {{
                "heading": "string",
                "adapted_text": "string (formatted in HTML)",
                "image_prompt": "string (A detailed visual description for an image generator, or null)"
            }}
        ],
        "mind_map_mermaid": "string (Mermaid.js 'graph TD' code ONLY. No markdown wrappers. Use \\n for line breaks. Example: 'graph TD\\nA-->B'. Return null if not applicable)"
    }}
    """
    try:
        response = OLLAMA_CLIENT.chat.completions.create(
            messages=[{"role": "system", "content": system_prompt}],
            model="llama3", 
            response_format={"type": "json_object"},
            temperature=0.2 
        )
        return json.loads(response.choices[0].message.content)
    except Exception as e:
        return {"error": str(e)}
    
# ==========================================
# 4. FastAPI Setup & Endpoints
# ==========================================
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

class TelemetryPayload(BaseModel):
    userId: str
    telemetry: dict

class LessonPayload(BaseModel):
    source_material: str  # The full PDF text (always sent)
    user_request: str     # The specific button clicked or custom message
    ui_profile: str
    severity_score: float = 5.0 

def generate_adapted_asset(source_material: str, user_request: str, metrics: dict, user_profile: str) -> dict:
    system_prompt = f"""
    You are an expert educational AI tutor.
    The user has a {user_profile} cognitive profile.
    
    CRITICAL GENERATION METRICS:
    - Lexical Complexity: {metrics['lexical_complexity']} (0.1 is extremely simple, 1.0 is advanced).
    - Syntax Style: {metrics['syntax_style']}
    - Max Ideas per Chunk: {metrics['chunking_limit']}
    
    SOURCE MATERIAL:
    {source_material}

    USER REQUEST / CURRENT CONTEXT:
    {user_request}
    
    INSTRUCTIONS: 
    Fulfill the "USER REQUEST" strictly using the facts from the "SOURCE MATERIAL". Do not make up outside information.
    
    OUTPUT SCHEMA INSTRUCTIONS (JSON ONLY):
    {{
        "study_blocks": [
            {{
                "heading": "string",
                "adapted_text": "string (formatted in HTML, following the Lexical Complexity and Syntax limits)"
            }}
        ]
    }}
    """
    try:
        response = OLLAMA_CLIENT.chat.completions.create(
            messages=[
                {"role": "system", "content": system_prompt}
            ],
            model="llama3", 
            response_format={"type": "json_object"},
            temperature=0.1 
        )
        return json.loads(response.choices[0].message.content)
    except Exception as e:
        return {"error": str(e)}

@app.post("/predict-profile")
async def predict_profile(payload: TelemetryPayload):
    try:
        mock_sequence = np.random.rand(5, 10) 
        disorder, severity = analyze_user_behavior(mock_sequence)
        
        profile_class = disorder.lower().replace("_", "")
        if "memory" in profile_class: profile_class = "memory"
        if "impairment" in profile_class: profile_class = "impairment"

        return {
            "status": "success",
            "predicted_profile": profile_class, 
            "severity_score": severity
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/generate-lesson")
async def generate_lesson(payload: LessonPayload):
    try:
        standardized_profile = payload.ui_profile.title()
        if "Memory" in standardized_profile: standardized_profile = "Short_Term_Memory_Loss"

        gen_metrics = calculate_generation_metrics(standardized_profile, payload.severity_score)
        
        ai_response = generate_adapted_asset(
            source_material=payload.source_material, 
            user_request=payload.user_request, 
            metrics=gen_metrics, 
            user_profile=standardized_profile
        )
        
        html_output = ""
        
        # 1. Build the Text and Images
        if "study_blocks" in ai_response:
            for block in ai_response["study_blocks"]:
                html_output += f"<h2 style='text-align: center; margin-bottom: 24px;'>{block.get('heading', '')}</h2>"
                
                # Dynamic Image Generation via Pollinations API
                img_prompt = block.get('image_prompt')
                # Check that it isn't null, empty, or a string saying "null"
                if img_prompt and str(img_prompt).lower() not in ["null", "none", "", "n/a"]:
                    
                    # Clean the prompt to prevent HTML attribute breaking
                    clean_prompt = str(img_prompt).replace("'", "").replace('"', "").strip()
                    
                    # Use quote_plus to safely encode spaces as '+'
                    encoded_prompt = urllib.parse.quote_plus(f"{clean_prompt} highly detailed educational diagram")
                    img_url = f"https://image.pollinations.ai/prompt/{encoded_prompt}?width=800&height=400&nologo=true"
                    
                    # Add an onerror fallback and a skeleton loader background
                    html_output += f"""
                    <div style="text-align: center; margin: 24px auto; max-width: 800px;">
                        <img src="{img_url}" 
                             alt="{clean_prompt}" 
                             class="ai-generated-image" 
                             style="min-height: 300px; background-color: var(--color-bg-gray); border-radius: 12px; width: 100%; object-fit: cover;"
                             onerror="this.onerror=null; this.src='https://placehold.co/800x400/1e293b/4ade80?text=AI+Image+Server+Busy'; this.alt='Timeout';" />
                        <p style="font-size: 12px; color: var(--color-text-disabled); margin-top: 8px;">Generated Visual: {clean_prompt}</p>
                    </div>
                    """
                    
                html_output += f"<div style='font-size: 1.1em; line-height: 1.8;'>{block.get('adapted_text', '')}</div>"
        
        # 2. Build the Mind Map (With Markdown Cleaner)
        mermaid_code = ai_response.get("mind_map_mermaid")
        if mermaid_code and str(mermaid_code).lower() != "null":
            # CLEANER: Strip out ```mermaid and ``` if the AI hallucinated them inside the JSON string
            clean_mermaid = str(mermaid_code).replace("```mermaid", "").replace("```", "").strip()
            
            html_output += f"""
            <div style="margin-top: 40px; background: var(--color-bg-gray); padding: 20px; border-radius: 12px; border: 1px solid var(--color-divider);">
                <h3 style='text-align: center; color: var(--color-primary); margin-bottom: 16px;'>Concept Map</h3>
                <div class="mermaid" style="text-align: center; display: flex; justify-content: center;">
                    {clean_mermaid}
                </div>
            </div>
            """
            
        return {
            "status": "success",
            "asset_data": {"content": html_output}
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))