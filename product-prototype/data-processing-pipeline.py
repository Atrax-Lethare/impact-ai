import pandas as pd
import numpy as np
import json
from datetime import datetime

class TelemetryProcessor:
    """
    Processes raw, messy human telemetry data (JSON logs) from a web interface
    and transforms it into structured features for the AI Adaptive UI Model.
    """
    def __init__(self, raw_data_path):
        self.raw_data_path = raw_data_path
        self.cleaned_data = None

    def load_data(self):
        """Loads raw JSON event logs."""
        # Expected format: A list of session objects containing an array of 'events'
        # Events have: timestamp, type (click, mousemove, scroll, unload), x, y, element_id
        with open(self.raw_data_path, 'r') as file:
            self.raw_data = json.load(file)

    def _calculate_velocity_and_straightness(self, events):
        """Calculates average mouse velocity and trajectory straightness."""
        mouse_events = [e for e in events if e['type'] == 'mousemove']
        if len(mouse_events) < 2:
            return 0.0, 1.0 # Defaults if no movement

        total_distance = 0
        total_time = 0
        
        # For straightness (Total Distance / Euclidean Distance between start and end)
        start_pos = (mouse_events[0]['x'], mouse_events[0]['y'])
        end_pos = (mouse_events[-1]['x'], mouse_events[-1]['y'])
        
        for i in range(1, len(mouse_events)):
            dx = mouse_events[i]['x'] - mouse_events[i-1]['x']
            dy = mouse_events[i]['y'] - mouse_events[i-1]['y']
            dt = (mouse_events[i]['timestamp'] - mouse_events[i-1]['timestamp']) / 1000.0 # Convert ms to seconds
            
            distance = np.sqrt(dx**2 + dy**2)
            total_distance += distance
            total_time += dt

        avg_velocity = total_distance / total_time if total_time > 0 else 0
        
        euclidean_dist = np.sqrt((end_pos[0] - start_pos[0])**2 + (end_pos[1] - start_pos[1])**2)
        # Straightness ratio: 1.0 is perfectly straight. Higher means erratic wandering.
        straightness = total_distance / euclidean_dist if euclidean_dist > 0 else 1.0

        return avg_velocity, straightness

    def _count_scroll_reversals(self, events):
        """Counts how many times the user scrolls down, then back up (memory marker)."""
        scroll_events = [e for e in events if e['type'] == 'scroll']
        if len(scroll_events) < 2:
            return 0
            
        reversals = 0
        current_direction = None # 1 for down, -1 for up
        
        for i in range(1, len(scroll_events)):
            dy = scroll_events[i]['y'] - scroll_events[i-1]['y']
            if dy > 0:
                new_direction = 1
            elif dy < 0:
                new_direction = -1
            else:
                continue
                
            if current_direction is not None and current_direction == 1 and new_direction == -1:
                reversals += 1 # Scrolled down, then reversed up
            current_direction = new_direction
            
        return reversals

    def _calculate_repetitive_clicks(self, events):
        """Counts multiple clicks on the exact same element within a short timeframe."""
        clicks = [e for e in events if e['type'] == 'click']
        repetitive_count = 0
        
        for i in range(1, len(clicks)):
            time_diff = clicks[i]['timestamp'] - clicks[i-1]['timestamp']
            # If clicked same element in under 2 seconds (2000 ms)
            if clicks[i].get('element_id') == clicks[i-1].get('element_id') and time_diff < 2000:
                repetitive_count += 1
                
        return repetitive_count

    def process_sessions(self):
        """Iterates through all raw sessions and extracts AI-ready features."""
        processed_records = []
        
        for session in self.raw_data:
            events = session.get('events', [])
            if not events:
                continue
                
            # Sort events chronologically just in case
            events = sorted(events, key=lambda x: x['timestamp'])
            
            start_time = events[0]['timestamp']
            end_time = events[-1]['timestamp']
            task_completion_time = (end_time - start_time) / 1000.0 # in seconds
            
            # Time to first click
            clicks = [e for e in events if e['type'] == 'click']
            if clicks:
                time_to_first_click = (clicks[0]['timestamp'] - start_time) / 1000.0
            else:
                time_to_first_click = task_completion_time # Default to total time if they never clicked
                
            # Mouse Kinematics
            mouse_velocity_avg, cursor_straightness = self._calculate_velocity_and_straightness(events)
            
            # Text Dwell Time (Hovering over text without clicking)
            text_dwell_events = [e for e in events if e['type'] == 'hover' and e.get('is_text') == True]
            text_dwell_time = sum(e.get('duration_ms', 0) for e in text_dwell_events) / 1000.0
            
            # Counts
            scroll_reversals = self._count_scroll_reversals(events)
            repetitive_clicks = self._calculate_repetitive_clicks(events)
            back_button_usage = sum(1 for e in events if e['type'] == 'navigation' and e.get('direction') == 'back')

            # Compile the clean row
            clean_row = {
                'session_id': session.get('session_id', 'unknown'),
                'time_to_first_click': round(time_to_first_click, 2),
                'task_completion_time': round(task_completion_time, 2),
                'mouse_velocity_avg': round(mouse_velocity_avg, 2),
                'cursor_straightness': round(cursor_straightness, 3),
                'scroll_reversals': scroll_reversals,
                'repetitive_clicks': repetitive_clicks,
                'back_button_usage': back_button_usage,
                'text_dwell_time': round(text_dwell_time, 2)
            }
            
            # If we have ground truth labels from clinical testing, include them
            if 'ground_truth_label' in session:
                clean_row['cluster_label'] = session['ground_truth_label']
                
            processed_records.append(clean_row)
            
        self.cleaned_data = pd.DataFrame(processed_records)
        return self.cleaned_data

    def handle_missing_values(self):
        """Cleans up NaNs or infinite values caused by bad raw data logs."""
        if self.cleaned_data is not None:
            # Replace infinity with NaN, then fill NaNs with column medians
            self.cleaned_data.replace([np.inf, -np.inf], np.nan, inplace=True)
            self.cleaned_data.fillna(self.cleaned_data.median(numeric_only=True), inplace=True)
            
            # Ensure counts don't go negative
            count_cols = ['scroll_reversals', 'repetitive_clicks', 'back_button_usage']
            for col in count_cols:
                self.cleaned_data[col] = self.cleaned_data[col].clip(lower=0)
                
        return self.cleaned_data


