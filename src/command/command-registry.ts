import type { CommandRecord, SnapshotSet } from "../types.js";

export interface NewCommandInput {
  readonly command: string;
  readonly explanation: string | undefined;
  readonly beforeSnapshots: SnapshotSet;
  readonly afterSnapshots: SnapshotSet;
  readonly error: string | undefined;
}

export class CommandRegistry {
  private readonly commands: CommandRecord[] = [];
  private nextId = 1;

  addCommand(input: NewCommandInput): CommandRecord {
    const record: CommandRecord = {
      id: this.nextId++,
      command: input.command,
      explanation: input.explanation,
      removed: false,
      beforeSnapshots: input.beforeSnapshots,
      afterSnapshots: input.afterSnapshots,
      error: input.error,
    };
    this.commands.push(record);
    return record;
  }

  removeCommand(id: number): CommandRecord | undefined {
    const record = this.commands.find((c) => c.id === id);
    if (record && !record.removed) {
      record.removed = true;
      return record;
    }
    return undefined;
  }

  getActiveCommands(): readonly CommandRecord[] {
    return this.commands.filter((c) => !c.removed);
  }

  getAllCommands(): readonly CommandRecord[] {
    return this.commands;
  }
}
