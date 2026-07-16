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

const WORDS_FILE = path.join(process.cwd(), "words-data.json");

// Helper to load current words-data.json
function loadExistingWords(): WordEntry[] {
  if (fs.existsSync(WORDS_FILE)) {
    try {
      const content = fs.readFileSync(WORDS_FILE, "utf8");
      return JSON.parse(content);
    } catch (e) {
      console.warn("Could not parse existing words file:", e);
    }
  }
  return [];
}

// Helper to save words to words-data.json
function saveWords(words: WordEntry[]) {
  fs.writeFileSync(WORDS_FILE, JSON.stringify(words, null, 2), "utf8");
  console.log(`Saved ${words.length} words to words-data.json`);
}

// Parse B2/C1 words from raw-ocr.txt
function parseB2C1FromOcr(): { word: string; pos: string; level: string }[] {
  const ocrPath = path.join(process.cwd(), "raw-ocr.txt");
  if (!fs.existsSync(ocrPath)) {
    console.error("raw-ocr.txt not found!");
    process.exit(1);
  }
  const content = fs.readFileSync(ocrPath, "utf8");
  const lines = content.split("\n");
  const list: { word: string; pos: string; level: string }[] = [];
  
  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    if (line.includes("©") || line.includes("The Oxford")) continue;
    
    const match = line.match(/^([a-zA-Z0-9'\s\-1]+)\s+([a-z.,\s\-]+)?\s*(B2|C1)/i);
    if (match) {
      let word = match[1].trim();
      // Remove trailing digits if any (like bass1 -> bass)
      word = word.replace(/\d+$/, "");
      const pos = match[2] ? match[2].trim().replace(/\.$/, "") : "n";
      const level = match[3].trim().toUpperCase();
      list.push({ word: word.toLowerCase(), pos, level });
    }
  }
  return list;
}

// Helper to retry Gemini calls with model fallback
async function callGemini(prompt: string, schema: any, retries = 5): Promise<any> {
  const models = ["gemini-3.1-flash-lite", "gemini-3.5-flash", "gemini-flash-latest"];
  for (let i = 0; i < retries; i++) {
    const model = models[i % models.length];
    try {
      console.log(`Calling Gemini (model: ${model}, attempt ${i + 1}/${retries})...`);
      const response = await ai.models.generateContent({
        model: model,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: schema,
        }
      });
      const text = response.text || "{}";
      return JSON.parse(text.trim());
    } catch (err) {
      console.error(`Gemini call with ${model} failed (attempt ${i + 1}/${retries}):`, err);
      if (i === retries - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, 3000 * (i + 1)));
    }
  }
}

