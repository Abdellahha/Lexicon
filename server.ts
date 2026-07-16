import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

// Lazy initialize Gemini client to prevent app crashes on boot if the key is missing
let aiClient: GoogleGenAI | null = null;
function getGeminiClient() {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      console.warn("GEMINI_API_KEY is not set. AI advice will use rule-based fallback.");
      return null;
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Route for health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // API Route to fetch vocabulary words database
  app.get("/api/words", (req, res) => {
    try {
      const filePath = path.join(process.cwd(), "words-data.json");
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf8");
        return res.json(JSON.parse(content));
      }
      return res.status(404).json({ error: "Vocabulary file not found" });
    } catch (err) {
      console.error("Error reading words database:", err);
      return res.status(500).json({ error: "Failed to load vocabulary" });
    }
  });

  // API Route for AI level advisor
  app.post("/api/ai-advice", async (req, res) => {
    try {
      const { englishLevel, totalLearned, score, streak, levelBreakdown, levelTotals } = req.body;

      const ai = getGeminiClient();
      if (!ai) {
        // Rule-based fallback if Gemini API is not configured
        const currentLvl = englishLevel || 'A1';
        const learnedInCurrent = levelBreakdown?.[currentLvl] || 0;
        const totalInCurrent = levelTotals?.[currentLvl] || 50;
        
        let advice = `Great job! You've learned ${learnedInCurrent} words in level ${currentLvl}. Keep practicing to expand your English vocabulary!`;
        let recommendLevelUp = false;
        let recommendedLevel = null;

        if (currentLvl !== 'all' && currentLvl !== 'C1') {
          const nextLevels = { 'A1': 'A2', 'A2': 'B1', 'B1': 'B2', 'B2': 'C1' };
          const next = nextLevels[currentLvl as keyof typeof nextLevels];
          if (learnedInCurrent >= 15 || (totalInCurrent > 0 && (learnedInCurrent / totalInCurrent) >= 0.5)) {
            advice = `Fantastic progress! You have mastered ${learnedInCurrent} words in ${currentLvl}. I advise you to challenge yourself and switch to ${next} level!`;
            recommendLevelUp = true;
            recommendedLevel = next;
          }
        }
        
        return res.json({ advice, recommendLevelUp, recommendedLevel });
      }

      const currentLvl = englishLevel || 'all';
      const breakdown = levelBreakdown || { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0 };
      const totals = levelTotals || { A1: 50, A2: 50, B1: 50, B2: 50, C1: 50 };
      const currentLearned = breakdown[currentLvl] || 0;
      const currentTotal = totals[currentLvl] || 50;

      const prompt = `Observe the following English vocabulary learner's progress metrics and provide a short, motivating, and personalized study suggestion (1 to 2 sentences max). 
If the user's current level is NOT 'all' and they have learned a good number of words (e.g. at least 15 words OR completed more than 50% of the vocabulary for their current level), recommend that they change their English Level to the next difficulty level (e.g. A1 -> A2, A2 -> B1, B1 -> B2, B2 -> C1).

Learner Stats:
- Current Selected Level: ${currentLvl}
- Total Words Learned (all levels): ${totalLearned}
- Score: ${score}
- Streak: ${streak} days
- Progress in current level: ${currentLearned} out of ${currentTotal} words learned (${currentTotal > 0 ? ((currentLearned / currentTotal) * 100).toFixed(1) : 0}%)
- All levels breakdown (Learned/Total):
  A1: ${breakdown.A1}/${totals.A1}
  A2: ${breakdown.A2}/${totals.A2}
  B1: ${breakdown.B1}/${totals.B1}
  B2: ${breakdown.B2}/${totals.B2}
  C1: ${breakdown.C1}/${totals.C1}

Generate your response in the specified JSON schema. Keep the advice friendly, clear, and action-oriented.`;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              advice: {
                type: Type.STRING,
                description: "Personalized advice to the user observing their level and progress. Max 40 words, 1-2 sentences."
              },
              recommendLevelUp: {
                type: Type.BOOLEAN,
                description: "True if the user should advance to the next level because they have learned at least 15 words or > 50% of current level's words."
              },
              recommendedLevel: {
                type: Type.STRING,
                description: "The next recommended level (e.g., A2, B1, B2, C1) to advance to, if recommendLevelUp is true. Otherwise empty or null."
              }
            },
            required: ["advice", "recommendLevelUp"]
          }
        }
      });

      const responseText = response.text || "{}";
      const result = JSON.parse(responseText.trim());
      res.json(result);

    } catch (err: any) {
      console.error("Error generating AI advice:", err);
      res.status(500).json({ 
        error: "Failed to generate AI advice",
        advice: "Keep practicing! Consistency is the key to mastering English vocabulary.",
        recommendLevelUp: false,
        recommendedLevel: null
      });
    }
  });

  // API Route to evaluate spoken text for Speak & Read Practice
  app.post("/api/evaluate-speech", async (req, res) => {
    try {
      const { targetText, spokenText, words } = req.body;
      const targetWordsArray = Array.isArray(words) ? words : [];

      const ai = getGeminiClient();
      if (!ai) {
        // Fallback rule-based speech evaluator if API key is missing
        const normTarget = (targetText || "").toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g,"").replace(/\s+/g," ").trim();
        const normSpoken = (spokenText || "").toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g,"").replace(/\s+/g," ").trim();
        
        const targetWords = normTarget.split(" ");
        const spokenWords = normSpoken.split(" ");

        let matchedCount = 0;
        const spokenWordsCopy = [...spokenWords];
        targetWords.forEach((tw) => {
          // Lenient matching for sentence structure words
          const idx = spokenWordsCopy.findIndex(sw => 
            sw === tw || sw.startsWith(tw) || tw.startsWith(sw)
          );
          if (idx !== -1) {
            matchedCount++;
            spokenWordsCopy.splice(idx, 1);
          }
        });

        const baseRatio = targetWords.length > 0 ? (matchedCount / targetWords.length) : 0;
        
        let vocabMatchedCount = 0;
        const corrections: any[] = [];
        
        targetWordsArray.forEach((vw: string) => {
          const normV = vw.toLowerCase().trim();
          let matched = false;
          for (const sw of spokenWords) {
            const cleanSw = sw.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, "");
            if (cleanSw === normV || 
                cleanSw === (normV + 's') || 
                cleanSw === (normV + 'es') || 
                cleanSw === (normV + 'ed') || 
                cleanSw === (normV + 'ing') || 
                cleanSw === (normV + 'd') || 
                cleanSw === (normV + 'ly') || 
                (cleanSw.startsWith(normV) && Math.abs(cleanSw.length - normV.length) <= 3) ||
                (normV.startsWith(cleanSw) && Math.abs(cleanSw.length - normV.length) <= 3) ||
                (normV.includes(cleanSw) && cleanSw.length >= 4) ||
                (cleanSw.includes(normV) && normV.length >= 4)
            ) {
              matched = true;
              break;
            }
          }
          if (matched) {
            vocabMatchedCount++;
          } else {
            corrections.push({
              word: vw,
              expected: vw,
              spoken: spokenWords.length > 0 ? spokenWords[0] : "None",
              status: "mispronounced",
              phonetic: `/${normV}/`,
              guidance: `Make sure to emphasize the syllables of the word "${vw}" clearly when reading.`
            });
          }
        });

        const vocabRatio = targetWordsArray.length > 0 ? (vocabMatchedCount / targetWordsArray.length) : 0;
        const finalScore = (baseRatio * 0.4 + vocabRatio * 0.6) * 10;
        let roundedScore = Math.round(finalScore * 10) / 10;
        if (roundedScore < 0.5 && spokenWords.length > 0) roundedScore = 0.5;
        // Make fallback scoring generally very lenient
        if (vocabRatio >= 0.6) {
          roundedScore = Math.max(roundedScore, 8.5);
        }
        if (roundedScore > 10) roundedScore = 10;
        const passed = roundedScore >= 5;

        const targetWordsPhonetics = targetWordsArray.map((vw: string) => ({
          word: vw,
          phonetic: `/${vw.toLowerCase()}/`
        }));

        return res.json({
          score: roundedScore,
          passed,
          feedback: passed ? "Well read! You successfully pronounced the key words." : "Please try reading again, paying attention to the target words.",
          corrections,
          targetWordsPhonetics
        });
      }

      const prompt = `Evaluate an English language learner's speech output.
The user was asked to read the following target sentence aloud:
"${targetText}"

The target vocabulary words of focus are: ${JSON.stringify(targetWordsArray)}

The speech-to-text (STT) engine transcribed their spoken output as:
"${spokenText}"

CRITICAL EVALUATION RULES:
1. VOICE RECOGNITION ENGINES ARE IMPERFECT AND UNRELIABLE. You MUST be extremely encouraging, highly lenient, and generous.
2. DO NOT PENALIZE minor transcription errors, accents, small filler words, or homophone/near-homophone substitutions (such as "except" for "accept", "their" for "there", "and" for "an", "is" vs "it's", plurals vs singulars, etc.).
3. If the transcribed text is a reasonable acoustic or semantic representation of the target sentence, or if the target words are present in any recognizable phonetic or tense/plural/past form, treat them as fully correct and give a high score (8.5 to 10.0).
4. Only mark a target word in "corrections" as "mispronounced" or "omitted" if it is completely missing and there is no phonetic equivalent, rhyme, or attempt whatsoever in the transcribed output.
5. Provide a final score out of 10 (decimal, e.g., 9.5) reflecting their reading performance. A score of 5.0 or above is a Pass.
6. Return the output in the specified JSON schema format.`;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              score: {
                type: Type.NUMBER,
                description: "The evaluation score out of 10. A score of 5.0 or more is a Pass."
              },
              passed: {
                type: Type.BOOLEAN,
                description: "True if score is >= 5.0"
              },
              feedback: {
                type: Type.STRING,
                description: "Enthusiastic and motivating feedback summary of the user's reading. Max 50 words."
              },
              corrections: {
                type: Type.ARRAY,
                description: "Details of misspelled or mispronounced words.",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    word: { type: Type.STRING },
                    expected: { type: Type.STRING },
                    spoken: { type: Type.STRING },
                    status: { type: Type.STRING, description: "either 'mispronounced' or 'omitted'" },
                    phonetic: { type: Type.STRING, description: "Phonetic IPA spelling of the word" },
                    guidance: { type: Type.STRING, description: "Short tip to improve pronunciation" }
                  },
                  required: ["word", "expected", "spoken", "status", "phonetic", "guidance"]
                }
              },
              targetWordsPhonetics: {
                type: Type.ARRAY,
                description: "The correct phonetic IPA spellings of each target word in the exercise.",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    word: { type: Type.STRING },
                    phonetic: { type: Type.STRING, description: "IPA spelling of the target word" }
                  },
                  required: ["word", "phonetic"]
                }
              }
            },
            required: ["score", "passed", "feedback", "corrections", "targetWordsPhonetics"]
          }
        }
      });

      const responseText = response.text || "{}";
      const result = JSON.parse(responseText.trim());
      res.json(result);

    } catch (err: any) {
      console.error("Error evaluating speech with Gemini:", err);
      res.status(500).json({
        error: "Failed to evaluate speech",
        score: 5.0,
        passed: true,
        feedback: "Nice effort! Practice makes perfect.",
        corrections: [],
        targetWordsPhonetics: []
      });
    }
  });

  // API Route to generate a speaking paragraph containing exactly 3 target vocabulary words and following one main idea/topic
  app.post("/api/generate-speaking-text", async (req, res) => {
    try {
      const { words } = req.body;
      if (!Array.isArray(words) || words.length < 3) {
        return res.status(400).json({ error: "Please provide exactly 3 words." });
      }

      const ai = getGeminiClient();
      if (!ai) {
        return res.json({ text: null });
      }

      const prompt = `Write a short, engaging, and highly coherent story or paragraph (exactly 2 to 3 sentences, maximum 45 words) that follows ONE clear main idea or topic and incorporates these three English vocabulary words: "${words[0]}", "${words[1]}", and "${words[2]}".
The vocabulary words MUST be used in their correct forms (or simple variations like plurals/past tense) and flow completely naturally.
Do not include any introductory or concluding chatter. Return ONLY the plain text paragraph.`;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
      });

      const responseText = response.text ? response.text.trim() : "";
      res.json({ text: responseText });

    } catch (err: any) {
      console.error("Error generating coherent speaking text:", err);
      res.json({ text: null });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    
    // Explicit routing for app paths
    app.get('/app', (req, res) => {
      res.sendFile(path.join(distPath, 'app.html'));
    });
    app.get('/signup', (req, res) => {
      res.sendFile(path.join(distPath, 'signup.html'));
    });
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
