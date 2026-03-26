import textstat
import spacy
import re

class ResourceRanker:
    def __init__(self):
        """
        Initializes the NLP models required for structural and semantic analysis.
        Requires the spaCy English model. If not installed, run:
        python -m spacy download en_core_web_sm
        """
        try:
            self.nlp = spacy.load("en_core_web_sm")
        except OSError:
            raise RuntimeError(
                "spaCy model 'en_core_web_sm' not found. "
                "Please install it using: python -m spacy download en_core_web_sm"
            )

    def clean_text(self, raw_text: str) -> str:
        """Basic preprocessing to remove irregular whitespace for accurate NLP parsing."""
        return re.sub(r'\n{3,}', '\n\n', raw_text.strip())

    def _score_readability(self, text: str) -> float:
        """
        Criterion A: Readability & Cognitive Load (Ideal: Grade 6 to 8)
        Penalizes text heavily if it goes beyond an 8th-grade level.
        """
        grade = textstat.flesch_kincaid_grade(text)
        
        if grade <= 8.0:
            return 100.0
        else:
            # Deduct 10 points for every grade level above 8
            score = 100.0 - ((grade - 8.0) * 10.0)
            return max(0.0, min(100.0, score))

    def _score_structure(self, text: str, doc) -> float:
        """
        Criterion B: Structural Clarity
        Rewards lists, penalizes long paragraphs (walls of text > 100 words or > 4 sentences).
        """
        paragraphs = [p.strip() for p in text.split('\n') if p.strip()]
        if not paragraphs:
            return 0.0

        score = 70.0  # Base score for standard formatting
        
        for p in paragraphs:
            # Reward: Check for lists (bullet points, dashes, numbered lists)
            if re.match(r'^(\d+\.|\*|\-|\•)', p):
                score += 5.0
                
            # Penalty: "Walls of text" checking
            word_count = textstat.lexicon_count(p, removepunct=True)
            sentence_count = textstat.sentence_count(p)
            
            if word_count > 100 or sentence_count > 4:
                score -= 15.0

        return max(0.0, min(100.0, score))

    def _score_vocabulary(self, text: str) -> float:
        """
        Criterion C: Vocabulary Complexity
        Rewards simpler syllables per word. Ideal is ~1.5 syllables.
        """
        avg_syllables = textstat.avg_syllables_per_word(text)
        
        if avg_syllables <= 1.5:
            return 100.0
        else:
            # Deduct points for high multi-syllabic density
            score = 100.0 - ((avg_syllables - 1.5) * 50.0)
            return max(0.0, min(100.0, score))

    def analyze(self, raw_text: str) -> dict:
        """
        Main engine function to process text, apply weighted algorithms, 
        and generate Tiers and Auto-Tags.
        """
        cleaned = self.clean_text(raw_text)
        if not cleaned:
            return self._empty_response()

        doc = self.nlp(cleaned)

        # Calculate individual metric scores
        readability = self._score_readability(cleaned)
        structure = self._score_structure(cleaned, doc)
        vocabulary = self._score_vocabulary(cleaned)

        # --- WEIGHTING CONFIGURATION ---
        # Adjust these multipliers as you gather more user telemetry.
        # Ensure they always sum to 1.0.
        WEIGHT_A = 0.40  # Readability
        WEIGHT_B = 0.40  # Structure
        WEIGHT_C = 0.20  # Vocabulary

        overall_score = round(
            (readability * WEIGHT_A) + 
            (structure * WEIGHT_B) + 
            (vocabulary * WEIGHT_C)
        )

        # Determine Tier & AI Recommendation
        if overall_score >= 85:
            tier = "Tier 1"
            rec = "Ready for direct deployment to all user clusters."
        elif overall_score >= 60:
            tier = "Tier 2"
            rec = "Requires moderate AI simplification before presenting to severe impairment profiles."
        else:
            tier = "Tier 3"
            rec = "Requires heavy AI intervention/summarization before use."

        # Generate Auto-Tags
        tags = []
        if readability > 80: tags.append("Low Cognitive Load")
        else: tags.append("High Cognitive Load")
        
        if structure > 85: tags.append("Well-Structured")
        if structure < 50: tags.append("Walls of Text")
        if re.search(r'^(\d+\.|\*|\-|\•)', cleaned, re.MULTILINE): tags.append("List-Format")
        
        if vocabulary > 80: tags.append("Simple Vocabulary")
        else: tags.append("High Jargon")

        return {
            "overall_score": overall_score,
            "tier": tier,
            "auto_tags": list(set(tags)), # deduplicate just in case
            "metrics": {
                "reading_grade_level": round(textstat.flesch_kincaid_grade(cleaned), 1),
                "structural_score": round(structure),
                "vocabulary_score": round(vocabulary)
            },
            "ai_recommendation": rec
        }

    def _empty_response(self):
        """Fallback for empty documents."""
        return {
            "overall_score": 0, "tier": "Tier 3", "auto_tags": ["Empty"],
            "metrics": {"reading_grade_level": 0.0, "structural_score": 0, "vocabulary_score": 0},
            "ai_recommendation": "Document is empty or unreadable."
        }