NeuroLearn – Hackathon Project Report

Team: SPARTANS | Hackathon: Impact AI 3.0 | Date: 27-03-2026
Abstract
Education systems often fail to address diverse cognitive needs, especially for individuals with
neurocognitive disorders such as aphasia, dementia, and autism. Traditional one-size-fits-all
learning leads to disengagement, cognitive overload, and poor retention. NeuroLearn introduces an
AI-driven adaptive learning platform that personalizes educational content through behavioral
analysis and dynamic transformation. By leveraging cognitive state detection and
transformer-based generation, the system produces structured, simplified, and multimodal outputs.
It enhances accessibility, improves comprehension, and ensures inclusive learning. This innovation
bridges AI with education, making learning more effective, scalable, and universally accessible.
Problem Statement
Traditional education systems lack personalization and fail to accommodate learners with cognitive
challenges. Users face issues such as information overload, difficulty in language comprehension,
memory retention problems, and lack of structured content. Existing platforms do not integrate
behavioral insights, leading to ineffective learning experiences and reduced accessibility.
Objectives
• Detect cognitive state using behavioral patterns
• Adapt content dynamically in real-time
• Reduce cognitive load through simplification
• Enable multimodal learning formats
• Improve accessibility and retention
Target Users
Aphasia: Difficulty in language comprehension and expression.
Dementia: Memory decline and reduced cognitive processing.
Autism: Need for structured and sensory-friendly content.
Cognitive Impairment: Reduced understanding capacity.
Short-term Memory Loss: Requires repetition and simplification.
Proposed Solution
NeuroLearn is an AI-powered platform that adapts learning content based on user behavior. It
modifies content structure, format, and UI elements such as typography and layout. The system
provides outputs like summaries, mind maps, and structured notes tailored to cognitive needs.
System Architecture
The system starts with PDF input where content is extracted and preprocessed into structured
chunks. Behavioral data from user interaction is analyzed using an LSTM model to detect cognitive
states. Based on this, prompts are selected for transformer models which generate adaptive
outputs such as summaries or structured formats. These outputs are rendered into user-friendly
formats including mind maps and flowcharts. Finally, the UI layer adapts visual elements like color,
layout, and typography to enhance accessibility.
Pipeline: PDF → Text Extraction → LSTM → State Detection → AI Model → Adaptive Output → UI
Personalization
Methodology
• PDF extraction and preprocessing
• Behavioral analysis using LSTM
• Content transformation via transformers
• UI adaptation through rule-based logic
Technologies Used
• HTML, CSS, JavaScript – Frontend
• Python – Backend
• FastAPI – APIs
• PyTorch – ML models
• NumPy, Pandas – Data processing
• Scikit-learn – ML utilities
• Ollama – Local LLM execution
Key Features
• Adaptive PDF content conversion
• Real-time cognitive detection
• Multiple output formats
• Accessibility enhancements
• Progress tracking
Innovation / Uniqueness
Combines behavioral AI with content AI to create adaptive learning. Unlike static systems,
NeuroLearn dynamically adjusts both content and UI based on cognitive needs, ensuring inclusivity
across disorders.
Results / Expected Output
The system generates simplified, structured, and personalized learning materials. Outputs include
summaries, visual diagrams, and step-by-step explanations, improving comprehension and
retention.
Limitations
• Limited dataset availability
• Prototype-level accuracy
• No clinical validation
Future Scope
• Integration with Government platforms
• Multilingual support
• Real-time monitoring
• Wearable integration
• Clinical validation
Conclusion
NeuroLearn bridges AI with inclusive education by delivering personalized learning experiences. It
offers a scalable and impactful solution to improve accessibility and effectiveness in education
systems.
References
• Groq
• pdfplumber
• UCI ML Repository
• Kaggle
