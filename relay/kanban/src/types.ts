// src/types.ts — Relay domain model (prototype version, localStorage-backed)

export type Source = 'user' | 'slack' | 'salesforce' | 'gmail';
export type Priority = 'low' | 'medium' | 'high';
export type DraftStatus = 'draft-saved' | 'sent';

export interface EmailMessage {
  from: string;
  date: string;
  body: string;
  to?: string;
  cc?: string;
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

export type AgentId = 'email' | 'slack' | 'calendar' | 'coordinator';
export type FilterField = 'from' | 'domain' | 'subject' | 'keyword';
export type FilterOperator = 'contains' | 'is' | 'not_contains';
export type FilterAction = 'skip' | 'escalate' | 'flag';

export interface AgentFilter {
  id: string;
  field: FilterField;
  operator: FilterOperator;
  value: string;
  action: FilterAction;
}

export interface AgentConfig {
  agentId: AgentId;
  enabled: boolean;
  instructions: string;
  filters: AgentFilter[];
  updatedAt: string;
}

export interface StageCondition {
  field: 'classification';
  operator: 'equals' | 'not_equals';
  value: 'ACTION_NEEDED' | 'FYI' | 'NOISE';
}

export interface SkillPipelineStage {
  id: string;
  name: string;
  position: number;
  skillIds: string[];
  condition: StageCondition | null;
}

export interface SkillProfile {
  id: string;
  name: string;
  description?: string;
  stages: SkillPipelineStage[];
  createdAt: string;
  updatedAt: string;
}

export interface UserSkillStatus {
  profile: SkillProfile | null;
  overrides: Record<string, boolean>;
}

export type RuleConditionField = 'from' | 'domain' | 'subject'

export interface EmailRule {
  id: string;
  condition: {
    field: RuleConditionField;
    operator: 'contains' | 'equals';
    value: string;
  };
  action: 'ignore';
  note?: string;
  createdAt: string;
}

export interface EmailGroup {
  id: string;
  name: string;
  color: string;
  description?: string;
  createdAt: string;
}

export interface EmailAddressClassification {
  email: string;
  displayName?: string;
  groupId: string | null;
  updatedAt: string;
}
