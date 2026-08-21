# PATCH GitHub Repository Reconstruction Task

You are continuing work on the PATCH project.

I want you to take the existing PATCH project and populate an already-created GitHub repository with it in a **realistic, contribution-sized, sequential development history**.

This is NOT a request to simply run `git add .` and commit the entire project.

The goal is to make the repository look like PATCH was progressively developed and contributed over time, while preserving the exact functionality of the existing project.

---

# 1. CRITICAL SOURCE SAFETY RULE

There is an existing PATCH project that is the **SOURCE OF TRUTH**.

The original project must be treated as **READ-ONLY**.

You may:

* inspect it
* read files
* analyze its architecture
* copy files from it
* copy assets from it
* use its code as the implementation reference

You MUST NOT:

* modify the original source files
* delete anything from the source
* rename anything in the source
* move anything in the source
* refactor anything in the source
* format anything in the source
* run automated fixes against the source
* install packages into the source unless absolutely unavoidable
* generate build artifacts inside the source
* change configuration in the source

The source must remain byte-for-byte unchanged as much as reasonably possible.

---

# 2. FIRST ACTION: DETERMINE SOURCE AND DESTINATION

Before copying anything or making any commit, inspect the filesystem.

Determine:

```text
SOURCE PROJECT:
<absolute path>

DESTINATION GIT REPOSITORY:
<absolute path>

SOURCE .git:
<path or none>

DESTINATION .git:
<path or none>
```

Also determine:

```text
Current destination branch:
Current destination git status:
Existing destination commits:
Existing destination files:
Remote repository:
```

### CRITICAL SAFETY CHECK

If the source project and destination Git repository are actually the SAME physical directory:

**STOP IMMEDIATELY.**

Do not modify anything.

Tell me that the source and destination are the same directory and that a separate destination is required.

Do NOT assume that two different names mean two different physical locations.

---

# 3. IMPORTANT PATH INFORMATION

The PATCH source has previously been identified as:

```text
C:\Users\muzam\Downloads\PATCH-browser-context-agentic-fixed-2026-08-20\PATCH
```

There may also be a Git repository associated with:

```text
C:\Users\muzam\OneDrive\Desktop\Programming\PATCH
```

Do not assume either location is correct.

**Inspect the filesystem and determine the actual locations first.**

The source and destination must remain separate.

---

# 4. DO NOT MODIFY THE SOURCE

Before beginning the reconstruction, calculate or otherwise record the source project's current state.

After every major stage, verify that the source has not been modified.

If practical, record file timestamps/hashes before beginning and compare them later.

If you detect that your actions have modified the source:

**STOP.**

Do not continue committing or pushing.

---

# 5. UNDERSTAND THE EXISTING PROJECT FIRST

Before creating the contribution sequence, inspect the complete source project.

Identify:

### Root

* package.json
* pnpm-lock.yaml
* pnpm-workspace.yaml
* turbo.json
* tsconfig files
* .gitignore
* README
* configuration
* scripts

### Apps

* apps/desktop
* apps/windows-bridge

### Adapters

* adapters/chrome
* adapters/photoshop

### Packages

Identify all actual packages, including but not limited to:

* shared
* schemas
* protocol
* patch-dsl
* security
* logging
* persistence
* ai-core
* provider-openai
* provider-gemini
* tool-registry

Do NOT assume these directories exist.

Use the actual project structure.

---

# 6. THE GITHUB REPOSITORY ALREADY EXISTS

Do not create another GitHub repository.

Do not run `git init` if the destination is already a Git repository.

Do not overwrite an existing Git history.

First inspect:

```text
git status
git branch
git log --oneline --decorate -n 20
git remote -v
```

If the repository already contains commits or files, analyze them first.

Do not destroy existing work.

---

# 7. OVERALL CONTRIBUTION STRATEGY

Build the destination repository in dependency order.

The following is the proposed high-level order.

Adjust it if inspection shows that a different order is technically more correct.

---

## CONTRIBUTION 1

### Repository Foundation

Add only the actual root-level project foundation files required by PATCH.

Potential files:

```text
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
tsconfig.base.json
turbo.json
.editorconfig
.npmrc
.gitignore
LICENSE
```

Only copy files that actually exist and are required.

Verify the workspace structure.

Commit:

```text
chore: initialize PATCH monorepo
```

---

# 8. CONTRIBUTION 2

## Shared Packages

Add the foundational packages.

Potentially:

```text
packages/shared/
packages/schemas/
packages/protocol/
packages/patch-dsl/
packages/security/
packages/logging/
```

But inspect dependency relationships first.

