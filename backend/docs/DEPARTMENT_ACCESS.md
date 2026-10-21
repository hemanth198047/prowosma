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

## What is enforced (phases 1 and 2)

**Scoped to what the person may see:** projects, tasks (comments, attachments, dependencies, subtasks, checklists, watchers, relationships, time logs), the dashboard summary, notifications, the activity log, search (projects and tasks only), the Gantt chart, and the meeting assistant (including Fireflies).

* **Notifications and the activity log** show only entries about tasks and projects the person can see. Workspace announcements stay visible. System notices and entries about the team, goals and so on are hidden.
* **Search** returns projects and tasks they can see; other kinds of result are left out for restricted people. (It was also searching other workspaces' records; that is fixed for everyone.)
* **Meeting assistant:** needs the `USE_MEETING_ASSISTANT` capability. A restricted person sees only their own meetings and ones shared with them (not "visible to the whole workspace", and an Admin role does not widen it). Project suggestions for a meeting only come from projects the person who started it can see, so other departments' project names never reach the AI model. Tasks and projects created from a meeting follow the normal rules: creating needs `CREATE_TASK` / `CREATE_PROJECT`, and giving tasks to other people needs `ALLOCATE_TASKS`.
* **Fireflies:** a restricted person can send the notetaker to their own meeting. "Load my recent Fireflies meetings" and "Import" list the whole company's Fireflies account, so they stay owner/admin only.
* **Watchers:** adding someone as a watcher lets them see the task, so a restricted person can only watch tasks themselves unless they have `ALLOCATE_TASKS`.

**Default-deny gate** (`access/AccessGatePolicy.java`): restricted people reach only `/api/projects`, `/api/tasks`, `/api/docs`, `/api/notifications` (except announce), `/api/dashboard/summary`, `/api/search`, `/api/gantt` (reads, plus moving a task's dates), `/api/activity-logs` (reads, except export, integrity check and summary), `/api/meeting-assistant` (with the capability, except the Fireflies account list and import), `/api/team`, `/api/categories` and `/api/custom-fields` (reads), `/api/workspaces` (list), `/api/auth`, `/api/users/me`, `/api/access/me`, `/api/access/options`. Everything else returns 403 `ACCESS_RESTRICTED`. Add an area to the allowlist only after scoping it, with a test.

Project budgets, spend and revenue are removed from responses unless the profile has `VIEW_FINANCIALS`.

While access control is on, workspace live events carry no titles or names (a "something changed" ping), for everyone in the workspace.

**Documents** follow a workspace setting (Access Control → Overview → *How documents are shared*):

| Setting | Who sees a document |
|---|---|
| `BOTH` (default) | Each document chooses: **departments** (members of its departments, plus its creator and people it is shared with) or **private** (its creator and people it is shared with). |
| `DEPARTMENTS` | By department only. Per-person sharing isn't offered or honoured. |
| `PRIVATE_SHARED` | Only the creator and the people the document is shared with. Departments aren't offered or honoured. |

A document's creator always sees and manages it. A department admin manages documents of their departments. Only unrestricted people (the owner, an ALL-scope profile) can make a document visible to the **whole workspace**; once someone has, everyone can read it but only its creator or a manager can edit it. A person who can see a document can edit it, comment, view its history and join its live editing; only the creator or a manager can change who sees it, delete it, publish it or delete versions.

Applies to: the document list, search, recent and favourites, opening, editing, moving, duplicating, comments, version history, publishing, tags, and the live collaboration socket (checked on subscribe and on every edit, with short-lived caching so revoking access takes effect within about 30 seconds).

**Documents that existed before access control** have no audience, so once people are restricted only their creator (and anyone they were shared with) sees them. Access Control → Overview → *Documents made before access control* gives all of them an audience in one step (departments, whole workspace, or creators only). Documents created while access control is off are treated the same way.

Also fixed for everyone: the docs list, search, recent and favourites took the workspace from the URL instead of the verified request, and a new document could name another workspace in its body. Both now use the verified workspace.

**Still closed to restricted people** (scoping each needs its own design): goals, sprints, KPIs, reports, analytics, portfolio and ROI views, decisions, the older Meetings area, channels, automations, integrations, AI features, import/export, time tracking.

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

* Unrestricted members (including legacy members with no profile) see every document. Keep genuinely confidential material (HR, pay) in a separate workspace.
* A document's child pages are checked one by one; a visible page under a hidden parent shows at the top level.
* Task attachment downloads are by unguessable file name and are not checked against the task.
* API-key callers are not restricted.
* The legacy `/api/user-groups` API lets any non-viewer edit groups; department membership should be managed through Access Control.
* Realtime for documents (`/topic/doc/*`) is unchanged.

## Fireflies (client key)

Already built: Meeting Assistant → *Fireflies notetaker (admins)* → tick the option, paste the client's Fireflies API key, **Save**, **Test connection**. The key is stored encrypted (server needs `ENCRYPTION_KEY`; never change it once keys are saved) and never shown again. See `FIREFLIES_INTEGRATION.md`. Run one real test meeting before relying on it.
