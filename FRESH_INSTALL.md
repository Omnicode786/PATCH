# PATCH — Fresh Windows Installation

## Fast path

For the easiest setup on a fresh Windows PC, double-click **`SETUP_PATCH.cmd`**. It launches the audited PowerShell bootstrap with a temporary execution-policy bypass and keeps the terminal open if anything fails.

Or open **PowerShell** in this extracted PATCH folder and run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\INSTALL_PATCH.ps1
```

`INSTALL_PATCH.ps1` checks/installs the required developer prerequisites on a fresh x64 Windows machine, installs the exact pnpm version expected by this repository, installs dependencies, runs the verification gate, builds the self-contained Windows UI Automation sidecar, creates the NSIS Windows installer, and launches that installer.

### What the script may install

- Node.js LTS (must resolve to Node 22.16.0 or newer)
- .NET 8 SDK
- pnpm 11.21.0

Automatic prerequisite installation uses Windows Package Manager (`winget`). If `winget` is missing, install/repair **App Installer** first.

## Build without launching the installer

```powershell
.\INSTALL_PATCH.ps1 -BuildOnly
```

The generated installer is placed in `release/`.

## Development mode

After dependencies are installed:

```powershell
.\RUN_PATCH_DEV.ps1
```

The default global shortcut is **Ctrl + Shift + Space**. The animated PATCH sloth companion is enabled by default and works before an AI key is configured. AI requests remain disabled until an OpenAI or Gemini key is added in **Settings → AI & Adapters**.

## Chrome companion

The source archive includes the Chrome Manifest V3 adapter, but Chrome does not permit a normal desktop installer to silently install an unpacked extension. For development, build the repository, load `adapters/chrome/dist` from `chrome://extensions`, then register the native host using the included `install-native-host.ps1`. A production distribution should publish/sign the browser extension through the browser's supported distribution channel.

## Photoshop companion

The source archive includes the Photoshop UXP adapter. Development loading requires Adobe's UXP developer workflow; production distribution requires the normal Adobe plugin packaging/signing flow.

## No API key is required to launch PATCH

PATCH must start, show its tray/companion UI, open Settings, and allow local configuration with no provider credentials. Provider keys are only required when the user submits an AI request.
