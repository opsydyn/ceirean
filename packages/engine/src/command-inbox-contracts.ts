import type { makeCommandInbox } from './command-inbox-factory.ts';

export {
  AdmissionDraft,
  AdmissionRecord,
  AdmissionReply,
  AuthorityObservation,
  CommitReply,
  VerifiedCommand,
} from '@leviathan/domain';

export type CommandInboxDriver = Parameters<typeof makeCommandInbox>[0];