async function main() {
  console.log("Starting Vocabulary Database Generator...");
  
  // 1. Load existing words to see what we already have
  let dataset = loadExistingWords();
  console.log(`Loaded ${dataset.length} existing words.`);
  
  // Create a map for quick lookups
  const datasetMap = new Map<string, WordEntry>();
  for (const w of dataset) {
    datasetMap.set(`${w.word}:${w.level}`, w);
  }

  // 2. Parse the B2 and C1 words from the OCR file
  const parsedOcr = parseB2C1FromOcr();
  console.log(`Parsed ${parsedOcr.length} B2/C1 words from raw-ocr.txt`);

  // Target counts
  const targetA1 = 500;
  const targetA2 = 1000;
  const targetB1 = 1500;

  // Let's count what we have right now
  const counts = { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0 };
  for (const w of datasetMap.values()) {
    counts[w.level as keyof typeof counts]++;
  }
  console.log("Current counts:", counts);

  // 3. Generate A1 words if we have less than 500
  if (counts.A1 < targetA1) {
    const needed = targetA1 - counts.A1;
    console.log(`Generating ${needed} A1 words in batches of 100...`);
    const batches = Math.ceil(needed / 100);
    
    for (let b = 0; b < batches; b++) {
      const batchSize = Math.min(100, needed - b * 100);
      console.log(`A1 Batch ${b + 1}/${batches} (size: ${batchSize})...`);
      
      const existingList = Array.from(datasetMap.values())
        .filter(w => w.level === "A1")
        .map(w => w.word);
        
      const prompt = `Generate exactly ${batchSize} common A1 (Beginner) English vocabulary words that are NOT in this list: [${existingList.slice(-100).join(", ")}].
For each word, provide:
1. word: string (lowercase)
2. pos: string (e.g. "n", "v", "adj", "adv")
3. meaning: string (simple definition suitable for beginner English learners)
4. synonyms: string (comma-separated list of 2-3 simple synonyms or related words)
5. example: string (a simple, natural example sentence using the word)

Return a JSON array of objects containing these fields. Ensure they are genuine A1 level words, extremely common and useful!`;

      const schema = {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            word: { type: Type.STRING },
            pos: { type: Type.STRING },
            meaning: { type: Type.STRING },
            synonyms: { type: Type.STRING },
            example: { type: Type.STRING }
          },
          required: ["word", "pos", "meaning", "synonyms", "example"]
        }
      };

      const result = await callGemini(prompt, schema);
      if (Array.isArray(result)) {
        for (const entry of result) {
          const w = {
            word: entry.word.toLowerCase().trim(),
            pos: entry.pos.trim(),
            level: "A1",
            meaning: entry.meaning.trim(),
            synonyms: entry.synonyms.trim(),
            example: entry.example.trim()
          };
          if (!datasetMap.has(`${w.word}:A1`)) {
            datasetMap.set(`${w.word}:A1`, w);
          }
        }
        saveWords(Array.from(datasetMap.values()));
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // 4. Generate A2 words if we have less than 1000
  if (counts.A2 < targetA2) {
    const needed = targetA2 - counts.A2;
    console.log(`Generating ${needed} A2 words in batches of 100...`);
    const batches = Math.ceil(needed / 100);
    
    for (let b = 0; b < batches; b++) {
      const batchSize = Math.min(100, needed - b * 100);
      console.log(`A2 Batch ${b + 1}/${batches} (size: ${batchSize})...`);
      
      const existingList = Array.from(datasetMap.values())
        .filter(w => w.level === "A2")
        .map(w => w.word);
        
      const prompt = `Generate exactly ${batchSize} common A2 (Elementary) English vocabulary words that are NOT in this list: [${existingList.slice(-100).join(", ")}].
For each word, provide:
1. word: string (lowercase)
2. pos: string (e.g. "n", "v", "adj", "adv")
3. meaning: string (simple definition suitable for elementary English learners)
4. synonyms: string (comma-separated list of 2-3 simple synonyms or related words)
5. example: string (a natural example sentence using the word)

Return a JSON array of objects containing these fields. Ensure they are genuine A2 level words, common and useful!`;

      const schema = {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            word: { type: Type.STRING },
            pos: { type: Type.STRING },
            meaning: { type: Type.STRING },
            synonyms: { type: Type.STRING },
            example: { type: Type.STRING }
          },
          required: ["word", "pos", "meaning", "synonyms", "example"]
        }
      };

      const result = await callGemini(prompt, schema);
      if (Array.isArray(result)) {
        for (const entry of result) {
          const w = {
            word: entry.word.toLowerCase().trim(),
            pos: entry.pos.trim(),
            level: "A2",
            meaning: entry.meaning.trim(),
            synonyms: entry.synonyms.trim(),
            example: entry.example.trim()
          };
          if (!datasetMap.has(`${w.word}:A2`)) {
            datasetMap.set(`${w.word}:A2`, w);
          }
        }
        saveWords(Array.from(datasetMap.values()));
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // 5. Generate B1 words if we have less than 1500
  if (counts.B1 < targetB1) {
    const needed = targetB1 - counts.B1;
    console.log(`Generating ${needed} B1 words in batches of 100...`);
    const batches = Math.ceil(needed / 100);
    
    for (let b = 0; b < batches; b++) {
      const batchSize = Math.min(100, needed - b * 100);
      console.log(`B1 Batch ${b + 1}/${batches} (size: ${batchSize})...`);
      
      const existingList = Array.from(datasetMap.values())
        .filter(w => w.level === "B1")
        .map(w => w.word);
        
      const prompt = `Generate exactly ${batchSize} common B1 (Intermediate) English vocabulary words that are NOT in this list: [${existingList.slice(-100).join(", ")}].
For each word, provide:
1. word: string (lowercase)
2. pos: string (e.g. "n", "v", "adj", "adv")
3. meaning: string (clear definition suitable for intermediate English learners)
4. synonyms: string (comma-separated list of 2-3 synonyms or related words)
5. example: string (a natural example sentence using the word)

Return a JSON array of objects containing these fields. Ensure they are genuine B1 level words, common and useful!`;

      const schema = {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            word: { type: Type.STRING },
            pos: { type: Type.STRING },
            meaning: { type: Type.STRING },
            synonyms: { type: Type.STRING },
            example: { type: Type.STRING }
          },
          required: ["word", "pos", "meaning", "synonyms", "example"]
        }
      };

      const result = await callGemini(prompt, schema);
      if (Array.isArray(result)) {
        for (const entry of result) {
          const w = {
            word: entry.word.toLowerCase().trim(),
            pos: entry.pos.trim(),
            level: "B1",
            meaning: entry.meaning.trim(),
            synonyms: entry.synonyms.trim(),
            example: entry.example.trim()
          };
          if (!datasetMap.has(`${w.word}:B1`)) {
            datasetMap.set(`${w.word}:B1`, w);
          }
        }
        saveWords(Array.from(datasetMap.values()));
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // 6. Generate details for B2 and C1 words parsed from OCR
  console.log("Checking B2 and C1 words parsed from OCR...");
  const missingB2C1 = parsedOcr.filter(p => !datasetMap.has(`${p.word}:${p.level}`));
  console.log(`Found ${missingB2C1.length} B2/C1 words missing in dataset.`);

  if (missingB2C1.length > 0) {
    const batchSize = 100;
    const batches = Math.ceil(missingB2C1.length / batchSize);
    console.log(`Populating details for ${missingB2C1.length} words in ${batches} batches...`);

    for (let b = 0; b < batches; b++) {
      const chunk = missingB2C1.slice(b * batchSize, (b + 1) * batchSize);
      console.log(`B2/C1 Batch ${b + 1}/${batches} (size: ${chunk.length})...`);

      const wordListStr = chunk.map(c => `"${c.word}" (${c.pos}, ${c.level})`).join(", ");
      const prompt = `For each of these specific English vocabulary words, provide their meaning, synonyms, and a clear, natural example sentence. Make sure to match their specified Level and Part of Speech (pos):
[${wordListStr}]

For each word, return:
1. word: string (lowercase)
2. pos: string (keep the provided part of speech, or use correct standard like "n", "v", "adj", "adv")
3. level: string (keep the provided level B2 or C1 exactly)
4. meaning: string (clear definition suitable for advanced English learners)
5. synonyms: string (comma-separated list of 2-3 synonyms or related words)
6. example: string (a natural example sentence using the word)

Return a JSON array of objects containing these fields. Ensure you include EVERY SINGLE WORD in the requested list!`;

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
        for (const entry of result) {
          const w = {
            word: entry.word.toLowerCase().trim(),
            pos: entry.pos.trim(),
            level: entry.level.trim().toUpperCase(),
            meaning: entry.meaning.trim(),
            synonyms: entry.synonyms.trim(),
            example: entry.example.trim()
          };
          datasetMap.set(`${w.word}:${w.level}`, w);
        }
        saveWords(Array.from(datasetMap.values()));
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // 7. Verify counts are exact and clean up any duplicates or invalid records
  console.log("Verifying dataset...");
  const finalDataset = Array.from(datasetMap.values());
  
  // Make sure we have exactly at least 500 A1, 1000 A2, 1500 B1, and all the B2/C1 words
  const finalCounts = { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0 };
  for (const w of finalDataset) {
    finalCounts[w.level as keyof typeof finalCounts]++;
  }
  console.log("Final counts:", finalCounts);
  
  // Save one final time to make sure everything is completely ordered
  // Order: A1 first, then A2, B1, B2, C1
  const levelOrder = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5 };
  finalDataset.sort((a, b) => {
    const orderA = levelOrder[a.level as keyof typeof levelOrder] || 99;
    const orderB = levelOrder[b.level as keyof typeof levelOrder] || 99;
    if (orderA !== orderB) return orderA - orderB;
    return a.word.localeCompare(b.word);
  });

  saveWords(finalDataset);
  console.log("Vocabulary database generation complete!");
}

main().catch(err => {
  console.error("Critical error in database generation:", err);
  process.exit(1);
});
