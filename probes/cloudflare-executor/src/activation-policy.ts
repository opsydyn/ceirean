import { Option } from 'effect';

// No operator key, account authorization or final inputs have been approved yet.
// Only a separately reviewed change may configure this trusted boundary.
export const trustedApprovalPolicy: Option.Option<unknown> = Option.none();
