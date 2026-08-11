export type PendingAgentOperation = {
  agentId: string;
  operationId: string;
  observationId: string;
  requestedAtMs: number;
};

export type OperationRegistryCheckpoint = {
  nextOperationNumber: number;
  pending: PendingAgentOperation[];
};

// Adapted from AI Town's inProgressOperation/operationId guard. The provider
// may finish after a participant dies, a timeout, or a restore; stale results
// must never become canonical actions. See THIRD_PARTY_NOTICES.md.
export class AgentOperationRegistry {
  private nextOperationNumber = 1;
  private readonly pending = new Map<string, PendingAgentOperation>();

  start(agentId: string, observationId: string, requestedAtMs: number): PendingAgentOperation | null {
    if (this.pending.has(agentId)) return null;
    const operation: PendingAgentOperation = {
      agentId,
      operationId: `agent-operation-${this.nextOperationNumber++}`,
      observationId,
      requestedAtMs,
    };
    this.pending.set(agentId, operation);
    return operation;
  }

  accept(agentId: string, operationId: string): PendingAgentOperation | null {
    const operation = this.pending.get(agentId);
    if (!operation || operation.operationId !== operationId) return null;
    this.pending.delete(agentId);
    return operation;
  }

  cancel(agentId: string): void {
    this.pending.delete(agentId);
  }

  expireOlderThan(nowMs: number, timeoutMs: number): PendingAgentOperation[] {
    const expired: PendingAgentOperation[] = [];
    for (const operation of this.pending.values()) {
      if (nowMs - operation.requestedAtMs < timeoutMs) continue;
      expired.push(operation);
      this.pending.delete(operation.agentId);
    }
    return expired;
  }

  has(agentId: string): boolean {
    return this.pending.has(agentId);
  }

  checkpoint(): OperationRegistryCheckpoint {
    return {
      nextOperationNumber: this.nextOperationNumber,
      pending: [...this.pending.values()].map((operation) => ({ ...operation })),
    };
  }

  restore(checkpoint?: OperationRegistryCheckpoint): void {
    this.pending.clear();
    this.nextOperationNumber = Math.max(1, checkpoint?.nextOperationNumber ?? 1);
    for (const operation of checkpoint?.pending ?? []) {
      this.pending.set(operation.agentId, { ...operation });
    }
  }
}
