// .github/sanitize_svg.js
const fs = require('fs');
const path = require('path');

if (process.argv.length < 3) {
    console.error('usage: node .github/sanitize_svg.js <file1.svg> [file2.svg] ...');
    process.exit(2);
}

function sanitize(content) {
    // remove BOM
    content = content.replace(/^\uFEFF/, '');

    // Remove script, foreignObject, iframe, object, embed blocks entirely
    content = content.replace(/<script[\s\S]*?<\/script>/gi, '');
    content = content.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
    content = content.replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
    content = content.replace(/<object[\s\S]*?<\/object>/gi, '');
    content = content.replace(/<embed[\s\S]*?<\/embed>/gi, '');

    // Remove <a ...> and </a>
    content = content.replace(/<a\b[^>]*>/gi, '');
    content = content.replace(/<\/a>/gi, '');

    // Remove any xlink:href or href attributes that are javascript: or external http(s)
    content = content.replace(/\s+(?:xlink:href|href)\s*=\s*(['"])\s*javascript:[^'"]*\1/gi, '');
    content = content.replace(/\s+(?:xlink:href|href)\s*=\s*(['"])\s*(https?:\/\/)[^'"]*\1/gi, '');

    // Replace image hrefs that reference remote images
    content = content.replace(/<image\b[^>]*(xlink:href|href)\s*=\s*(['"])\s*https?:\/\/[^'"]*\2[^>]*>/gi, '');

    // Remove inline event handlers like onclick, onload, onmouseover, etc.
    content = content.replace(/\s+on[a-zA-Z]+\s*=\s*(['"])[\s\S]*?\1/gi, '');

    // Remove xml:base or other dangerous attributes (conservative)
    content = content.replace(/\s+xml:base\s*=\s*(['"])[^'"]*\1/gi, '');

    // Remove <style> blocks that include @import to external CSS
    content = content.replace(/@import\s+url\([^)]+\);/gi, '');

    // Optional: remove foreign namespace declarations that can cause trouble (rare)
    // content = content.replace(/\s+xmlns:(?:xlink|foo)\s*=\s*(['"])[^'"]*\1/gi, '');

    // Trim multiple blank lines
    content = content.replace(/\n{3,}/g, '\n\n');

    return content;
}

let sanitizedCount = 0;
for (let i = 2; i < process.argv.length; i++) {
    const file = process.argv[i];
    try {
        const abs = path.resolve(process.cwd(), file);
        let txt = fs.readFileSync(abs, 'utf8');
        const before = txt;
        const after = sanitize(txt);
        if (before !== after) {
            fs.writeFileSync(abs, after, 'utf8');
            console.log(`Sanitized ${file}`);
            sanitizedCount++;
        } else {
            console.log(`No changes: ${file}`);
        }
    } catch (err) {
        console.error(`Error processing ${file}:`, err.message);
        process.exit(3);
    }
}

process.exit(sanitizedCount ? 0 : 0);