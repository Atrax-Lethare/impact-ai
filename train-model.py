import pandas as pd
import numpy as np
import joblib
import json

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import TensorDataset, DataLoader

from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

# ==========================================
# 1. Configuration & Setup
# ==========================================
CSV_FILENAME = "lstm_behavior_dataset_large.csv"
SEQ_LENGTH = 5
BATCH_SIZE = 32
EPOCHS = 5

DISORDER_MAP = {
    0: "Aphasia",
    1: "Dementia",
    2: "Autism",
    3: "General_Cognitive_Impairment",
    4: "Short_Term_Memory_Loss"
}

# ==========================================
# 2. PyTorch Model Definition
# ==========================================
class DualOutputLSTM(nn.Module):
    def __init__(self, input_size, hidden_size=64, num_classes=5):
        super(DualOutputLSTM, self).__init__()
        # batch_first=True means the input shape should be (batch_size, seq_len, features)
        self.lstm = nn.LSTM(input_size, hidden_size, batch_first=True)
        self.dropout = nn.Dropout(0.3)
        self.fc = nn.Linear(hidden_size, 32)
        self.relu = nn.ReLU()
        
        # Dual Outputs
        self.out_class = nn.Linear(32, num_classes)
        self.out_severity = nn.Linear(32, 1)

    def forward(self, x):
        # Pass through LSTM
        lstm_out, _ = self.lstm(x)
        
        # We only want the output from the final time step of the sequence
        last_step_out = lstm_out[:, -1, :]
        
        x = self.dropout(last_step_out)
        x = self.relu(self.fc(x))
        
        class_preds = self.out_class(x)
        severity_preds = self.out_severity(x)
        
        return class_preds, severity_preds

# ==========================================
# 3. Dataset & Sequence Processing
# ==========================================
def create_sequences_from_sessions(df):
    sequences, labels_class, labels_severity = [], [], []

    if 'severity_score' not in df.columns:
        df['severity_score'] = np.random.uniform(1, 10, size=len(df))

    grouped = df.groupby("session_id")

    for _, group in grouped:
        group = group.sort_values("step")
        
        drop_cols = ["session_id", "step", "cluster_label", "severity_score"]
        feature_cols = [col for col in group.columns if col not in drop_cols]
        data = group[feature_cols].values
        
        target_class = group["cluster_label"].values
        target_severity = group["severity_score"].values

        for i in range(len(data) - SEQ_LENGTH):
            sequences.append(data[i:i+SEQ_LENGTH])
            labels_class.append(target_class[i+SEQ_LENGTH])
            labels_severity.append(target_severity[i+SEQ_LENGTH])

    return np.array(sequences), np.array(labels_class), np.array(labels_severity)

# ==========================================
# 4. Metric Generation Logic
# ==========================================
def generate_asset_metrics(predicted_cluster, severity_score):
    disorder = DISORDER_MAP.get(predicted_cluster, "Unknown")
    sev = min(max(float(severity_score), 1.0), 10.0)
    sev_ratio = sev / 10.0

    metrics = {
        "user_profile": [disorder],
        "estimated_severity_score": round(sev, 1),
        "generation_metrics": {
            "lexical_complexity": 1.0, 
            "syntax_style": "Standard",
            "chunking_limit": 5, 
            "summary_frequency": "None",
            "feedback_specificity": "General",
            "icon_pairing_density": 0.0,
            "sensory_intensity": "Standard",
            "animations_allowed": True,
            "visual_clutter_index": 1.0,
            "require_persistent_instructions": False,
            "timers_enabled": True,
            "audio_assistance_required": False
        }
    }

    gm = metrics["generation_metrics"]

    if disorder == "Aphasia":
        gm["lexical_complexity"] = round(max(0.2, 1.0 - (0.8 * sev_ratio)), 2)
        gm["icon_pairing_density"] = round(min(1.0, 0.3 + (0.7 * sev_ratio)), 2)
        gm["audio_assistance_required"] = True
        gm["sensory_intensity"] = "High_Contrast"
    elif disorder == "Dementia":
        gm["syntax_style"] = "Active_Direct"
        gm["chunking_limit"] = max(1, int(4 - (3 * sev_ratio)))
        gm["lexical_complexity"] = round(max(0.4, 1.0 - (0.6 * sev_ratio)), 2)
    elif disorder == "Autism":
        gm["syntax_style"] = "Literal"
        gm["feedback_specificity"] = "Highly_Specific"
        gm["animations_allowed"] = False
        gm["sensory_intensity"] = "Muted"
        gm["visual_clutter_index"] = round(max(0.1, 1.0 - (0.8 * sev_ratio)), 2)
    elif disorder == "General_Cognitive_Impairment":
        gm["timers_enabled"] = False
        gm["visual_clutter_index"] = round(max(0.2, 1.0 - (0.7 * sev_ratio)), 2)
        gm["lexical_complexity"] = round(max(0.3, 1.0 - (0.6 * sev_ratio)), 2)
        gm["chunking_limit"] = max(2, int(5 - (3 * sev_ratio)))
    elif disorder == "Short_Term_Memory_Loss":
        gm["require_persistent_instructions"] = True
        gm["summary_frequency"] = "Per_Paragraph" if sev > 7 else "Per_Section"
        gm["chunking_limit"] = max(1, int(4 - (2 * sev_ratio)))

    return metrics

