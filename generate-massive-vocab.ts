import fs from "fs";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY is not set!");
  process.exit(1);
}

const ai = new GoogleGenAI({
  apiKey: apiKey,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

interface WordEntry {
  word: string;
  pos: string;
  level: string;
  meaning: string;
  synonyms: string;
  example: string;
}

interface FrenchWordEntry {
  word: string;
  pos: string;
  level: string;
  meaning: string;
  synonyms: string;
  example: string;
  translation_en: string;
  translation_ar: string;
  example_translation_en: string;
  example_translation_ar: string;
}

const ENGLISH_FILE = path.join(process.cwd(), "words-data.json");
const FRENCH_FILE = path.join(process.cwd(), "french-words-data.json");

function loadEnglishWords(): WordEntry[] {
  if (fs.existsSync(ENGLISH_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(ENGLISH_FILE, "utf8"));
    } catch (e) {}
  }
  return [];
}

function saveEnglishWords(words: WordEntry[]) {
  fs.writeFileSync(ENGLISH_FILE, JSON.stringify(words, null, 2), "utf8");
}

function loadFrenchWords(): FrenchWordEntry[] {
  if (fs.existsSync(FRENCH_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(FRENCH_FILE, "utf8"));
    } catch (e) {}
  }
  return [];
}

function saveFrenchWords(words: FrenchWordEntry[]) {
  fs.writeFileSync(FRENCH_FILE, JSON.stringify(words, null, 2), "utf8");
}

