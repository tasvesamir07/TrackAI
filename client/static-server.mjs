import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, "dist");
const port = Number.parseInt(process.env.PORT || "3000", 10);

const mimeTypes = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".webp": "image/webp",
    ".map": "application/json; charset=utf-8",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
};

if (!fs.existsSync(distDir)) {
    console.error("Build output not found. Run `npm run build` first.");
    process.exit(1);
}

const server = http.createServer((req, res) => {
    const reqPath = decodeURIComponent((req.url || "/").split("?")[0]);
    const safePath = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, "");
    let filePath = path.join(distDir, safePath);

    if (safePath === "/" || safePath === "") {
        filePath = path.join(distDir, "index.html");
    }

    const tryServe = (targetPath, fallbackToIndex = true) => {
        fs.stat(targetPath, (err, stat) => {
            if (!err && stat.isDirectory()) {
                const indexPath = path.join(targetPath, "index.html");
                return tryServe(indexPath, fallbackToIndex);
            }

            if (err || !stat.isFile()) {
                if (fallbackToIndex) {
                    return tryServe(path.join(distDir, "index.html"), false);
                }
                res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
                res.end("Not Found");
                return;
            }

            const ext = path.extname(targetPath).toLowerCase();
            const contentType = mimeTypes[ext] || "application/octet-stream";
            const headers = {
                "Content-Type": contentType,
            };
            const fileName = path.basename(targetPath).toLowerCase();
            const shouldDisableCache = ext === ".html" || fileName === "sw.js" || fileName === "manifest.webmanifest";

            if (shouldDisableCache) {
                headers["Cache-Control"] = "no-cache";
            } else {
                headers["Cache-Control"] = "public, max-age=31536000, immutable";
            }

            res.writeHead(200, headers);
            fs.createReadStream(targetPath).pipe(res);
        });
    };

    tryServe(filePath);
});

server.listen(port, "0.0.0.0", () => {
    console.log(`Client server listening on port ${port}`);
});