# ==========================================
# 5. Main Model Pipeline
# ==========================================
def main():
    try:
        df = pd.read_csv(CSV_FILENAME)
    except FileNotFoundError:
        print(f"⚠️ Could not find {CSV_FILENAME}. Please ensure the dataset exists.")
        return

    # Extract sequences
    X_seq, y_class_seq, y_sev_seq = create_sequences_from_sessions(df)

    # Scale the features
    scaler = StandardScaler()
    X_seq = scaler.fit_transform(X_seq.reshape(-1, X_seq.shape[-1])).reshape(X_seq.shape)
    
    num_classes = len(np.unique(y_class_seq))

    # Split Data
    X_train, X_test, y_class_train, y_class_test, y_sev_train, y_sev_test = train_test_split(
        X_seq, y_class_seq, y_sev_seq, test_size=0.2, random_state=42
    )

    # Convert to PyTorch Tensors
    # Note: CrossEntropyLoss expects class labels as LongTensors (integers), not one-hot!
    X_train_t = torch.tensor(X_train, dtype=torch.float32)
    y_class_train_t = torch.tensor(y_class_train, dtype=torch.long)
    y_sev_train_t = torch.tensor(y_sev_train, dtype=torch.float32).unsqueeze(1) # shape (batch, 1)

    # Create DataLoaders
    train_dataset = TensorDataset(X_train_t, y_class_train_t, y_sev_train_t)
    train_loader = DataLoader(train_dataset, batch_size=BATCH_SIZE, shuffle=True)

    # Initialize Model, Loss, and Optimizer
    input_size = X_train.shape[2]
    model = DualOutputLSTM(input_size=input_size, hidden_size=64, num_classes=num_classes)
    
    criterion_class = nn.CrossEntropyLoss()
    criterion_sev = nn.MSELoss()
    optimizer = optim.Adam(model.parameters(), lr=0.001)

    print("\n--- Training Dual-Output LSTM model ---")
    
    # Custom Training Loop
    for epoch in range(EPOCHS):
        model.train()
        total_loss = 0
        
        for batch_X, batch_y_class, batch_y_sev in train_loader:
            optimizer.zero_grad() # Clear gradients
            
            # Forward pass
            out_class, out_sev = model(batch_X)
            
            # Calculate Losses
            loss_class = criterion_class(out_class, batch_y_class)
            loss_sev = criterion_sev(out_sev, batch_y_sev)
            
            # Combine losses (you can weight them if one is overpowering the other)
            loss = loss_class + loss_sev
            
            # Backward pass and optimize
            loss.backward()
            optimizer.step()
            
            total_loss += loss.item()
            
        print(f"Epoch {epoch+1}/{EPOCHS} - Loss: {total_loss/len(train_loader):.4f}")

    # ==========================================
    # 6. Demonstrate Pipeline Output
    # ==========================================
    print("\n--- Testing Output Generation on a Sample User ---")
    
    model.eval() # Set model to evaluation mode
    with torch.no_grad(): # Disable gradient calculation for inference
        sample_seq = torch.tensor(X_test[0:1], dtype=torch.float32) 
        
        # Predict
        out_class, out_sev = model(sample_seq)
        
        # Get actual predictions from tensors
        predicted_class_idx = torch.argmax(out_class, dim=1).item()
        predicted_severity = out_sev.item()

    final_payload = generate_asset_metrics(predicted_class_idx, predicted_severity)

    print("\n✅ GENERATED AI PAYLOAD:")
    print(json.dumps(final_payload, indent=4))

    # Save PyTorch Model and Scaler
    torch.save(model.state_dict(), "lstm_pipeline_model.pth")
    joblib.dump(scaler, "scaler.joblib")
    print("\n💾 Model state saved to lstm_pipeline_model.pth")

if __name__ == "__main__":
    main()