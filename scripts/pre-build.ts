import { existsSync, mkdirSync } from "fs";
import { join } from "path";

const WEBVIEW2_URL = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";
const INSTALLER_NAME = "MicrosoftEdgeWebview2Setup.exe";

async function main() {
    const os = process.env.ELECTROBUN_OS;
    const arch = process.env.ELECTROBUN_ARCH;
    const isWin = os === "win" || os === "win32" || process.platform === "win32";

    if (!isWin) {
        console.log("Not a Windows build, skipping WebView2 Bootstrapper download.");
        return;
    }

    if (arch !== "x64" && arch !== "x86_64") {
        console.log(`Architecture is ${arch}, we only bundle x64 WebView2, skipping.`);
        return;
    }

    // Use project root relative path since hooks run from project root
    const cacheDir = join(process.cwd(), "build", "webview2");
    const installerPath = join(cacheDir, INSTALLER_NAME);

    if (existsSync(installerPath)) {
        console.log(`WebView2 installer already cached at ${installerPath}`);
        return;
    }

    console.log(`Downloading WebView2 Evergreen Bootstrapper from ${WEBVIEW2_URL} ...`);
    console.log(`This is a ~2MB online installer.`);
    mkdirSync(cacheDir, { recursive: true });

    try {
        const response = await fetch(WEBVIEW2_URL, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
        });
        if (!response.ok) {
            throw new Error(`Failed to download WebView2 installer: ${response.status} ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        await Bun.write(installerPath, buffer);
        console.log(`Successfully downloaded WebView2 installer to ${installerPath}`);
    } catch (error) {
        console.error("Error downloading WebView2 installer:", error);
        process.exit(1);
    }
}

main().catch((err) => {
    console.error("preBuild hook error:", err);
    process.exit(1);
});