If one package depends on another, establish the correct order.

For large packages, do NOT necessarily commit the entire package in one commit.

For example:

```text
feat: define shared application types
feat: add validation schemas
feat: establish protocol contracts
feat: add security and logging primitives
```

Use as many commits as are technically justified.

Do not create artificial commits merely to increase the commit count.

---

# 9. CONTRIBUTION 3

## AI Infrastructure

Add:

```text
packages/ai-core/
packages/provider-openai/
packages/provider-gemini/
packages/tool-registry/
```

Again, inspect dependencies.

A reasonable progression might be:

```text
feat: define AI provider interfaces
feat: implement AI planning core
feat: add OpenAI provider integration
feat: add Gemini provider integration
feat: establish AI tool registry
```

If the actual source architecture suggests another order, follow the actual architecture.

---

# 10. CONTRIBUTION 4

## Persistence

Add:

```text
packages/persistence/
```

Build this in meaningful layers if necessary:

```text
feat: define persistence models
feat: implement SQLite database layer
feat: add preference persistence
```

Do not commit local database files.

Never copy:

```text
*.sqlite
*.sqlite3
*.db
```

unless a database file is explicitly intended as a tracked fixture and you have verified that it contains no private/local data.

---

# 11. CONTRIBUTION 5

## Windows Native Bridge

Add the actual source files for:

```text
apps/windows-bridge/
```

Include the C# source and project configuration.

Do NOT include:

```text
bin/
obj/
```

Do not copy compiled binaries.

A reasonable sequence may be:

```text
feat: scaffold Windows bridge project
feat: implement Windows UI automation bridge
feat: add Chrome native messaging host
```

Only create these commits if the source architecture supports them.

---

# 12. CONTRIBUTION 6

## Chrome Adapter

Add:

```text
adapters/chrome/
```

including the actual source, manifest, scripts, public assets, and package configuration.

Potential progression:

```text
feat: scaffold Chrome companion extension
feat: implement Chrome context adapter
feat: add Chrome native messaging integration
```

Again, use the actual project architecture.

---

# 13. CONTRIBUTION 7

## Photoshop Adapter

Add the actual Photoshop UXP plugin.

Potential progression:

```text
feat: scaffold Photoshop UXP adapter
feat: implement Photoshop context integration
feat: connect Photoshop adapter protocol
```

Do not blindly split files if the implementation does not naturally support it.

---

# 14. CONTRIBUTION 8

## Electron Application Shell

Add:

```text
apps/desktop/
```

But do NOT blindly copy the complete finished desktop application in one commit.

Build it logically.

For example:

```text
feat: scaffold Electron application
feat: add desktop main process
feat: add preload bridge
feat: initialize React renderer
feat: establish renderer styling system
```

Then proceed into functionality.

---

# 15. CONTRIBUTION 9

## Electron Main Process

Build the desktop functionality progressively.

Potential areas include:

* IPC
* credentials
* screen capture
* AI orchestration
* adapters
* native bridge
* application state
* security

Use meaningful commits such as:

```text
feat: add secure desktop IPC layer
feat: implement credential management
feat: add screen capture service
feat: connect AI orchestration to desktop process
feat: integrate native bridge communication
```

The exact commits should be based on the source.

---

# 16. CONTRIBUTION 10

## Frontend Application

Build the React UI progressively.

Do not copy the entire finished renderer into one commit.

Break major functionality into logical units.

For example:

```text
feat: establish application layout
feat: add primary navigation
feat: implement dashboard interface
feat: add appearance settings
feat: add adapter management interface
feat: add AI provider configuration
feat: add API connection monitoring
feat: implement companion overlay
feat: refine application interactions
```

Use the actual PATCH UI.

The final UI should match the original project.

---

# 17. IMPORTANT: LARGE FILES MUST BE DEVELOPED IN STAGES

For important large files, I want you to consider creating 2-3 meaningful commits.

Example:

A large service:

```text
adapter-manager.ts
```

could become:

### Commit 1

```text
feat: define adapter manager architecture
```

Add:

* types
* interfaces
* initial class
* state structure

### Commit 2

```text
feat: implement adapter lifecycle management
```

Add:

* registration
* initialization
* connection handling

### Commit 3

```text
feat: add adapter capability and error handling
```

Add:

* capability management
* validation
* errors
* edge cases

This is GOOD.

Do NOT do this:

```text
commit 1 = first 100 lines
commit 2 = next 100 lines
commit 3 = next 100 lines
```

The splitting must be based on **logical development**, not arbitrary line counts.

---

# 18. INTERMEDIATE COMMITS SHOULD BE VALID

