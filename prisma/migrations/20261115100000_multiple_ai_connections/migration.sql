-- Allow DeepSeek and ChatGPT (or Qwen) on the same workspace.
DROP INDEX "WorkspaceAiConnection_workspaceId_key";

CREATE UNIQUE INDEX "WorkspaceAiConnection_workspaceId_provider_key" ON "WorkspaceAiConnection"("workspaceId", "provider");

CREATE INDEX "WorkspaceAiConnection_workspaceId_idx" ON "WorkspaceAiConnection"("workspaceId");
