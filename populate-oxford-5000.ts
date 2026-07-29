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
  // Sort by level order: A1, A2, B1, B2, C1, then word
  const levelOrder: Record<string, number> = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5 };
  words.sort((a, b) => {
    const oa = levelOrder[a.level.toUpperCase()] || 99;
    const ob = levelOrder[b.level.toUpperCase()] || 99;
    if (oa !== ob) return oa - ob;
    return a.word.localeCompare(b.word);
  });
  fs.writeFileSync(ENGLISH_FILE, JSON.stringify(words, null, 2), "utf8");
}

function parseOcrWords(): { word: string; pos: string; level: string }[] {
  if (!fs.existsSync(OCR_FILE)) return [];
  const content = fs.readFileSync(OCR_FILE, "utf8");
  const lines = content.split("\n");
  const result: { word: string; pos: string; level: string }[] = [];
  const regex = /^([a-zA-Z\s\-\/\.]+?)\s+(n\.|v\.|adj\.|adv\.|prep\.|conj\.|pron\.|num\.|modal\.|det\.|exclam\.|indefinite article\.|definite article\.|number\.|v\. aux\.)\s+(B2|C1)$/i;
  
  lines.forEach(line => {
    const trimmed = line.trim();
    const match = trimmed.match(regex);
    if (match) {
      result.push({
        word: match[1].trim().toLowerCase(),
        pos: match[2].trim(),
        level: match[3].trim().toUpperCase()
      });
    }
  });
  return result;
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
          temperature: 0.3,
        }
      });
      if (response.text) {
        return JSON.parse(response.text);
      }
    } catch (e: any) {
      console.warn(`Attempt ${attempt} error: ${e.message}`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  return null;
}

async function main() {
  console.log("Starting Oxford 5000 Population...");
  const existing = loadExistingWords();
  const datasetMap = new Map<string, WordEntry>();
  existing.forEach(w => datasetMap.set(`${w.word.toLowerCase()}:${w.level.toUpperCase()}`, w));

  const ocrWords = parseOcrWords();
  console.log(`Parsed ${ocrWords.length} B2/C1 words from raw-ocr.txt`);

  // Filter OCR words that are missing detailed definitions
  const missingOcr = ocrWords.filter(w => !datasetMap.has(`${w.word}:${w.level}`));
  console.log(`Found ${missingOcr.length} missing B2/C1 words.`);

  if (missingOcr.length > 0) {
    const batchSize = 40;
    const totalBatches = Math.ceil(missingOcr.length / batchSize);
    
    for (let b = 0; b < totalBatches; b++) {
      const chunk = missingOcr.slice(b * batchSize, (b + 1) * batchSize);
      console.log(`Processing B2/C1 Batch ${b + 1}/${totalBatches} (${chunk.length} words)...`);
      
      const wordListStr = chunk.map(c => `"${c.word}" (${c.pos}, ${c.level})`).join(", ");
      const prompt = `Provide precise clear definitions, 2-3 synonyms, and realistic example sentences for the following English vocabulary words matching their specified Part of Speech and Level:
[${wordListStr}]

Return a JSON array of objects with fields:
1. word: string (lowercase)
2. pos: string (part of speech, e.g. "n.", "v.", "adj.", "adv.")
3. level: string ("B2" or "C1")
4. meaning: string (clear definition for advanced learners)
5. synonyms: string (comma-separated synonyms)
6. example: string (natural sentence using the word)`;

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
      if (Array.isArray(result)) {
        let added = 0;
        for (const entry of result) {
          if (!entry.word) continue;
          const w: WordEntry = {
            word: String(entry.word).toLowerCase().trim(),
            pos: String(entry.pos || "n.").trim(),
            level: String(entry.level || "C1").toUpperCase().trim(),
            meaning: String(entry.meaning || "").trim(),
            synonyms: String(entry.synonyms || "").trim(),
            example: String(entry.example || "").trim()
          };
          datasetMap.set(`${w.word}:${w.level}`, w);
          added++;
        }
        console.log(`Saved batch ${b + 1}. Added ${added} entries.`);
        saveWords(Array.from(datasetMap.values()));
      } else {
        console.warn(`Batch ${b + 1} failed, saving fallback placeholders for un-generated chunk...`);
        for (const c of chunk) {
          const w: WordEntry = {
            word: c.word,
            pos: c.pos,
            level: c.level,
            meaning: `Advanced ${c.level} vocabulary word referring to ${c.word}.`,
            synonyms: "related term",
            example: `It is important to understand the concept of ${c.word} in context.`
          };
          if (!datasetMap.has(`${w.word}:${w.level}`)) {
            datasetMap.set(`${w.word}:${w.level}`, w);
          }
        }
        saveWords(Array.from(datasetMap.values()));
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  const finalWords = Array.from(datasetMap.values());
  console.log(`Finished processing B2/C1. Total dataset size: ${finalWords.length}`);
  
  const counts: Record<string, number> = {};
  finalWords.forEach(w => counts[w.level] = (counts[w.level] || 0) + 1);
  console.log("Final Level Counts:", counts);
}

main().catch(console.error);
