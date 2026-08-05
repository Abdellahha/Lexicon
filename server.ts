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

// Helper to try multiple models in sequence in case of quota/rate limits
async function generateGeminiContent(ai: GoogleGenAI, params: { contents: any; config?: any }) {
  const modelsToTry = ["gemini-flash-latest", "gemini-2.5-flash", "gemini-2.5-flash"];
  let lastError: any = null;
  for (const model of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: params.contents,
        config: params.config,
      });
      return response;
    } catch (err: any) {
      console.warn(`Gemini model ${model} failed (${err?.status || err?.message}), trying fallback...`);
      lastError = err;
    }
  }
  throw lastError;
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

  // API Route to translate text using Gemini (or simple dictionary fallback)
  app.post("/api/translate", async (req, res) => {
    const text = String(req.body?.text || "");
    const to = req.body?.to;
    try {
      if (!text) {
        return res.status(400).json({ error: "Text is required" });
      }

      const langMap: Record<string, string> = {
        ar: "Arabic", arabic: "Arabic",
        fr: "French", french: "French",
        es: "Spanish", spanish: "Spanish",
        de: "German", german: "German",
        it: "Italian", italian: "Italian",
        tr: "Turkish", turkish: "Turkish",
        ru: "Russian", russian: "Russian",
        pt: "Portuguese", portuguese: "Portuguese",
        en: "English", english: "English"
      };
      const rawTo = String(to || "arabic").toLowerCase().trim();
      const targetLang = langMap[rawTo] || (rawTo.charAt(0).toUpperCase() + rawTo.slice(1));

      const ai = getGeminiClient();
      if (!ai) {
        const cleanText = text.toLowerCase().trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, "");
        const dictionary: Record<string, Record<string, string>> = {
          "reconcile": { "arabic": "يصالح / يسوي", "french": "réconcilier", "english": "reconcile" },
          "abolish": { "arabic": "يلغي / ينهي", "french": "abolir", "english": "abolish" },
          "absorb": { "arabic": "يمتص", "french": "absorber", "english": "absorb" }
        };

        const result = dictionary[cleanText];
        let translation = "";
        if (result && result[rawTo]) {
          translation = result[rawTo];
        } else {
          translation = text;
        }
        return res.json({ translation });
      }

      const prompt = `You are a professional dictionary and translator. Translate the word or phrase "${text}" into ${targetLang}. 
If it is a single word, provide a clean, concise, 1-3 word accurate translation. 
Respond with ONLY the plain translated text in ${targetLang}. Do not write any explanations, quotes, or extra punctuation.`;

      const response = await generateGeminiContent(ai, { contents: prompt });

      const translation = response.text ? response.text.trim() : text;
      res.json({ translation });
    } catch (err) {
      console.error("Error translating text with Gemini:", err);
      // Clean fallback: return the original word rather than ugly failure text
      res.json({ translation: text });
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

      const response = await generateGeminiContent(ai, {
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
      console.warn("Error generating AI advice, returning fallback:", err?.message || err);
      const currentLvl = req.body?.englishLevel || 'A1';
      res.json({ 
        advice: `Keep practicing! You are making great progress in level ${currentLvl}. Consistency is key to mastering vocabulary.`,
        recommendLevelUp: false,
        recommendedLevel: null
      });
    }
  });

  // Helper for generating grammatically precise fallback stories by part of speech
  const generateFallbackStory = (wordsList: string[], detailsList: any[], bIdx: number) => {
    const sentences = wordsList.map((w) => {
      const detail = detailsList.find((d: any) => d && d.word && d.word.toLowerCase() === String(w).toLowerCase()) || {};
      if (detail.example && typeof detail.example === 'string' && detail.example.length > 10) {
        return detail.example.trim();
      }
      const pos = String(detail.pos || "").toLowerCase();
      if (pos.includes("verb")) {
        return `The group worked diligently to ${w} their objectives.`;
      } else if (pos.includes("adj") || pos.includes("adjective")) {
        return `They observed an unusually ${w} aspect during the expedition.`;
      } else if (pos.includes("adv") || pos.includes("adverb")) {
        return `The team proceeded ${w} to ensure complete success.`;
      } else {
        // Noun / default
        return `Everyone appreciated the importance of ${w} in their work.`;
      }
    });

    const topics = [
      "Topic: Outdoor Exploration & Environmental Science",
      "Topic: Creative Studio & Cultural Innovation",
      "Topic: Scientific Research & Deep Discovery",
      "Topic: Global Traditions & Culinary Heritage",
      "Topic: Sustainable Architecture & Urban Living"
    ];

    return {
      title: topics[bIdx % topics.length],
      story: sentences.join(" ")
    };
  };

  // API Route to generate a reading story using 15-20 learned words
  app.post("/api/generate-learned-story", async (req, res) => {
    try {
      const { words, wordDetails, batchIndex } = req.body;
      const targetWords = Array.isArray(words) ? words : [];
      const wordDetailsList = Array.isArray(wordDetails) ? wordDetails : [];
      const idx = typeof batchIndex === 'number' ? batchIndex : 0;

      if (!targetWords.length) {
        return res.status(400).json({ error: "No words provided" });
      }

      const ai = getGeminiClient();
      if (!ai) {
        const fallback = generateFallbackStory(targetWords, wordDetailsList, idx);
        return res.json({ title: fallback.title, story: fallback.story, wordsUsed: targetWords });
      }

      const wordContextsFormatted = wordDetailsList.length > 0
        ? wordDetailsList.map((d: any) => `- WORD: "${d.word}" | POS: ${d.pos || 'unknown'} | MEANING: ${d.meaning || 'N/A'}${d.example ? ' | USAGE EXAMPLE: ' + d.example : ''}`).join('\n')
        : targetWords.map((w: string) => `- WORD: "${w}"`).join('\n');

      const prompt = `You are a world-class TEFL textbook author, linguist, and Oxford English dictionary editor.
Write a clear, engaging, cohesive, and 100% grammatically flawless reading passage (80 to 150 words) for English language learners.

SETTING FOR TEXT #${idx + 1}:
Select an authentic, realistic topic (e.g. Nature Exploration, Science Research, Cultural History, Culinary Arts, City Architecture, Space Investigation, Community Projects).

TARGET VOCABULARY LIST (WITH PARTS OF SPEECH & DEFINITIONS):
${wordContextsFormatted}

STRICT LINGUISTIC & GRAMMATICAL RULES:
1. PERFECT PART OF SPEECH & SEMANTIC ACCURACY:
   - You MUST use every target word strictly in accordance with its defined Part of Speech and exact meaning.
2. NATURAL INFLECTION ALLOWED:
   - You MAY inflect verbs or pluralize nouns so the prose reads smoothly.
3. COHESIVE PROSE:
   - Connect the sentences into a single, flowing, natural paragraph.
   - NO META-LANGUAGE: Do NOT list words, do NOT write "words like...", or mention language learning.
4. LANGUAGE LEVEL HIGH QUALITY:
   - The passage MUST serve as an exemplary, professional model of standard syntax.

Return JSON format with "title" (e.g., 'Topic: Mountain Expedition & Conservation') and "story" fields.`;

      const response = await generateGeminiContent(ai, {
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: {
                type: Type.STRING,
                description: "Specific topic title"
              },
              story: {
                type: Type.STRING,
                description: "The full story text incorporating all target words"
              }
            },
            required: ["title", "story"]
          }
        }
      });

      const responseText = response.text || "{}";
      const result = JSON.parse(responseText.trim());
      res.json({
        title: result.title || ("Topic: " + (targetWords[0] ? targetWords[0].charAt(0).toUpperCase() + targetWords[0].slice(1) : "Vocabulary Practice")),
        story: result.story || "Story text...",
        wordsUsed: targetWords
      });

    } catch (err: any) {
      console.warn("Error generating learned words story with Gemini, using fallback:", err?.message || err);
      const targetWords = Array.isArray(req.body?.words) ? req.body.words : [];
      const wordDetailsList = Array.isArray(req.body?.wordDetails) ? req.body.wordDetails : [];
      const idx = typeof req.body?.batchIndex === 'number' ? req.body.batchIndex : 0;
      
      const fallback = generateFallbackStory(targetWords, wordDetailsList, idx);
      res.json({
        title: fallback.title,
        story: fallback.story,
        wordsUsed: targetWords
      });
    }
  });

  // API Route to evaluate spoken text for Speak & Read Practice
  app.post("/api/evaluate-speech", async (req, res) => {
    try {
      const { targetText, spokenText, words, alternatives } = req.body;
      const targetWordsArray = Array.isArray(words) ? words : [];
      const alternativesArray = Array.isArray(alternatives) ? alternatives : [];

      // Combine all spoken candidate texts into a search pool
      const allSpokenCandidates = [spokenText, ...alternativesArray].filter(Boolean);

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

        // Helper: Levenshtein distance for fuzzy matching
        const levenshtein = (a: string, b: string): number => {
          if (!a.length) return b.length;
          if (!b.length) return a.length;
          const matrix: number[][] = [];
          for (let i = 0; i <= b.length; i++) matrix[i] = [i];
          for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
          for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
              if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
              } else {
                matrix[i][j] = Math.min(
                  matrix[i - 1][j - 1] + 1,
                  matrix[i][j - 1] + 1,
                  matrix[i - 1][j] + 1
                );
              }
            }
          }
          return matrix[b.length][a.length];
        };
        
        targetWordsArray.forEach((vw: string) => {
          const normV = vw.toLowerCase().trim();
          let matched = false;

          // Search across all candidate transcripts
          for (const cand of allSpokenCandidates) {
            const candClean = cand.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, "");
            const candWords = candClean.split(/\s+/);
            const candNoSpaces = candClean.replace(/\s+/g, "");

            // Substring or concatenated phrase match (e.g. "a mend" -> "amend", "ad zorb" -> "absorb")
            if (candClean.includes(normV) || candNoSpaces.includes(normV) || normV.includes(candClean) && candClean.length >= 4) {
              matched = true;
              break;
            }

            for (const sw of candWords) {
              if (!sw) continue;
              if (sw === normV || 
                  sw === (normV + 's') || 
                  sw === (normV + 'es') || 
                  sw === (normV + 'ed') || 
                  sw === (normV + 'ing') || 
                  sw === (normV + 'd') || 
                  sw === (normV + 'ly') || 
                  sw === (normV + 'er') ||
                  (sw.startsWith(normV) && Math.abs(sw.length - normV.length) <= 3) ||
                  (normV.startsWith(sw) && Math.abs(sw.length - normV.length) <= 3)
              ) {
                matched = true;
                break;
              }

              // Levenshtein fuzzy match
              const dist = levenshtein(sw, normV);
              const maxDist = normV.length <= 4 ? 1 : (normV.length <= 7 ? 2 : 3);
              if (dist <= maxDist) {
                matched = true;
                break;
              }
            }
            if (matched) break;
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
        if (vocabRatio >= 0.5) {
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

      const alternativesText = alternativesArray.length > 0
        ? `\nAlternative STT candidate transcripts: ${JSON.stringify(alternativesArray.slice(0, 10))}`
        : "";

      const prompt = `Evaluate an English language learner's speech output.
The user was asked to read the following target sentence aloud:
"${targetText}"

The target vocabulary words of focus are: ${JSON.stringify(targetWordsArray)}

Primary Speech-To-Text (STT) Transcription:
"${spokenText}"${alternativesText}

CRITICAL EVALUATION RULES FOR MAXIMUM ACCURACY AND FAIRNESS:
1. SPEECH-TO-TEXT ENGINES IN BROWSERS ARE IMPERFECT AND REGULARLY MISHEAR ACCENTS, PAUSES, OR HOMOPHONES. You MUST be extremely encouraging, lenient, and generous.
2. A target vocabulary word MUST BE COUNTED AS CORRECTLY SPOKEN if:
   - It appears in the primary STT transcription OR in any of the alternative candidate transcripts.
   - It was transcribed as a homophone, phonetic near-match, or similar-sounding word (for example: "bot" for "bought", "except" for "accept", "ad zorb" or "absorbed" for "absorb", "bizar" for "bizarre", "complane" for "complain", "whether" for "weather", "shoes" for "choose", "site" for "sight", "fostered" for "foster", "a mend" for "amend", etc.).
   - It was split across spaces by STT (e.g. "a mend" for "amend").
   - It has minor inflection differences (singular vs plural, present vs past tense).
3. If the user successfully attempted or read the target vocabulary words (even with slight accent/STT variation), give a HIGH SCORE (8.5 to 10.0) and set passed: true.
4. Do NOT mark a target word in "corrections" as "mispronounced" or "omitted" unless it is completely missing with NO phonetic, acoustic, or homophone trace whatsoever in any of the transcripts.
5. Provide a final score out of 10 (decimal, e.g., 9.5) reflecting their reading performance. A score of 5.0 or above is a Pass.
6. Return the output in the specified JSON schema format.`;

      const response = await generateGeminiContent(ai, {
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
      console.warn("Error evaluating speech with Gemini, returning fallback:", err?.message || err);
      res.json({
        score: 8.5,
        passed: true,
        feedback: "Great reading effort! Practice makes perfect.",
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

      const response = await generateGeminiContent(ai, {
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
