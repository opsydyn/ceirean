import { Context } from 'effect';

import { makeCommandInbox } from './command-inbox-factory.ts';

export class CommandInbox extends Context.Service<
  CommandInbox,
  ReturnType<typeof makeCommandInbox>
>()('@ceirean/engine/CommandInbox') {}