async function callGemini(prompt: string, schema: any) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: schema,
          temperature: 0.7,
        }
      });
      if (response.text) {
        return JSON.parse(response.text);
      }
    } catch (e: any) {
      console.warn(`Attempt ${attempt} failed: ${e.message}. Retrying in 2s...`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  return null;
}

async function generateEnglishLevel(level: string, targetCount: number) {
  let list = loadEnglishWords();
  let existingMap = new Map<string, WordEntry>();
  list.forEach(w => existingMap.set(`${w.word.toLowerCase()}:${w.level.toUpperCase()}`, w));

  let currentCount = Array.from(existingMap.values()).filter(w => w.level.toUpperCase() === level).length;
  console.log(`Current English ${level} count: ${currentCount} / ${targetCount}`);

  while (currentCount < targetCount) {
    const batchSize = Math.min(80, targetCount - currentCount);
    const existingWords = Array.from(existingMap.values())
      .filter(w => w.level.toUpperCase() === level)
      .map(w => w.word);

    console.log(`Generating batch of ${batchSize} English ${level} words...`);

    const prompt = `Generate exactly ${batchSize} authentic ${level} CEFR level English vocabulary words that are NOT in this list: [${existingWords.slice(-150).join(", ")}].
For each word, provide:
1. word: string (lowercase)
2. pos: string (part of speech, e.g. "n", "v", "adj", "adv")
3. level: string (must be "${level}")
4. meaning: string (clear, accurate definition)
5. synonyms: string (comma-separated list of 2-3 synonyms)
6. example: string (a natural example sentence using the word)
Return a JSON array of objects.`;

    const schema = {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          word: { type: Type.STRING },
          pos: { type: Type.STRING },
          level: { type: Type.STRING },
          meaning: { type: Type.STRING },
          synonyms: { type: Type.STRING },
          example: { type: Type.STRING }
        },
        required: ["word", "pos", "level", "meaning", "synonyms", "example"]
      }
    };

    const result = await callGemini(prompt, schema);
    if (Array.isArray(result) && result.length > 0) {
      let added = 0;
      for (const entry of result) {
        if (!entry.word) continue;
        const w: WordEntry = {
          word: String(entry.word).toLowerCase().trim(),
          pos: String(entry.pos || "n").trim(),
          level: level,
          meaning: String(entry.meaning || "").trim(),
          synonyms: String(entry.synonyms || "").trim(),
          example: String(entry.example || "").trim()
        };
        const key = `${w.word}:${level}`;
        if (!existingMap.has(key)) {
          existingMap.set(key, w);
          added++;
        }
      }
      currentCount = Array.from(existingMap.values()).filter(w => w.level.toUpperCase() === level).length;
      console.log(`Added ${added} new ${level} words. Total ${level}: ${currentCount}/${targetCount}`);
      saveEnglishWords(Array.from(existingMap.values()));
    } else {
      console.warn("Failed to get valid response from Gemini, retrying...");
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}

async function generateFrenchLevel(level: string, targetCount: number) {
  let list = loadFrenchWords();
  let existingMap = new Map<string, FrenchWordEntry>();
  list.forEach(w => existingMap.set(`${w.word.toLowerCase()}:${w.level.toUpperCase()}`, w));

  let currentCount = Array.from(existingMap.values()).filter(w => w.level.toUpperCase() === level).length;
  console.log(`Current French ${level} count: ${currentCount} / ${targetCount}`);

  while (currentCount < targetCount) {
    const batchSize = Math.min(50, targetCount - currentCount);
    const existingWords = Array.from(existingMap.values())
      .filter(w => w.level.toUpperCase() === level)
      .map(w => w.word);

    console.log(`Generating batch of ${batchSize} French ${level} words...`);

    const prompt = `Generate exactly ${batchSize} authentic ${level} CEFR level French vocabulary words that are NOT in this list: [${existingWords.slice(-100).join(", ")}].
For each word, provide:
1. word: string (lowercase French word)
2. pos: string (part of speech in French, e.g. "n.m.", "n.f.", "v.", "adj.", "adv.", "expr.")
3. level: string (must be "${level}")
4. meaning: string (clear French definition)
5. synonyms: string (comma-separated French synonyms)
6. example: string (natural French example sentence)
7. translation_en: string (English translation of the word)
8. translation_ar: string (Arabic translation of the word)
9. example_translation_en: string (English translation of example sentence)
10. example_translation_ar: string (Arabic translation of example sentence)
Return a JSON array of objects.`;

    const schema = {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          word: { type: Type.STRING },
          pos: { type: Type.STRING },
          level: { type: Type.STRING },
          meaning: { type: Type.STRING },
          synonyms: { type: Type.STRING },
          example: { type: Type.STRING },
          translation_en: { type: Type.STRING },
          translation_ar: { type: Type.STRING },
          example_translation_en: { type: Type.STRING },
          example_translation_ar: { type: Type.STRING }
        },
        required: ["word", "pos", "level", "meaning", "synonyms", "example", "translation_en", "translation_ar", "example_translation_en", "example_translation_ar"]
      }
    };

    const result = await callGemini(prompt, schema);
    if (Array.isArray(result) && result.length > 0) {
      let added = 0;
      for (const entry of result) {
        if (!entry.word) continue;
        const w: FrenchWordEntry = {
          word: String(entry.word).toLowerCase().trim(),
          pos: String(entry.pos || "n.m.").trim(),
          level: level,
          meaning: String(entry.meaning || "").trim(),
          synonyms: String(entry.synonyms || "").trim(),
          example: String(entry.example || "").trim(),
          translation_en: String(entry.translation_en || "").trim(),
          translation_ar: String(entry.translation_ar || "").trim(),
          example_translation_en: String(entry.example_translation_en || "").trim(),
          example_translation_ar: String(entry.example_translation_ar || "").trim()
        };
        const key = `${w.word}:${level}`;
        if (!existingMap.has(key)) {
          existingMap.set(key, w);
          added++;
        }
      }
      currentCount = Array.from(existingMap.values()).filter(w => w.level.toUpperCase() === level).length;
      console.log(`Added ${added} new French ${level} words. Total ${level}: ${currentCount}/${targetCount}`);
      saveFrenchWords(Array.from(existingMap.values()));
    } else {
      console.warn("Failed to get valid response from Gemini for French, retrying...");
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}

async function main() {
  console.log("=== STARTING MASSIVE VOCABULARY GENERATION ===");
  
  // 1. Generate English C1 and B2 up to 1000 words each!
  console.log("--> Generating English C1 words (Target: 1000)...");
  await generateEnglishLevel("C1", 1000);

  console.log("--> Generating English B2 words (Target: 1000)...");
  await generateEnglishLevel("B2", 1000);

  console.log("--> Generating English A1 words (Target: 1000)...");
  await generateEnglishLevel("A1", 1000);

  console.log("--> Generating English A2 words (Target: 1000)...");
  await generateEnglishLevel("A2", 1000);

  console.log("--> Generating English B1 words (Target: 1000)...");
  await generateEnglishLevel("B1", 1000);

  // 2. Generate French words for all levels up to 200 words each (Total 1000)
  console.log("--> Generating French C1 words (Target: 200)...");
  await generateFrenchLevel("C1", 200);

  console.log("--> Generating French B2 words (Target: 200)...");
  await generateFrenchLevel("B2", 200);

  console.log("--> Generating French B1 words (Target: 200)...");
  await generateFrenchLevel("B1", 200);

  console.log("--> Generating French A2 words (Target: 200)...");
  await generateFrenchLevel("A2", 200);

  console.log("--> Generating French A1 words (Target: 200)...");
  await generateFrenchLevel("A1", 200);

  console.log("=== MASSIVE VOCABULARY GENERATION FINISHED ===");
}

main().catch(err => {
  console.error("Error in massive generation:", err);
  process.exit(1);
});