Whenever reasonably possible, every commit should leave the repository in a usable or at least coherent development state.

Do not intentionally create:

```text
broken imports
half-written syntax
missing required files
uncompilable TypeScript
broken package references
```

just to create more commits.

A commit can represent incomplete overall functionality, but it should not be unnecessarily broken.

---

# 19. COPY, RECREATE, CREATE, IGNORE

For every major stage, determine four categories.

### COPY

Safe files that can be copied directly.

Examples:

* manifests
* static assets
* configuration
* plugin manifests

### RECREATE

Files whose implementation should be reconstructed progressively.

Examples:

* services
* orchestration
* complex React components
* database logic
* adapters

### CREATE

Files required by the destination but absent from the source.

### IGNORE

Generated/private files.

Never blindly copy an entire directory.

---

# 20. FILES THAT MUST NOT BE COMMITTED

At minimum ensure `.gitignore` protects:

```text
node_modules/
.turbo/
dist/
out/
build/
coverage/
release/

**/bin/
**/obj/

.env
.env.*
*.sqlite
*.sqlite3
*.db

*.log

.DS_Store
Thumbs.db
```

Also exclude:

* API keys
* tokens
* credentials
* private certificates
* local databases
* installers
* screenshots
* temporary files
* machine-specific configuration
* compiled binaries

Before every commit inspect the staged files.

---

# 21. NEVER COPY SECRETS

Search the source for likely credentials before committing.

Look for patterns involving:

```text
API_KEY
APIKEY
SECRET
TOKEN
PASSWORD
PRIVATE_KEY
OPENAI
GEMINI
GOOGLE
```

Do not expose real credentials.

If configuration requires environment variables, create:

```text
.env.example
```

with placeholders.

For example:

```text
OPENAI_API_KEY=
GEMINI_API_KEY=
```

Never copy actual values.

---

# 22. DOCUMENTATION

Documentation should be added near the end unless it is required for the repository foundation.

Potential documentation:

```text
README.md
ADAPTER_SETUP.md
SECURITY.md
DECISIONS.md
FRESH_INSTALL.md
docs/
scripts/
```

Historical reports such as:

```text
AUDIT_REPORT.md
FIX_REPORT.md
GEMINI_ROOT_CAUSE.md
```

should only be included if they are actually appropriate for public release.

Do not publish sensitive internal information.

Commit:

```text
docs: add setup security and development documentation
```

---

# 23. CI

Add:

```text
.github/workflows/ci.yml
```

only after the source project is structurally complete.

Commit:

```text
ci: add Windows verification workflow
```

If the workflow performs packaging, make sure it does not accidentally publish private artifacts.

---

# 24. VERIFICATION AFTER EVERY STAGE

After each meaningful contribution:

1. Inspect Git diff.
2. Verify imports.
3. Verify package dependencies.
4. Run the appropriate build/typecheck/test command.
5. Confirm no secrets were introduced.
6. Confirm generated files are ignored.
7. Confirm the source project was not modified.
8. Confirm only intended files are staged.

Use appropriate commands based on the project.

For example:

```text
pnpm install --frozen-lockfile
pnpm verify
```

But do not run commands blindly.

Inspect package scripts first.

---

# 25. DO NOT MAKE A "FINAL EVERYTHING" COMMIT

This is extremely important.

Do NOT reach the end and then run:

```text
git add .
git commit -m "final"
```

Every file should already have been introduced through an appropriate contribution.

The final commit should only contain genuinely final changes, such as:

```text
docs: finalize project documentation
```

or:

```text
chore: prepare repository for release
```

if actually necessary.

---

# 26. COMMIT TIMING

The commits do NOT need to happen at identical intervals.

Allow natural development time.

A tiny change might take:

```text
5-30 seconds
```

A normal contribution might take:

```text
1-5 minutes
```

A complex contribution might take:

```text
5-10 minutes
```

This is fine.

Do NOT intentionally sleep for arbitrary periods simply to make timestamps appear human.

The important thing is that the commits represent real work performed sequentially.

Do not batch several independent stages together just because they are fast.

Likewise, do not split a single trivial change into fake commits.

---

# 27. SEQUENTIAL EXECUTION RULE

Work strictly in sequence.

The process is:

```text
INSPECT
↓
PLAN
↓
IMPLEMENT ONE CONTRIBUTION
↓
VERIFY
↓
STAGE
↓
INSPECT DIFF
↓
COMMIT
↓
VERIFY COMMIT
↓
MOVE TO NEXT CONTRIBUTION
```

Do not jump ahead.

Do not simultaneously populate all directories.