# --- EXAMPLE USAGE ---
if __name__ == "__main__":
    # Create a mock raw JSON file to demonstrate how it works
    mock_raw_log = [
        {
            "session_id": "usr_789",
            "ground_truth_label": 3, # Example: We know this user has short term memory disorder
            "events": [
                {"timestamp": 1000, "type": "mousemove", "x": 100, "y": 200},
                {"timestamp": 1500, "type": "mousemove", "x": 150, "y": 250},
                {"timestamp": 2000, "type": "scroll", "y": 500},
                {"timestamp": 2500, "type": "scroll", "y": 200}, # Scroll reversal!
                {"timestamp": 3000, "type": "click", "x": 150, "y": 250, "element_id": "submit_btn"},
                {"timestamp": 3500, "type": "click", "x": 150, "y": 250, "element_id": "submit_btn"}, # Repetitive!
                {"timestamp": 4000, "type": "navigation", "direction": "back"}
            ]
        }
    ]
    
    with open('mock_raw_telemetry.json', 'w') as f:
        json.dump(mock_raw_log, f)

    # 1. Initialize Processor
    processor = TelemetryProcessor('mock_raw_telemetry.json')
    
    # 2. Load the raw frontend logs
    processor.load_data()
    
    # 3. Extract the features mathematically
    df = processor.process_sessions()
    
    # 4. Clean up any weird anomalies (like division by zero yielding infinity)
    df = processor.handle_missing_values()
    
    print("Processed Clean Data ready for AI Input:")
    print(df.to_string())
    
    # df.to_csv('cleaned_human_data_ready_for_ai.csv', index=False)