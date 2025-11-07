import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

export type AuditRecord = {
  id: string;
  action: string;
  actor: string;
  target: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
};

export type ConsentRecord = {
  id: string;
  subject: string;
  grantedBy: string;
  scope: string;
  expiresAt?: string;
  timestamp: string;
};

type GovernanceState = {
  audits: AuditRecord[];
  consents: ConsentRecord[];
};

const GOVERNANCE_PATH = path.resolve("./data/governance.json");

const ensureDir = () => {
  const directory = path.dirname(GOVERNANCE_PATH);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
};

const loadState = (): GovernanceState => {
  try {
    const file = fs.readFileSync(GOVERNANCE_PATH, "utf8");
    const parsed = JSON.parse(file) as GovernanceState;
    return {
      audits: parsed.audits ?? [],
      consents: parsed.consents ?? []
    } satisfies GovernanceState;
  } catch (error) {
    return { audits: [], consents: [] } satisfies GovernanceState;
  }
};

const persistState = (state: GovernanceState) => {
  ensureDir();
  fs.writeFileSync(GOVERNANCE_PATH, JSON.stringify(state, null, 2));
};

export class GovernanceStore {
  static async recordAudit(record: Omit<AuditRecord, "id">): Promise<AuditRecord> {
    const state = loadState();
    const audit: AuditRecord = { ...record, id: randomUUID() };
    state.audits.push(audit);
    persistState(state);
    return audit;
  }

  static async recordConsent(record: Omit<ConsentRecord, "id" | "timestamp"> & { timestamp?: string }): Promise<ConsentRecord> {
    const state = loadState();
    const consent: ConsentRecord = {
      id: randomUUID(),
      timestamp: record.timestamp ?? new Date().toISOString(),
      subject: record.subject,
      grantedBy: record.grantedBy,
      scope: record.scope,
      expiresAt: record.expiresAt
    };
    state.consents.push(consent);
    persistState(state);
    return consent;
  }

  static async listAudits(limit = 100): Promise<AuditRecord[]> {
    const state = loadState();
    return state.audits.slice(-limit).reverse();
  }

  static async listConsents(): Promise<ConsentRecord[]> {
    const state = loadState();
    return [...state.consents].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }
}