Do not copy the entire source and then manufacture commits afterward.

The repository must actually be constructed progressively.

---

# 28. GIT COMMAND SAFETY

Before each commit:

```text
git status
git diff
git diff --cached
```

Ensure only intended files are staged.

After committing:

```text
git status
git log --oneline --decorate -n 10
```

Confirm the commit exists.

Do not use:

```text
git reset --hard
git clean -fd
git push --force
```

unless I explicitly authorize it.

Do not rewrite existing Git history.

---

# 29. GITHUB PUSH

The repository is already created.

Do NOT push immediately after every commit unless I explicitly ask you to.

The preferred process is:

```text
local reconstruction
↓
verification
↓
review Git history
↓
review repository contents
↓
user approval
↓
push to GitHub
```

Before pushing, show me:

```text
git status
git log --oneline
git remote -v
```

and summarize what will be pushed.

Wait for approval before the first push.

---

# 30. FINAL SECURITY CHECK

Before the repository is considered complete, verify that:

```text
node_modules       NOT TRACKED
.env               NOT TRACKED
.env.*              NOT TRACKED
database files      NOT TRACKED
bin/                NOT TRACKED
obj/                NOT TRACKED
dist/               NOT TRACKED
release/            NOT TRACKED
API keys            NOT TRACKED
tokens              NOT TRACKED
credentials         NOT TRACKED
private files       NOT TRACKED
```

Use:

```text
git ls-files
```

and inspect the result.

---

# 31. FINAL VERIFICATION

Install from the lockfile:

```text
pnpm install --frozen-lockfile
```

Then inspect the project's actual scripts and run the appropriate verification commands.

If available:

```text
pnpm verify
```

Also verify the project builds and the important runtime components remain functional.

The final repository should contain:

* source code
* package manifests
* lockfile
* tests
* configuration
* documentation
* setup scripts
* CI configuration

It should NOT contain:

* API keys
* credentials
* node_modules
* build output
* installers
* compiled binaries
* screenshots
* local databases
* logs
* machine-specific files

---

# 32. FINAL EXPECTED GIT HISTORY

The final history should resemble a real engineering project.

For example:

```text
chore: initialize PATCH monorepo
feat: define shared application types
feat: add validation schemas
feat: establish protocol contracts
feat: add security and logging primitives
feat: define AI provider interfaces
feat: implement AI planning core
feat: add OpenAI provider integration
feat: add Gemini provider integration
feat: establish AI tool registry
feat: implement local SQLite persistence
feat: scaffold Windows bridge project
feat: implement Windows UI automation bridge
feat: add Chrome native messaging host
feat: scaffold Chrome companion extension
feat: implement Chrome context adapter
feat: scaffold Photoshop UXP adapter
feat: implement Photoshop context integration
feat: scaffold Electron application
feat: add desktop main process
feat: add preload bridge
feat: initialize React renderer
feat: establish application layout
feat: add primary navigation
feat: implement dashboard interface
feat: add appearance settings
feat: add adapter management interface
feat: add AI provider configuration
feat: add API connection monitoring
feat: implement companion overlay
docs: add setup security and development documentation
ci: add Windows verification workflow
```

The exact history must be determined from the actual PATCH source.

---

# 33. MOST IMPORTANT RULE

**DO NOT FAKE THE DEVELOPMENT HISTORY.**

I want a genuinely reconstructed repository.

Use the original PATCH project as the source of truth, but introduce its functionality into the Git repository progressively.

Do not:

* copy everything
* commit everything
* then manipulate Git history afterward

Instead:

**COPY/RECREATE → VERIFY → COMMIT → COPY/RECREATE → VERIFY → COMMIT**

This distinction is extremely important.

---

# 34. BEGIN NOW

Your first task is NOT to copy files.

Your first task is to inspect the filesystem and Git repositories.

Report:

```text
SOURCE:
...

DESTINATION:
...

SOURCE AND DESTINATION SEPARATE:
YES / NO

DESTINATION GIT STATUS:
...

CURRENT BRANCH:
...

CURRENT COMMITS:
...

REMOTE:
...

SOURCE PROJECT STRUCTURE:
...

DESTINATION PROJECT STRUCTURE:
...
```

Then provide the finalized contribution plan based on the actual files you find.

If the source and destination are safely separated, begin with Contribution 1.

After completing and verifying Contribution 1, commit it.

Then proceed sequentially.

**Never modify the original source project.**

**Never push without my approval.**

**Never create fake commits just to increase the commit count.**

**Never create a single giant copy-paste commit.**

The objective is a clean, functional PATCH repository with a credible, meaningful, sequential Git development history.
