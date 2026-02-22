# super-cms

An Electron application with React and TypeScript

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```

## Windows One-Click Installer (Recommended)

Build machine requirements (only on the machine that packages the installer):

- Windows 10/11
- Node.js 20+
- Python 3.10+ (for `cms_engine.exe` build)
- Internet access (first build will auto-download Real-ESRGAN Windows bundle)

Build steps:

```powershell
npm ci
npm run build:win
```

One-command setup (Windows build machine, run as Administrator):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-win-build-machine.ps1
```

What `npm run build:win` now does automatically:

1. Build `dist/cms_engine.exe` with PyInstaller.
2. Auto-download and prepare `AI_Tools/realesrgan-ncnn-vulkan-20220424-windows` when missing.
3. Verify required AI resources before Electron packaging.
4. Generate NSIS installer in `release\`.

Installer output:

- `release\super-cms-1.0.0-setup.exe`

Install steps on target Windows machine:

1. Copy `super-cms-1.0.0-setup.exe` to the target machine.
2. Double-click and install with default options.
3. Launch `Super CMS` from desktop/start menu.
4. No extra Node/Python/third-party library setup is required on the target machine.
