import { describe, expect, it } from "vitest";

import {
  AccessError,
  assertWorkspaceBound,
  assignableRoles,
  canAssignRole,
  canManageMember,
  hasPermission,
  parseWorkspaceRole,
} from "@/modules/access/permissions";

describe("permission matrix", () => {
  it("gives Viewer read-only project access", () => {
    expect(hasPermission("Viewer", "project.view")).toBe(true);
    expect(hasPermission("Viewer", "project.create")).toBe(false);
    expect(hasPermission("Viewer", "post.create")).toBe(false);
    expect(hasPermission("Viewer", "media.upload")).toBe(false);
    expect(hasPermission("Viewer", "members.add")).toBe(false);
  });

  it("lets Editor create projects but not archive or manage members", () => {
    expect(hasPermission("Editor", "project.create")).toBe(true);
    expect(hasPermission("Editor", "post.create")).toBe(true);
    expect(hasPermission("Editor", "media.upload")).toBe(true);
    expect(hasPermission("Editor", "project.archive")).toBe(false);
    expect(hasPermission("Editor", "members.changeRole")).toBe(false);
  });

  it("does not let Admin assign Owner or manage an equal Admin", () => {
    expect(canAssignRole("Admin", "Owner")).toBe(false);
    expect(canManageMember("Admin", "Admin")).toBe(false);
    expect(assignableRoles("Admin")).toEqual(["Viewer", "Approver", "Editor"]);
  });

  it("rejects unknown roles and foreign workspace ids", () => {
    expect(() => parseWorkspaceRole("Superadmin")).toThrow(AccessError);
    expect(() => assertWorkspaceBound("ws-a", { workspaceId: "ws-b" }, "Проект")).toThrowError(
      /другому рабочему пространству/,
    );
    expect(() => assertWorkspaceBound("ws-a", null, "Проект")).toThrowError(/не найден/);
  });
});
