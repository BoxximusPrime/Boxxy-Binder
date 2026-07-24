// Updates allbinds-manifest.json with the SHA-256 of AllBinds.xml as served by GitHub.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const xmlPath = path.join(projectRoot, 'AllBinds.xml');
const manifestPath = path.join(projectRoot, 'allbinds-manifest.json');

if (!fs.existsSync(xmlPath))
{
    throw new Error(`AllBinds.xml was not found at ${xmlPath}`);
}

if (!fs.existsSync(manifestPath))
{
    throw new Error(`Manifest was not found at ${manifestPath}`);
}

// Git normalizes the Windows working copy's CRLF line endings to LF when
// publishing the file. Fetch's response.text() also omits a UTF-8 BOM.
const publishedXml = fs.readFileSync(xmlPath, 'utf8')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n');

const sha256 = crypto
    .createHash('sha256')
    .update(publishedXml, 'utf8')
    .digest('hex');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.sha256 = sha256;

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`, 'utf8');

console.log(`Updated allbinds-manifest.json sha256: ${sha256}`);
