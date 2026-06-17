// src/types.ts — Relay domain model (prototype version, localStorage-backed)

export type Source = 'user' | 'slack' | 'salesforce' | 'gmail';
export type Priority = 'low' | 'medium' | 'high';
export type DraftStatus = 'draft-saved' | 'sent';

export interface EmailMessage {
  from: string;
  date: string;
  body: string;
}

export interface Attachment {
  name: string;
  url: string;
}

export interface ClientInfo {
  name: string;
  company?: string;
}

export interface RoutedFrom {
  name: string;
  userId?: string;
  note?: string;
  at?: string;
}

export interface ReplyMeta {
  threadId: string;
  to: string;
  subject: string;
  messageId?: string;
}

export interface Card {
  id: string;
  title: string;
  description?: string;
  source: Source;
  provider?: string;
  externalId?: string;
  assigneeId?: string;
  client?: ClientInfo;
  dueDate?: string;
  priority?: Priority;
  projectId?: string;
  routedFrom?: RoutedFrom;
  parentId?: string;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
  // Email-specific
  emailThread?: EmailMessage[];
  attachments?: Attachment[];
  summary?: string;
  sourceUrl?: string;
  replyMeta?: ReplyMeta;
  todosExtracted?: boolean;
  // Communication state
  draft?: string;
  draftStatus?: DraftStatus;
  completionNotes?: string;
  // Delegation — set when the card is assigned to another user. The card stays
  // on the owner's board but is classified as delegated.
  delegatedAt?: string;
  // Skill pipeline — which skills ran on this card, base first then customs.
  skillsApplied?: string[];
}

export interface Column {
  id: string;
  title: string;
  cardIds: string[];
}

export interface Board {
  columns: Column[];
  cards: Record<string, Card>;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  color: string;
  createdAt: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatarColor: string;
}

export type SkillCategory = 'email' | 'slack' | 'salesforce';
export type SkillKind = 'base' | 'custom';

export interface Skill {
  id: string;
  userId?: string;
  name: string;
  category: SkillCategory;
  kind: SkillKind;
  description: string;
  instructions: string;
  enabled: boolean;
  updatedAt: string;
}

export interface ApprovalLogEntry {
  id: string;
  userId: string;
  cardId: string;
  cardTitle: string;
  source: Source;
  action: string;
  messagePreview: string;
  approvedById: string;
  approvedByName: string;
  approvedAt: string;
  externalRef?: string;
}

export type IntegrationProvider = 'gmail' | 'slack' | 'salesforce';
export type IntegrationStatus = 'connected' | 'disconnected' | 'error';

export interface IntegrationConnection {
  id: string;
  userId: string;
  provider: IntegrationProvider;
  status: IntegrationStatus;
  scopes: string[];
  accountEmail?: string;
  lastSyncedAt?: string;
}
