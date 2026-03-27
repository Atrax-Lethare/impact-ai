from flask import Flask, request, jsonify
from flask_cors import CORS
import joblib
import pandas as pd
import os

app = Flask(__name__)
# Enable CORS so your local index.html can communicate with this API
CORS(app)

# 1. Load the trained model and scaler on startup
if not os.path.exists("model.joblib") or not os.path.exists("scaler.joblib"):
    print("Error: Model files not found. Please run 'python train_model.py' first.")
    exit()

model = joblib.load("model.joblib")
scaler = joblib.load("scaler.joblib")

# Ensure feature names match EXACTLY what the model was trained on
FEATURE_COLUMNS = [
    "time_to_first_click", "task_completion_time", "mouse_velocity_avg", 
    "cursor_straightness", "scroll_reversals", "repetitive_clicks", 
    "back_button_usage", "text_dwell_time"
]

@app.route('/predict', methods=['POST'])
def predict():
    try:
        # 2. Get the real-time telemetry data from the frontend
        data = request.json
        
        # 3. Format the data into a DataFrame (required for StandardScaler)
        input_data = {}
        for feature in FEATURE_COLUMNS:
            input_data[feature] = [data.get(feature, 0.0)]
            
        df_features = pd.DataFrame(input_data)
        
        # 4. Preprocess and Predict
        scaled_features = scaler.transform(df_features)
        prediction = model.predict(scaled_features)[0]
        
        # 5. Send the cluster ID back to the HTML
        return jsonify({
            'success': True,
            'cluster_id': int(prediction)
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 400

if __name__ == '__main__':
    print("Starting ML API Server on http://127.0.0.1:5000")
    app.run(debug=True, port=5000)