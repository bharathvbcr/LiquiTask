import { cpSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const INSTALLER_NAME = "MicrosoftEdgeWebview2Setup.exe";

function main() {
    const os = process.env.ELECTROBUN_OS;
    const buildDir = process.env.ELECTROBUN_BUILD_DIR;
    const isWin = os === "win" || os === "win32" || process.platform === "win32";

    if (!isWin) {
        console.log("Not a Windows build, skipping WebView2 Bootstrapper bundling.");
        return;
    }

    if (!buildDir) {
        console.error("ELECTROBUN_BUILD_DIR environment variable is not set.");
        process.exit(1);
    }

    const cacheDir = join(process.cwd(), "build", "webview2");
    const cachedInstallerPath = join(cacheDir, INSTALLER_NAME);

    if (!existsSync(cachedInstallerPath)) {
        console.warn(`WARNING: Cached WebView2 installer not found at ${cachedInstallerPath}.`);
        console.warn(`The bundled app will not have offline WebView2 installation capability.`);
        return;
    }

    // Electrobun builds place resources in Resources/app relative to the app bundle on Windows
    // $ELECTROBUN_BUILD_DIR looks like: build-electrobun/dev-win-x64/LiquiTask-dev
    const destDir = join(buildDir, "Resources", "app", "webview2");
    const destInstallerPath = join(destDir, INSTALLER_NAME);

    mkdirSync(destDir, { recursive: true });
    
    console.log(`Copying WebView2 installer to bundle: ${destInstallerPath}`);
    cpSync(cachedInstallerPath, destInstallerPath, { force: true });
    console.log(`Successfully bundled WebView2 installer.`);
}

main();
