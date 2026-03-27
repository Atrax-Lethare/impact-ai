import pandas as pd
import numpy as np
import os
import joblib
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report

CSV_FILENAME = "synthetic_cognitive_telemetry.csv"

def generate_mock_data_if_missing():
    """Generates mock telemetry data if the CSV doesn't exist so the script is runnable."""
    if not os.path.exists(CSV_FILENAME):
        print(f"File {CSV_FILENAME} not found. Generating mock data...")
        np.random.seed(42)
        n_samples = 1000
        data = {
            "time_to_first_click": np.random.uniform(0.5, 10.0, n_samples),
            "task_completion_time": np.random.uniform(10.0, 300.0, n_samples),
            "mouse_velocity_avg": np.random.uniform(50.0, 1000.0, n_samples),
            "cursor_straightness": np.random.uniform(0.1, 1.0, n_samples),
            "scroll_reversals": np.random.randint(0, 15, n_samples),
            "repetitive_clicks": np.random.randint(0, 20, n_samples),
            "back_button_usage": np.random.randint(0, 10, n_samples),
            "text_dwell_time": np.random.uniform(2.0, 120.0, n_samples),
            "cluster_label": np.random.randint(0, 5, n_samples)
        }
        df = pd.DataFrame(data)
        df.to_csv(CSV_FILENAME, index=False)
        print("Mock data generated successfully.")

def main():
    # 1. Ensure data exists and load it
    generate_mock_data_if_missing()
    print("Loading data...")
    df = pd.read_csv(CSV_FILENAME)

    # 2. Define Features and Target
    feature_columns = [
        "time_to_first_click", "task_completion_time", "mouse_velocity_avg", 
        "cursor_straightness", "scroll_reversals", "repetitive_clicks", 
        "back_button_usage", "text_dwell_time"
    ]
    X = df[feature_columns]
    y = df["cluster_label"]

    # 3. Train/Test Split (80% training, 20% testing)
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    # 4. Preprocessing: StandardScaler
    # We apply the scaler to all features (StandardScaler handles both floats and ints well)
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)

    # 5. Initialize and Train the Model
    # HYPERPARAMETER TUNING NOTES:
    # - n_estimators: Number of trees. Higher = more robust, but slower. (Try 100, 200, 500)
    # - max_depth: Limits tree depth to prevent overfitting. (Try 10, 20, None)
    # - min_samples_split: Minimum samples required to split an internal node. (Try 2, 5, 10)
    print("Training RandomForestClassifier...")
    model = RandomForestClassifier(
        n_estimators=100,
        max_depth=None,
        random_state=42,
        class_weight="balanced" # Helpful if your cognitive clusters are imbalanced
    )
    model.fit(X_train_scaled, y_train)

    # 6. Evaluate the Model
    print("\n--- Model Evaluation ---")
    y_pred = model.predict(X_test_scaled)
    print(f"Accuracy: {accuracy_score(y_test, y_pred):.4f}")
    print("\nClassification Report:")
    print(classification_report(y_test, y_pred))

    # 7. Save Model and Scaler for the API
    joblib.dump(model, "model.joblib")
    joblib.dump(scaler, "scaler.joblib")
    print("\nPipeline complete. Saved 'model.joblib' and 'scaler.joblib' to disk.")

if __name__ == "__main__": 
    main()