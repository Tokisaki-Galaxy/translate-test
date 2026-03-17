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
  score: number | null;
  feedback: string;
  length: number;
};

class PolyglotDatabase extends Dexie {
  sessions!: EntityTable<Session, "id">;
  sentences!: EntityTable<Sentence, "id">;

  constructor() {
    super("polyglot_test_db");
    this.version(1).stores({
      sessions: "++id, createdAt",
      sentences: "++id, sessionId",
    });
  }
}

export const db = new PolyglotDatabase();
