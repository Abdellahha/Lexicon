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

const FRENCH_FILE = path.join(process.cwd(), "french-words-data.json");

function loadFrenchWords(): FrenchWordEntry[] {
  if (fs.existsSync(FRENCH_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(FRENCH_FILE, "utf8"));
    } catch (e) {}
  }
  return [];
}

function saveFrenchWords(words: FrenchWordEntry[]) {
  const levelOrder: Record<string, number> = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5 };
  words.sort((a, b) => {
    const oa = levelOrder[a.level.toUpperCase()] || 99;
    const ob = levelOrder[b.level.toUpperCase()] || 99;
    if (oa !== ob) return oa - ob;
    return a.word.localeCompare(b.word);
  });
  fs.writeFileSync(FRENCH_FILE, JSON.stringify(words, null, 2), "utf8");
}

async function callGemini(prompt: string, schema: any) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: schema,
          temperature: 0.5,
        }
      });
      if (response.text) {
        return JSON.parse(response.text);
      }
    } catch (e: any) {
      console.warn(`French attempt ${attempt} error: ${e.message}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  return null;
}

async function populateFrenchLevel(level: string, targetCount: number) {
  const list = loadFrenchWords();
  const existingMap = new Map<string, FrenchWordEntry>();
  list.forEach(w => existingMap.set(`${w.word.toLowerCase()}:${w.level.toUpperCase()}`, w));

  let currentCount = Array.from(existingMap.values()).filter(w => w.level.toUpperCase() === level).length;
  console.log(`Current French ${level} count: ${currentCount} / ${targetCount}`);

  while (currentCount < targetCount) {
    const batchSize = Math.min(40, targetCount - currentCount);
    const existingWords = Array.from(existingMap.values())
      .filter(w => w.level.toUpperCase() === level)
      .map(w => w.word);

    console.log(`Generating French batch of ${batchSize} ${level} words...`);

    const prompt = `Generate exactly ${batchSize} authentic ${level} CEFR level French vocabulary words that are NOT in this list: [${existingWords.slice(-100).join(", ")}].
For each word, provide:
1. word: string (lowercase French word)
2. pos: string (part of speech, e.g. "n.m.", "n.f.", "v.", "adj.", "adv.")
3. level: string ("${level}")
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
      console.warn("French batch failed, retrying...");
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}

async function main() {
  console.log("Starting French Vocabulary Generation...");
  await populateFrenchLevel("C1", 200);
  await populateFrenchLevel("B2", 200);
  await populateFrenchLevel("B1", 200);
  await populateFrenchLevel("A2", 200);
  await populateFrenchLevel("A1", 200);
  console.log("French Vocabulary Generation Complete!");
}

main().catch(console.error);
