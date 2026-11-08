# S TECH Windows

Windows desktop client with a packaged web export and isolated Electron renderer.
This local edition uses the existing PanCafe API and data on this computer.
It starts the API if unavailable; it does not require Metro or a browser.
PanCafe and the elevated PanCafe bridge must be running for account operations.

Runtime configuration is outside the executable, in Electron's userData directory:
`local-runtime.json` with `projectDirectory` and `nodeExecutable` absolute paths.
No database, passwords, environment files or bridge credentials are packaged.
This is an unsigned local test build; payment remains simulated.

Build: export the mobile app for web with EXPO_PUBLIC_API_BASE_URL=/api/v1,
copy the export to desktop/web, then package this folder with @electron/packager.
Keep the whole generated Windows folder together; its EXE uses the adjacent files.
