import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report

# Set random seed for reproducibility
np.random.seed(42)

def generate_class_data(num_samples, profile_name, label):
    """
    Generates synthetic web telemetry data based on cognitive profiles.
    We use normal distributions (mean, std_dev) for continuous data like time/speed.
    We use Poisson distributions (lam) for count data like clicks/reversals.
    """
    
    if label == 0: # Neurotypical Baseline
        time_to_first_click = np.random.normal(3.0, 1.0, num_samples)
        task_completion = np.random.normal(45.0, 10.0, num_samples)
        mouse_velocity = np.random.normal(500.0, 100.0, num_samples)
        cursor_straightness = np.random.normal(1.2, 0.1, num_samples) # 1.0 is perfect straight line
        scroll_reversals = np.random.poisson(1.5, num_samples)
        repetitive_clicks = np.random.poisson(0.2, num_samples)
        back_button_usage = np.random.poisson(0.5, num_samples)
        text_dwell_time = np.random.normal(15.0, 5.0, num_samples)
        
    elif label == 1: # Dementia
        time_to_first_click = np.random.normal(8.0, 3.0, num_samples) # High hesitation
        task_completion = np.random.normal(120.0, 30.0, num_samples)
        mouse_velocity = np.random.normal(200.0, 80.0, num_samples) # Slower, cautious
        cursor_straightness = np.random.normal(2.5, 0.6, num_samples) # Highly erratic/wandering
        scroll_reversals = np.random.poisson(4.0, num_samples)
        repetitive_clicks = np.random.poisson(1.5, num_samples)
        back_button_usage = np.random.poisson(2.0, num_samples)
        text_dwell_time = np.random.normal(30.0, 10.0, num_samples)
        
    elif label == 2: # Autism Spectrum (Visual/Structured focus archetype)
        time_to_first_click = np.random.normal(2.0, 0.8, num_samples) # Fast initiation
        task_completion = np.random.normal(35.0, 15.0, num_samples)
        mouse_velocity = np.random.normal(650.0, 150.0, num_samples) # Fast, deliberate
        cursor_straightness = np.random.normal(1.1, 0.05, num_samples) # Highly direct
        scroll_reversals = np.random.poisson(0.5, num_samples)
        repetitive_clicks = np.random.poisson(0.1, num_samples)
        back_button_usage = np.random.poisson(0.2, num_samples)
        text_dwell_time = np.random.normal(5.0, 3.0, num_samples) # Skips dense text
        
    elif label == 3: # Short-Term Memory Disorder
        time_to_first_click = np.random.normal(4.0, 1.5, num_samples)
        task_completion = np.random.normal(90.0, 25.0, num_samples)
        mouse_velocity = np.random.normal(400.0, 100.0, num_samples)
        cursor_straightness = np.random.normal(1.4, 0.2, num_samples)
        scroll_reversals = np.random.poisson(8.0, num_samples) # Crucial marker: scrolling up to re-read
        repetitive_clicks = np.random.poisson(4.0, num_samples) # Crucial marker: forgetting they clicked
        back_button_usage = np.random.poisson(6.0, num_samples) # Crucial marker: getting lost in navigation
        text_dwell_time = np.random.normal(20.0, 8.0, num_samples)
        
    elif label == 4: # Cognitive Impairment (General)
        time_to_first_click = np.random.normal(6.0, 2.0, num_samples)
        task_completion = np.random.normal(100.0, 20.0, num_samples)
        mouse_velocity = np.random.normal(300.0, 90.0, num_samples)
        cursor_straightness = np.random.normal(1.6, 0.3, num_samples)
        scroll_reversals = np.random.poisson(3.0, num_samples)
        repetitive_clicks = np.random.poisson(1.0, num_samples)
        back_button_usage = np.random.poisson(1.5, num_samples)
        text_dwell_time = np.random.normal(25.0, 8.0, num_samples)
        
    elif label == 5: # Aphasia (Language processing barrier)
        time_to_first_click = np.random.normal(4.0, 1.0, num_samples)
        task_completion = np.random.normal(110.0, 25.0, num_samples) # High time entirely due to text processing
        mouse_velocity = np.random.normal(450.0, 100.0, num_samples) # Normal motor control
        cursor_straightness = np.random.normal(1.2, 0.1, num_samples) # Normal motor control
        scroll_reversals = np.random.poisson(2.0, num_samples)
        repetitive_clicks = np.random.poisson(0.2, num_samples)
        back_button_usage = np.random.poisson(1.0, num_samples)
        text_dwell_time = np.random.normal(60.0, 15.0, num_samples) # Crucial marker: Massive text dwell time
        
    # Clip values to ensure no negative times or negative counts
    df = pd.DataFrame({
        'time_to_first_click': np.clip(time_to_first_click, 0.5, None),
        'task_completion_time': np.clip(task_completion, 5.0, None),
        'mouse_velocity_avg': np.clip(mouse_velocity, 10.0, None),
        'cursor_straightness': np.clip(cursor_straightness, 1.0, None),
        'scroll_reversals': np.clip(scroll_reversals, 0, None),
        'repetitive_clicks': np.clip(repetitive_clicks, 0, None),
        'back_button_usage': np.clip(back_button_usage, 0, None),
        'text_dwell_time': np.clip(text_dwell_time, 0.0, None),
        'cluster_label': label
    })
    
    return df

# Generate 2,000 samples for each of the 6 classes (12,000 rows total)
samples_per_class = 2000
dfs = []
for label, name in enumerate(['Neurotypical', 'Dementia', 'Autism', 'Short-Term Memory', 'Cognitive Impairment', 'Aphasia']):
    dfs.append(generate_class_data(samples_per_class, name, label))

# Combine and shuffle the dataset
full_dataset = pd.concat(dfs, ignore_index=True)
full_dataset = full_dataset.sample(frac=1).reset_index(drop=True)

# Save to CSV so you can use it in other scripts
csv_filename = 'synthetic_cognitive_telemetry.csv'
full_dataset.to_csv(csv_filename, index=False)
print(f"Dataset generated and saved to {csv_filename} (12,000 rows).\n")

# --- PROOF OF CONCEPT: Train the Model ---
print("Training AI Model on Synthetic Data...")
X = full_dataset.drop('cluster_label', axis=1)
y = full_dataset['cluster_label']

# Split into 80% training and 20% testing
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# Train a Random Forest Classifier
clf = RandomForestClassifier(n_estimators=100, max_depth=10, random_state=42)
clf.fit(X_train, y_train)

# Evaluate the model
y_pred = clf.predict(X_test)
print("\nModel Evaluation Metrics:")
target_names = ['Neurotypical (0)', 'Dementia (1)', 'Autism (2)', 'Memory (3)', 'Cog. Impairment (4)', 'Aphasia (5)']
print(classification_report(y_test, y_pred, target_names=target_names))

# Feature Importance: See which behavioral signals matter most to the AI
importances = clf.feature_importances_
features = X.columns
print("\nFeature Importance (What the AI looks for most):")
for feature, imp in sorted(zip(features, importances), key=lambda x: x[1], reverse=True):
    print(f"- {feature}: {imp:.4f}")