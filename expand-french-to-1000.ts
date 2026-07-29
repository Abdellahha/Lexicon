import fs from "fs";
import path from "path";

const FRENCH_FILE = path.join(process.cwd(), "french-words-data.json");

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

const EXTRA_FRENCH_WORDS: FrenchWordEntry[] = [
  { word: "bonjour", pos: "interj.", level: "A1", meaning: "Formule de salutation polie employée pendant la journée.", synonyms: "salut, coucou", example: "Bonjour tout le monde !", translation_en: "hello", translation_ar: "مرحبا", example_translation_en: "Hello everyone!", example_translation_ar: "مرحبا بالجميع!" },
  { word: "merci", pos: "interj.", level: "A1", meaning: "Expression de la gratitude.", synonyms: "gratitude, remerciement", example: "Merci beaucoup pour votre aide.", translation_en: "thank you", translation_ar: "شكرا", example_translation_en: "Thank you very much for your help.", example_translation_ar: "شكرا جزيلا لمساعدتك." },
  { word: "s'il vous plaît", pos: "expr.", level: "A1", meaning: "Formule de politesse pour demander quelque chose.", synonyms: "veuillez, svp", example: "Un café, s'il vous plaît.", translation_en: "please", translation_ar: "من فضلك", example_translation_en: "A coffee, please.", example_translation_ar: "قهوة من فضلك." },
  { word: "au revoir", pos: "interj.", level: "A1", meaning: "Formule de salutation en quittant quelqu'un.", synonyms: "à bientôt, adieu", example: "Au revoir et bonne journée !", translation_en: "goodbye", translation_ar: "إلى اللقاء", example_translation_en: "Goodbye and have a nice day!", example_translation_ar: "إلى اللقاء ويوم سعيد!" },
  { word: "ami", pos: "n.m.", level: "A1", meaning: "Personne avec laquelle on a des liens d'affection réciproques.", synonyms: "copain, camarade", example: "C'est un bon ami de classe.", translation_en: "friend", translation_ar: "صديق", example_translation_en: "He is a good classmate friend.", example_translation_ar: "إنه صديق دراسة جيد." },
  { word: "maison", pos: "n.f.", level: "A1", meaning: "Bâtiment destiné à l'habitation.", synonyms: "demeure, logement", example: "La maison est grande et accueillante.", translation_en: "house", translation_ar: "منزل", example_translation_en: "The house is big and welcoming.", example_translation_ar: "المنزل كبير ومرحب." },
  { word: "manger", pos: "v.", level: "A1", meaning: "Absorber un aliment.", synonyms: "dévorer, consommer", example: "Nous allons manger ensemble ce midi.", translation_en: "to eat", translation_ar: "أن يأكل", example_translation_en: "We are going to eat together this noon.", example_translation_ar: "سوف نأكل معا هذا الظهر." },
  { word: "boire", pos: "v.", level: "A1", meaning: "Avaler un liquide.", synonyms: "désaltérer, consommer", example: "Il faut boire de l'eau tous les jours.", translation_en: "to drink", translation_ar: "أن يشرب", example_translation_en: "You must drink water every day.", example_translation_ar: "يجب شرب الماء كل يوم." },
  { word: "livre", pos: "n.m.", level: "A1", meaning: "Assemblage de feuilles imprimées formant un ouvrage.", synonyms: "bouquin, ouvrage", example: "J'aime lire un livre avant de dormir.", translation_en: "book", translation_ar: "كتاب", example_translation_en: "I like reading a book before sleeping.", example_translation_ar: "أحب قراءة كتاب قبل النوم." },
  { word: "école", pos: "n.f.", level: "A1", meaning: "Établissement où l'on dispense un enseignement.", synonyms: "établissement, collège", example: "Les enfants vont à l'école le matin.", translation_en: "school", translation_ar: "مدرسة", example_translation_en: "Children go to school in the morning.", example_translation_ar: "يذهب الأطفال إلى المدرسة صباحا." }
];

function main() {
  let list: FrenchWordEntry[] = [];
  if (fs.existsSync(FRENCH_FILE)) {
    list = JSON.parse(fs.readFileSync(FRENCH_FILE, "utf8"));
  }

  const map = new Map<string, FrenchWordEntry>();
  list.forEach(w => map.set(`${w.word.toLowerCase()}:${w.level.toUpperCase()}`, w));

  EXTRA_FRENCH_WORDS.forEach(w => {
    const key = `${w.word.toLowerCase()}:${w.level.toUpperCase()}`;
    if (!map.has(key)) {
      map.set(key, w);
    }
  });

  const finalDataset = Array.from(map.values());
  const levelOrder: Record<string, number> = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5 };
  finalDataset.sort((a, b) => {
    const oa = levelOrder[a.level.toUpperCase()] || 99;
    const ob = levelOrder[b.level.toUpperCase()] || 99;
    if (oa !== ob) return oa - ob;
    return a.word.localeCompare(b.word);
  });

  fs.writeFileSync(FRENCH_FILE, JSON.stringify(finalDataset, null, 2), "utf8");
  console.log(`Saved ${finalDataset.length} French words to french-words-data.json`);
}

main();
