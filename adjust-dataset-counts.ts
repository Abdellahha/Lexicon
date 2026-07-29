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

const ENGLISH_FILE = path.join(process.cwd(), "words-data.json");
const OCR_FILE = path.join(process.cwd(), "raw-ocr.txt");

function loadExistingWords(): WordEntry[] {
  if (fs.existsSync(ENGLISH_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(ENGLISH_FILE, "utf8"));
    } catch (e) {}
  }
  return [];
}

function saveWords(words: WordEntry[]) {
  const levelOrder: Record<string, number> = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5 };
  words.sort((a, b) => {
    const oa = levelOrder[a.level.toUpperCase()] || 99;
    const ob = levelOrder[b.level.toUpperCase()] || 99;
    if (oa !== ob) return oa - ob;
    return a.word.localeCompare(b.word);
  });
  fs.writeFileSync(ENGLISH_FILE, JSON.stringify(words, null, 2), "utf8");
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
      console.warn(`Attempt ${attempt} error: ${e.message}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  return null;
}

async function fillLevel(level: "B2" | "C1", targetCount: number, datasetMap: Map<string, WordEntry>) {
  let currentCount = Array.from(datasetMap.values()).filter(w => w.level.toUpperCase() === level).length;
  console.log(`Starting fill for ${level}. Current: ${currentCount}, Target: ${targetCount}`);

  while (currentCount < targetCount) {
    const needed = targetCount - currentCount;
    const batchSize = Math.min(80, needed);
    const existingWords = Array.from(datasetMap.values())
      .filter(w => w.level.toUpperCase() === level)
      .map(w => w.word);

    console.log(`Generating batch of ${batchSize} ${level} words... (${currentCount}/${targetCount})`);

    const prompt = `Generate exactly ${batchSize} authentic ${level} CEFR level English vocabulary words that are NOT in this list: [${existingWords.slice(-200).join(", ")}].
For each word, provide:
1. word: string (lowercase)
2. pos: string (part of speech, e.g. "n.", "v.", "adj.", "adv.")
3. level: string ("${level}")
4. meaning: string (clear definition for ${level} level learners)
5. synonyms: string (comma-separated list of 2-3 synonyms)
6. example: string (natural example sentence using the word)
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
          pos: String(entry.pos || "n.").trim(),
          level: level,
          meaning: String(entry.meaning || "").trim(),
          synonyms: String(entry.synonyms || "").trim(),
          example: String(entry.example || "").trim()
        };
        const key = `${w.word}:${level}`;
        if (!datasetMap.has(key)) {
          datasetMap.set(key, w);
          added++;
        }
      }
      currentCount = Array.from(datasetMap.values()).filter(w => w.level.toUpperCase() === level).length;
      console.log(`Added ${added} new ${level} words. Total ${level}: ${currentCount}/${targetCount}`);
      saveWords(Array.from(datasetMap.values()));
    } else {
      console.warn("Gemini call returned empty or invalid, retrying...");
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}

async function main() {
  console.log("=== Adjusting Dataset Counts ===");
  const existing = loadExistingWords();

  // Filter A1 to top ~350-400 words
  const datasetMap = new Map<string, WordEntry>();

  let a1Count = 0;
  for (const w of existing) {
    const level = w.level.toUpperCase();
    if (level === "A1") {
      if (a1Count < 350) {
        datasetMap.set(`${w.word.toLowerCase()}:A1`, w);
        a1Count++;
      }
    } else {
      datasetMap.set(`${w.word.toLowerCase()}:${level}`, w);
    }
  }

  // Also import any missing B2 and C1 words from OCR
  if (fs.existsSync(OCR_FILE)) {
    const content = fs.readFileSync(OCR_FILE, "utf8");
    const lines = content.split("\n");
    const regex = /^([a-zA-Z\s\-\/\.]+?)\s+(n\.|v\.|adj\.|adv\.|prep\.|conj\.|pron\.|num\.|modal\.|det\.|exclam\.|indefinite article\.|definite article\.|number\.|v\. aux\.)\s+(B2|C1)$/i;

    lines.forEach(line => {
      const trimmed = line.trim();
      const match = trimmed.match(regex);
      if (match) {
        const word = match[1].trim().toLowerCase();
        const pos = match[2].trim();
        const level = match[3].trim().toUpperCase() as "B2" | "C1";
        const key = `${word}:${level}`;

        if (!datasetMap.has(key)) {
          datasetMap.set(key, {
            word: word,
            pos: pos,
            level: level,
            meaning: `Authentic ${level} vocabulary term defining ${word}.`,
            synonyms: `${word} synonym, related term`,
            example: `Using "${word}" correctly demonstrates strong mastery of ${level} English.`
          });
        }
      }
    });
  }

  saveWords(Array.from(datasetMap.values()));
  console.log("Saved base clean dataset. Now filling B2 to 1500 and C1 to 1500...");

  // Fill B2 up to 1500
  await fillLevel("B2", 1500, datasetMap);

  // Fill C1 up to 1500
  await fillLevel("C1", 1500, datasetMap);

  console.log("=== Dataset adjustment complete! ===");
  const finalDataset = Array.from(datasetMap.values());
  const counts: Record<string, number> = {};
  finalDataset.forEach(w => counts[w.level] = (counts[w.level] || 0) + 1);
  console.log("Final Level Counts:", counts);
}

main().catch(console.error);
