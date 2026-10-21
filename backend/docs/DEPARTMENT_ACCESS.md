# Department and project access control

Lets one workspace hold several teams without every team seeing every other team's work. It is generic:
departments, access profiles and project responsibilities are data an admin defines per workspace.

## The model

| Concept | What it is | Where it lives |
|---|---|---|
| **Department** | A group of people that owns projects. Separate from job title. | `user_groups` with `type = DEPARTMENT` |
| **Designation** | Free-text job title. | `TeamMember.title` |
| **Access profile** | What a person may *see* (scope) and a few things they may *do* (capabilities). | `access_profiles` |
| **Workspace role** | ADMIN / MEMBER / VIEWER: controls workspace settings. Unrelated to what someone sees. | `TeamMember.role` |
| **Project visibility** | `WORKSPACE`, `DEPARTMENTS` or `MEMBERS_ONLY`, plus owning departments, extra members, approvers and named responsibilities. | on `Project` |

Scopes: `ALL`; `MY_DEPARTMENTS` (their departments' projects, plus projects they are named on, plus work assigned to them); `ASSIGNED_ONLY` (only tasks they are assigned to, watch or created, and the projects those sit in).
Capabilities: `CREATE_PROJECT`, `CREATE_TASK`, `ALLOCATE_TASKS`, `APPROVE`, `VIEW_FINANCIALS`, `USE_MEETING_ASSISTANT`.
A *department admin* is a `MY_DEPARTMENTS` profile with the flag set: they manage (change visibility of, delete) projects owned by their departments, without being a workspace Admin.

The workspace owner is never restricted. Rules live in `access/AccessScope.java` (pure Java, unit tested); the per-request scope is built by `VisibilityService`.

## Safe by default

* Access control is **off** until an admin switches it on (Access Control → Overview).
* A member with **no profile** is unrestricted unless a *default profile* is set. Set a restrictive default before switching on, so people who join later start limited.
* Anything unknown (a deleted profile, a project with an unrecognised visibility) is treated as the most restrictive option.

## What is enforced in this release (phase 1)

Projects, tasks (including comments, attachments, dependencies, time logs), the live feed, and the member list.
Restricted people reach **only** these API areas (`access/AccessGatePolicy.java`): `/api/projects`, `/api/tasks`, `/api/team` (read), `/api/categories` and `/api/custom-fields` (read), `/api/workspaces` (list), `/api/auth`, `/api/users/me`, `/api/access/me`, `/api/access/options`. Everything else (dashboard, search, reports, analytics, Gantt, goals, docs, meetings and the meeting assistant, notifications, activity log, AI, import/export …) returns 403 `ACCESS_RESTRICTED` until it is scoped. Add an area to the allowlist only after scoping it, with a test.

Project budgets, spend and revenue are removed from responses unless the profile has `VIEW_FINANCIALS`.

While access control is on, workspace live events carry no titles or names (a "something changed" ping), for everyone in the workspace.

## Setting up a company

1. Access Control → **Organisation setup**: paste or open a JSON structure, **Preview changes**, then **Apply**. Safe to repeat. See `docs/templates/` for the Wilmarcs files.
2. Fill in real work emails first. People without a valid email are skipped and listed as warnings. People not yet in the workspace are invited only if "send invitations" is ticked; the invitation carries their profile, designation and departments and applies them when accepted.
3. Choose the default profile and default project visibility, then switch access control on.
4. For each project: 🔐 on the project card → visibility, departments, named people, responsibilities, approvers.
5. **Test with non-admin accounts** (one per scope) before telling the team.

Sensitive HR / compensation / finance records belong in a **separate workspace** (`wilmarcs-hr-workspace.json`), not in the main one. Do not make Adithya (external HR) a member of the main workspace.

### JSON structure

```json
{ "profiles":   [{ "name", "description", "scope", "departmentAdmin", "capabilities": [] }],
  "departments":[{ "name" }],
  "roleSlots":  [{ "key", "label" }],
  "defaultProfile": "profile name",
  "defaultProjectVisibility": "DEPARTMENTS",
  "members":    [{ "name", "email", "role": "MEMBER|VIEWER", "designation", "profile", "departments": ["name"] }],
  "enableAccessControl": false }
```
Org setup never creates admins; make those by hand.

## API

* `GET /api/access/me`, `GET /api/access/options`: any member.
* `/api/admin/access/{settings,profiles,departments,members,org-setup}`: owner/admin only (every `/api/admin/` path is, reads included).
* `PUT /api/projects/{id}/access`: project creator, department admin of the project's departments, or an unrestricted admin.

## Known limits

* Restricted profiles cannot use the meeting assistant (including Fireflies), dashboards, search, docs, notifications or the activity log yet. The owner and unrestricted admins can.
* API-key callers are not restricted.
* The legacy `/api/user-groups` API lets any non-viewer edit groups; department membership should be managed through Access Control.
* Realtime for documents (`/topic/doc/*`) is unchanged.

## Fireflies (client key)

Already built: Meeting Assistant → *Fireflies notetaker (admins)* → tick the option, paste the client's Fireflies API key, **Save**, **Test connection**. The key is stored encrypted (server needs `ENCRYPTION_KEY`; never change it once keys are saved) and never shown again. See `FIREFLIES_INTEGRATION.md`. Run one real test meeting before relying on it.
