import os
import json
import numpy as np
import pdfplumber
from openai import OpenAI

# Removed TensorFlow imports
import torch
import torch.nn as nn

# ==========================================
# 1. Configuration & Setup
# ==========================================
# Make sure to run: export GROQ_API_KEY="your_key_here"
OLLAMA_CLIENT = OpenAI(
    base_url="http://localhost:11434/v1",
    api_key="ollama" # The SDK requires an API key, but Ollama ignores it
)

# Changed from .h5 to .pth
LSTM_MODEL_PATH = "lstm_pipeline_model.pth"     

DISORDER_MAP = {
    0: "Aphasia",
    1: "Dementia",
    2: "Autism",
    3: "General_Cognitive_Impairment",
    4: "Short_Term_Memory_Loss"
}

# ==========================================
# 1.5 The PyTorch Model Architecture
# ==========================================
# We must define the network structure here so PyTorch knows how to map the saved weights.
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
# 2. The Predictive Engine (PyTorch)
# ==========================================
def analyze_user_behavior(sequence_data: np.ndarray):
    """
    Passes raw user session clicks/time data through the trained LSTM 
    to predict their cognitive profile and severity.
    """
    print("🧠 [1/4] Analyzing user behavior sequence...")
    
    try:
        # sequence_data shape is expected to be (SEQ_LENGTH, FEATURES)
        input_size = sequence_data.shape[1] 
        
        # Instantiate the model architecture
        model = DualOutputLSTM(input_size=input_size)
        
        # Load the saved weights
        # weights_only=True is a security best practice when loading PyTorch models
        model.load_state_dict(torch.load(LSTM_MODEL_PATH, weights_only=True))
        
        # Set to evaluation mode (turns off dropout, locks batchnorm)
        model.eval() 
        
        # Convert numpy array to PyTorch tensor and add a batch dimension of 1
        # Shape becomes: (1, SEQ_LENGTH, FEATURES)
        sequence_tensor = torch.tensor(sequence_data, dtype=torch.float32).unsqueeze(0)
        
        # Perform inference without calculating gradients (saves memory/time)
        with torch.no_grad():
            out_class, out_sev = model(sequence_tensor)
            
        # Extract scalar values from tensors
        predicted_class_idx = torch.argmax(out_class, dim=1).item()
        severity_score = out_sev.item()
        
    except Exception as e:
        print(f"   ⚠️ Could not load PyTorch model ({e}). Using simulated prediction for testing.")
        # Fallback for testing if the model isn't in the directory yet
        predicted_class_idx = 4 # Short_Term_Memory_Loss
        severity_score = 8.5
        
    disorder = DISORDER_MAP.get(predicted_class_idx, "Unknown")
    print(f"   🎯 Prediction: {disorder} (Severity: {round(severity_score, 2)}/10)")
    
    return disorder, severity_score

# ==========================================
# 3. The Metric Translation Engine
# ==========================================
def calculate_generation_metrics(disorder: str, severity: float) -> dict:
    """
    Translates the predicted disorder and severity into strict float/boolean 
    guardrails for the Generative AI.
    """
    print("⚙️ [2/4] Calculating generation metrics...")
    sev_ratio = min(max(severity, 1.0), 10.0) / 10.0

    # Baseline limits
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

# ==========================================
# 4. Document Ingestion
# ==========================================
def extract_study_material(pdf_path: str) -> str:
    print(f"📄 [3/4] Extracting raw text from {pdf_path}...")
    try:
        text = ""
        with pdfplumber.open(pdf_path) as pdf:
            for page in pdf.pages:
                if page_text := page.extract_text():
                    text += page_text + "\n"
        return text[:6000] # Truncate for API limits during PoC
    except FileNotFoundError:
        print(f"   ⚠️ File not found. Using fallback text.")
        return """
        Minerals and Energy Resources of India: 
        India is richly endowed with minerals. The distribution is highly uneven. 
        Peninsular rocks contain most of the reserves of coal, metallic minerals, mica and many other non-metallic minerals. 
        Sedimentary rock on the western and eastern flanks of the peninsula, in Gujarat and Assam have most of the petroleum deposits.
        Rajasthan with the rock systems of the peninsula, has reserves of many non-ferrous minerals.
        """

# ==========================================
# 5. The Generative Engine (LLM)
# ==========================================
def generate_adapted_asset(raw_text: str, metrics: dict, user_profile: str) -> dict:
    print("✨ [4/4] Generating adapted cognitive asset via Llama 3...")
    
    system_prompt = f"""
    You are an expert educational content generator. You must adapt the provided source text into a structured JSON study asset.
    The user has {user_profile}.
    
    CRITICAL GENERATION METRICS (You must strictly adhere to these limits):
    - Lexical Complexity: {metrics['lexical_complexity']} (0.1 is extremely simple, 1.0 is advanced college level).
    - Syntax Style: {metrics['syntax_style']}
    - Max Ideas per Chunk: {metrics['chunking_limit']} (Maximum concepts per array item).
    - Icon Density: {metrics['icon_pairing_density']} (If > 0.3, provide Stable Diffusion image prompts).
    
    OUTPUT SCHEMA INSTRUCTIONS (JSON ONLY):
    {{
        "ui_config": {{
            "theme": "{metrics['sensory_intensity']}",
            "animations_allowed": {str(metrics['animations_allowed']).lower()},
            "persistent_instructions": {str(metrics['require_persistent_instructions']).lower()},
            "timers_enabled": {str(metrics['timers_enabled']).lower()}
        }},
        "study_blocks": [
            {{
                "heading": "string",
                "adapted_text": "string (strictly following the Lexical Complexity and Syntax limits)",
                "image_prompt": "string (only if Icon Density > 0.3, else null)"
            }}
        ],
        "mind_map_mermaid": "string (valid Mermaid.js code mapping the core concepts from the text, use \\n)"
    }}
    """

    try:
        response = OLLAMA_CLIENT.chat.completions.create(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"SOURCE TEXT:\n{raw_text}"}
            ],
            model="llama3", # This must exactly match the model you downloaded in Step 2
            response_format={"type": "json_object"},
            temperature=0.1 
        )
        return json.loads(response.choices[0].message.content)
    except Exception as e:
        return {"error": str(e)}

# ==========================================
# EXECUTION
# ==========================================
if __name__ == "__main__":
    print("\n🚀 STARTING AI PIPELINE...\n" + "="*40)
    
    # Simulate a user's recent browsing session data (Seq Length 5, 10 Features)
    mock_user_sequence = np.random.rand(5, 10) 
    
    # Step 1 & 2: Predict and Calculate Rules
    disorder, severity = analyze_user_behavior(mock_user_sequence)
    gen_metrics = calculate_generation_metrics(disorder, severity)
    
    # Step 3: Parse PDF (Replace with your actual document path)
    document_text = extract_study_material("geography_notes_chapter_5.pdf")
    
    # Step 4: Generate Payload
    final_payload = generate_adapted_asset(document_text, gen_metrics, disorder)
    
    print("\n✅ FINAL OUTPUT DELIVERED TO FRONTEND:\n" + "="*40)
    print(json.dumps(final_payload, indent=4))