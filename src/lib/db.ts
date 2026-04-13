import Dexie, { type EntityTable } from "dexie";

export type Session = {
  id?: number;
  title: string;
  createdAt: number;
  totalScore: number | null;
};

export type Sentence = {
  id?: number;
  sessionId: number;
  original: string;
  translation: string;
  referenceTranslation?: string;
  score: number | null;
  feedback: string;
  length: number;
};

export type Favorite = {
  id?: number;
  sentenceId: number;
  sessionId: number;
  original: string;
  translation: string;
  referenceTranslation?: string;
  score: number | null;
  feedback: string;
  createdAt: number;
};

class PolyglotDatabase extends Dexie {
  sessions!: EntityTable<Session, "id">;
  sentences!: EntityTable<Sentence, "id">;
  favorites!: EntityTable<Favorite, "id">;

  constructor() {
    super("polyglot_test_db");
    this.version(1).stores({
      sessions: "++id, createdAt",
      sentences: "++id, sessionId",
    });
    this.version(2).stores({
      sessions: "++id, createdAt",
      sentences: "++id, sessionId",
      favorites: "++id, sentenceId",
    });
  }
}

export const db = new PolyglotDatabase();
